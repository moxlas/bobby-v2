import { Server, type Connection } from 'partyserver';
import { DEFAULT_OPTIONS, type GameRules, type GameState } from '../types/game';
import {
  MAX_ROOM_SEATS,
  MIN_ROOM_SEATS,
  type ClientMessage,
  type GameStateView,
  type RoomCloseReason,
  type RoomErrorCode,
  type RoomPhase,
  type RoomView,
  type ServerMessage,
} from '../types/online';
import {
  endTurn,
  finishGame,
  forfeitPlayer,
  getTakeOptions,
  initializeGame,
  pauseGame,
  playCards,
  resumeGame,
  takeCards,
  validatePlay,
} from '../utils/gameLogic';
import { getAIDelay, getAIMove } from '../utils/aiLogic';
import { toGameStateView } from '../utils/gameView';
import { isValidRoomCode } from '../utils/roomCode';

const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const RECONNECT_GRACE_MS = 60 * 1000;
const AI_DIFFICULTY = 'medium' as const;
const STORAGE_KEY = 'room';

interface RoomSeat {
  id: number;
  name: string;
  token: string;
  isAI: boolean;
  isHost: boolean;
  isConnected: boolean;
}

interface StoredRoom {
  phase: RoomPhase;
  seats: RoomSeat[];
  game: GameState | null;
  rules: GameRules;
  createdAt: number;
  version: number;
}

interface ConnectionSeat {
  seatId: number;
}

function sanitizeName(name: unknown): string {
  return typeof name === 'string' ? name.trim().slice(0, 12) : '';
}

function sanitizeRules(input: Partial<GameRules> | null | undefined): GameRules {
  return {
    specialNinesRule: Boolean(input?.specialNinesRule),
    allowTakeAllCards: Boolean(input?.allowTakeAllCards),
    fourOfAKindRule: Boolean(input?.fourOfAKindRule),
  };
}

function isFirstMoveOfGame(game: GameState): boolean {
  const pile = game.pile;
  return pile.length === 1 && pile[0].suit === 'diamonds' && pile[0].value === 9;
}

export interface Env {
  Main: DurableObjectNamespace<BobbyRoom>;
}

/**
 * One PartyServer room per code. The server is the only writer of the game
 * state: clients send intents, every seat receives its own redacted view.
 */
export class BobbyRoom extends Server<Env> {
  private state: StoredRoom | null = null;
  private loaded = false;
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly graceTimers = new Map<number, ReturnType<typeof setTimeout>>();

  async onStart(): Promise<void> {
    await this.load();

    if (!this.state) return;

    // A fresh process has no live sockets, so every seat starts offline until
    // its owner reconnects with the session token.
    for (const seat of this.state.seats) {
      seat.isConnected = false;
    }

    if (this.state.game?.phase === 'playing') {
      this.scheduleAI();
      const current = this.state.game.players[this.state.game.currentPlayerIndex];
      const seat = current ? this.state.seats.find(s => s.id === current.id) : null;
      if (seat && !seat.isAI) this.scheduleGrace(seat.id);
    }
  }

  async onConnect(): Promise<void> {
    // The seat is assigned by the first `hello`; the socket stays silent until then.
    await this.load();
  }

  async onMessage(sender: Connection, message: string | ArrayBuffer | ArrayBufferView): Promise<void> {
    await this.load();

    if (typeof message !== 'string') return;

    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(message) as ClientMessage;
    } catch {
      return;
    }
    if (!parsed || typeof parsed.type !== 'string') return;

    if (parsed.type === 'hello') {
      await this.handleHello(sender, parsed);
      return;
    }

    const seat = this.seatFor(sender);
    if (!seat || !this.state) {
      this.send(sender, { type: 'error', code: 'notInRoom' });
      return;
    }

    switch (parsed.type) {
      case 'setRules':
        await this.handleSetRules(seat, parsed.rules);
        break;
      case 'setAICount':
        await this.handleSetAICount(seat, parsed.count);
        break;
      case 'startGame':
        await this.handleStartGame(seat);
        break;
      case 'playCards':
        await this.handlePlayCards(seat, parsed.cards);
        break;
      case 'takeCards':
        await this.handleTakeCards(seat, parsed.count);
        break;
      case 'endTurn':
        await this.handleEndTurn(seat);
        break;
      case 'pause':
        await this.handlePause(seat);
        break;
      case 'resume':
        await this.handleResume(seat);
        break;
      case 'forfeit':
        await this.handleForfeit(seat);
        break;
      case 'finish':
        await this.handleFinish(seat);
        break;
      case 'restart':
        await this.handleRestart(seat);
        break;
      case 'leave':
        await this.handleLeave(seat);
        break;
      default:
        break;
    }
  }

  async onClose(connection: Connection): Promise<void> {
    await this.load();

    const seatId = this.seatIdFor(connection);
    if (seatId === null || !this.state) return;
    if (this.hasOtherConnection(seatId, connection.id)) return;

    const seat = this.state.seats.find(s => s.id === seatId);
    if (!seat) return;

    seat.isConnected = false;
    this.state.version++;
    await this.save();
    this.broadcastAll();
    this.scheduleGrace(seatId);
  }

  async onAlarm(): Promise<void> {
    // The TTL alarm only needs storage and sockets; it never inspects the game.
    this.loaded = true;
    for (const connection of this.getConnections()) {
      this.send(connection, { type: 'closed', reason: 'roomExpired' });
      connection.close(1000, 'roomExpired');
    }
    await this.ctx.storage.deleteAll();
    this.state = null;
  }

  // ---------------------------------------------------------------------------
  // Identity and room lifecycle
  // ---------------------------------------------------------------------------

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    const stored = await this.ctx.storage.get<StoredRoom>(STORAGE_KEY);
    if (stored && stored.seats) {
      this.state = stored;
    }
  }

  private async handleHello(
    connection: Connection,
    message: Extract<ClientMessage, { type: 'hello' }>,
  ): Promise<void> {
    if (!isValidRoomCode(this.name)) {
      connection.close(1000, 'roomNotFound');
      return;
    }

    const name = sanitizeName(message.name);
    if (!name) {
      this.send(connection, { type: 'error', code: 'nameRequired' });
      return;
    }

    const token = typeof message.token === 'string' ? message.token : null;
    const existing = token && this.state
      ? this.state.seats.find(seat => seat.token === token)
      : undefined;

    if (existing) {
      await this.claimSeat(connection, existing, name);
      return;
    }

    if (message.create) {
      if (this.state && this.state.seats.length > 0) {
        this.send(connection, { type: 'error', code: 'roomExists' });
        return;
      }

      this.state = {
        phase: 'lobby',
        seats: [],
        game: null,
        rules: sanitizeRules(DEFAULT_OPTIONS),
        createdAt: Date.now(),
        version: 0,
      };
      const host: RoomSeat = {
        id: 0,
        name,
        token: crypto.randomUUID(),
        isAI: false,
        isHost: true,
        isConnected: true,
      };
      this.state.seats.push(host);
      await this.claimSeat(connection, host, name);
      return;
    }

    if (!this.state || this.state.seats.length === 0) {
      this.send(connection, { type: 'closed', reason: 'roomNotFound' });
      connection.close(1000, 'roomNotFound');
      return;
    }

    if (this.state.phase !== 'lobby') {
      this.send(connection, { type: 'error', code: 'gameInProgress' });
      return;
    }

    if (this.state.seats.length >= MAX_ROOM_SEATS) {
      this.send(connection, { type: 'error', code: 'roomFull' });
      return;
    }

    const seat: RoomSeat = {
      id: this.lowestFreeSeatId(),
      name,
      token: crypto.randomUUID(),
      isAI: false,
      isHost: false,
      isConnected: true,
    };
    this.state.seats.push(seat);
    this.state.seats.sort((a, b) => a.id - b.id);
    await this.claimSeat(connection, seat, name);
  }

  private async claimSeat(connection: Connection, seat: RoomSeat, name: string): Promise<void> {
    if (!this.state) return;

    // One live socket per seat: a reconnect replaces an old tab.
    for (const other of this.getConnections()) {
      if (other.id === connection.id) continue;
      if (this.seatIdFor(other) === seat.id) {
        other.close(1000, 'replaced');
      }
    }

    this.clearGrace(seat.id);
    seat.isConnected = true;
    if (name && name !== seat.name) seat.name = name;
    seat.name = sanitizeName(seat.name) || seat.name;
    connection.setState({ seatId: seat.id } satisfies ConnectionSeat);

    this.state.version++;
    await this.save();

    this.send(connection, {
      type: 'welcome',
      token: seat.token,
      youId: seat.id,
      room: this.buildRoomView(seat.id),
      game: this.state.game ? toGameStateView(this.state.game, seat.id) : null,
    });
    this.broadcastAll();
  }

  private async handleSetRules(seat: RoomSeat, rules: GameRules): Promise<void> {
    if (!this.state || !seat.isHost || this.state.phase !== 'lobby') {
      this.sendError(seat, seat.isHost ? 'gameInProgress' : 'notHost');
      return;
    }

    this.state.rules = sanitizeRules(rules);
    this.state.version++;
    await this.save();
    this.broadcastAll();
  }

  private async handleSetAICount(seat: RoomSeat, count: number): Promise<void> {
    if (!this.state || !seat.isHost || this.state.phase !== 'lobby') {
      this.sendError(seat, seat.isHost ? 'gameInProgress' : 'notHost');
      return;
    }

    const humans = this.state.seats.filter(s => !s.isAI);
    const requested = Number.isFinite(count) ? Math.floor(count) : 0;
    const target = Math.max(0, Math.min(requested, MAX_ROOM_SEATS - humans.length));

    const aiSeats = this.state.seats.filter(s => s.isAI).sort((a, b) => a.id - b.id);
    while (aiSeats.length > target) {
      const removed = aiSeats.pop();
      if (!removed) break;
      this.state.seats = this.state.seats.filter(s => s.id !== removed.id);
      this.clearGrace(removed.id);
    }

    while (aiSeats.length < target) {
      const usedNumbers = new Set(
        this.state.seats
          .filter(s => s.isAI)
          .map(s => Number(s.name.replace(/\D/g, '')))
          .filter(n => Number.isFinite(n) && n > 0),
      );
      let number = 1;
      while (usedNumbers.has(number)) number++;

      const aiSeat: RoomSeat = {
        id: this.lowestFreeSeatId(),
        name: `AI ${number}`,
        token: crypto.randomUUID(),
        isAI: true,
        isHost: false,
        isConnected: true,
      };
      this.state.seats.push(aiSeat);
      aiSeats.push(aiSeat);
    }

    this.state.seats.sort((a, b) => a.id - b.id);
    this.state.version++;
    await this.save();
    this.broadcastAll();
  }

  private async handleStartGame(seat: RoomSeat): Promise<void> {
    if (!this.state || !seat.isHost) {
      this.sendError(seat, 'notHost');
      return;
    }

    if (this.state.phase !== 'lobby' && this.state.phase !== 'finished') {
      this.sendError(seat, 'gameInProgress');
      return;
    }

    if (this.state.seats.length < MIN_ROOM_SEATS) {
      this.sendError(seat, 'cannotStart');
      return;
    }

    this.dealNewGame();
    await this.commitGame();
  }

  private async handlePlayCards(seat: RoomSeat, cards: unknown): Promise<void> {
    const game = this.state?.game;
    if (!game || game.phase !== 'playing') {
      this.sendError(seat, 'gameInProgress');
      return;
    }
    if (!this.isCurrentSeat(game, seat)) {
      this.sendError(seat, 'notYourTurn');
      return;
    }
    if (!Array.isArray(cards) || cards.length === 0) {
      this.sendError(seat, 'invalidMove');
      return;
    }

    const player = game.players.find(p => p.id === seat.id);
    if (!player) {
      this.sendError(seat, 'invalidMove');
      return;
    }

    const ids = new Set(player.hand.map(card => card.id));
    const wellFormed = cards.every(card =>
      card &&
      typeof card.id === 'string' &&
      ids.has(card.id),
    );
    if (!wellFormed || new Set(cards.map(card => card.id)).size !== cards.length) {
      this.sendError(seat, 'invalidMove');
      return;
    }

    const validation = validatePlay(cards, game.pile, isFirstMoveOfGame(game), game.options);
    if (!validation.valid) {
      this.sendError(seat, 'invalidMove');
      return;
    }

    // The server decides whether a combo keeps the turn; never trust the client.
    this.state!.game = playCards(game, seat.id, cards, validation.continueTurn ?? false);
    await this.commitGame();
  }

  private async handleTakeCards(seat: RoomSeat, count: unknown): Promise<void> {
    const game = this.state?.game;
    if (!game || game.phase !== 'playing') {
      this.sendError(seat, 'gameInProgress');
      return;
    }
    if (!this.isCurrentSeat(game, seat)) {
      this.sendError(seat, 'notYourTurn');
      return;
    }

    const options = getTakeOptions(game.pile, game.options);
    const allowed = new Set([options.take3Count, options.takeAllCount].filter(n => n > 0));
    if (typeof count !== 'number' || !allowed.has(count)) {
      this.sendError(seat, 'invalidMove');
      return;
    }

    this.state!.game = takeCards(game, seat.id, count);
    await this.commitGame();
  }

  private async handleEndTurn(seat: RoomSeat): Promise<void> {
    const game = this.state?.game;
    if (!game || game.phase !== 'playing') {
      this.sendError(seat, 'gameInProgress');
      return;
    }
    if (!this.isCurrentSeat(game, seat)) {
      this.sendError(seat, 'notYourTurn');
      return;
    }

    this.state!.game = endTurn(game);
    await this.commitGame();
  }

  private async handlePause(seat: RoomSeat): Promise<void> {
    if (!this.state || !seat.isHost) {
      this.sendError(seat, 'notHost');
      return;
    }
    if (!this.state.game || this.state.game.phase !== 'playing') return;

    this.clearAITimer();
    this.state.game = pauseGame(this.state.game);
    this.state.version++;
    await this.save();
    this.broadcastAll();
  }

  private async handleResume(seat: RoomSeat): Promise<void> {
    if (!this.state || !seat.isHost) {
      this.sendError(seat, 'notHost');
      return;
    }
    if (!this.state.game || this.state.game.phase !== 'paused') return;

    this.state.game = resumeGame(this.state.game);
    this.state.version++;
    await this.save();
    this.broadcastAll();
    this.scheduleAI();
  }

  private async handleForfeit(seat: RoomSeat): Promise<void> {
    if (!this.state?.game) return;
    if (this.state.game.phase !== 'playing' && this.state.game.phase !== 'paused') return;

    this.clearAITimer();
    this.state.game = forfeitPlayer(this.state.game, seat.id);
    this.state.phase = this.state.game.phase === 'finished' ? 'finished' : this.state.phase;
    this.state.version++;
    await this.save();
    this.broadcastAll();
    this.scheduleAI();
  }

  private async handleFinish(seat: RoomSeat): Promise<void> {
    if (!this.state || !seat.isHost) {
      this.sendError(seat, 'notHost');
      return;
    }

    const game = this.state.game;
    if (!game || (game.phase !== 'playing' && game.phase !== 'paused')) return;

    this.clearAITimer();
    this.state.game = finishGame(game);
    this.state.phase = 'finished';
    this.state.version++;
    await this.save();
    this.broadcastAll();
  }

  private async handleRestart(seat: RoomSeat): Promise<void> {
    if (!this.state || !seat.isHost) {
      this.sendError(seat, 'notHost');
      return;
    }
    if (this.state.phase !== 'finished' || !this.state.game) return;

    this.dealNewGame();
    await this.commitGame();
  }

  private async handleLeave(seat: RoomSeat): Promise<void> {
    if (!this.state) return;

    this.clearGrace(seat.id);
    const game = this.state.game;
    if (game && (game.phase === 'playing' || game.phase === 'paused')) {
      this.clearAITimer();
      this.state.game = forfeitPlayer(game, seat.id);
      if (this.state.game.phase === 'finished') this.state.phase = 'finished';
    }

    this.state.seats = this.state.seats.filter(s => s.id !== seat.id);

    for (const connection of this.getConnections()) {
      if (this.seatIdFor(connection) === seat.id) {
        connection.close(1000, 'left');
      }
    }

    this.promoteHost();

    const humans = this.state.seats.filter(s => !s.isAI);
    if (humans.length === 0) {
      await this.destroy();
      return;
    }

    this.state.version++;
    await this.save();
    this.broadcastAll();

    if (game) this.scheduleAI();
  }

  // ---------------------------------------------------------------------------
  // Game flow
  // ---------------------------------------------------------------------------

  private dealNewGame(): void {
    if (!this.state) return;

    const setups = this.state.seats
      .slice()
      .sort((a, b) => a.id - b.id)
      .map(seat => ({ id: seat.id, name: seat.name, isAI: seat.isAI }));

    this.state.game = initializeGame(setups, {
      ...DEFAULT_OPTIONS,
      ...this.state.rules,
      aiDifficulty: AI_DIFFICULTY,
    });
    this.state.phase = 'playing';
  }

  private async commitGame(): Promise<void> {
    if (!this.state) return;

    this.state.phase = this.state.game?.phase === 'finished' ? 'finished' : 'playing';
    this.state.version++;
    await this.save();
    this.broadcastAll();
    this.scheduleAI();
  }

  private scheduleAI(): void {
    this.clearAITimer();

    const game = this.state?.game;
    if (!game || game.phase !== 'playing') return;

    const current = game.players[game.currentPlayerIndex];
    if (!current?.isAI) return;

    const seatId = current.id;
    this.aiTimer = setTimeout(() => {
      this.aiTimer = null;
      void this.runAITurn(seatId);
    }, getAIDelay(AI_DIFFICULTY));
  }

  private async runAITurn(seatId: number): Promise<void> {
    const game = this.state?.game;
    if (!game || game.phase !== 'playing') return;

    const current = game.players[game.currentPlayerIndex];
    if (!current || current.id !== seatId || !current.isAI) return;

    // The server never needs a deep search; medium play keeps a room responsive.
    const move = getAIMove(game, seatId, false);
    let next = game;

    if (move.type === 'play' && move.cards.length > 0) {
      const validation = validatePlay(move.cards, game.pile, isFirstMoveOfGame(game), game.options);
      if (validation.valid) {
        next = playCards(game, seatId, move.cards, validation.continueTurn ?? false);
      } else {
        const options = getTakeOptions(game.pile, game.options);
        const count = options.canTake3 ? options.take3Count : options.takeAllCount;
        next = count > 0 ? takeCards(game, seatId, count) : playCards(game, seatId, [], false);
      }
    } else if (move.type === 'take') {
      const options = getTakeOptions(game.pile, game.options);
      const count = move.takeType === 'takeAll' ? options.takeAllCount : options.take3Count;
      next = count > 0 ? takeCards(game, seatId, count) : playCards(game, seatId, [], false);
    } else {
      next = endTurn(game);
    }

    this.state!.game = next;
    await this.commitGame();
  }

  // ---------------------------------------------------------------------------
  // Reconnect grace
  // ---------------------------------------------------------------------------

  private scheduleGrace(seatId: number): void {
    this.clearGrace(seatId);

    this.graceTimers.set(seatId, setTimeout(() => {
      this.graceTimers.delete(seatId);
      void this.expireDisconnectedSeat(seatId);
    }, RECONNECT_GRACE_MS));
  }

  private clearGrace(seatId: number): void {
    const timer = this.graceTimers.get(seatId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.graceTimers.delete(seatId);
    }
  }

  private clearAITimer(): void {
    if (this.aiTimer !== null) {
      clearTimeout(this.aiTimer);
      this.aiTimer = null;
    }
  }

  private async expireDisconnectedSeat(seatId: number): Promise<void> {
    if (!this.state) return;

    const seat = this.state.seats.find(s => s.id === seatId);
    if (!seat || seat.isConnected || seat.isAI) return;

    if (this.state.phase === 'lobby') {
      this.state.seats = this.state.seats.filter(s => s.id !== seatId);
      this.promoteHost();
      if (this.state.seats.filter(s => !s.isAI).length === 0) {
        await this.destroy();
        return;
      }
    } else if (this.state.game && (this.state.game.phase === 'playing' || this.state.game.phase === 'paused')) {
      this.clearAITimer();
      this.state.game = forfeitPlayer(this.state.game, seatId);
      this.state.phase = this.state.game.phase === 'finished' ? 'finished' : 'playing';
      this.scheduleAI();
    }

    this.state.version++;
    await this.save();
    this.broadcastAll();
  }

  // ---------------------------------------------------------------------------
  // Views and messaging
  // ---------------------------------------------------------------------------

  private buildRoomView(viewerId: number): RoomView {
    const state = this.state!;
    return {
      code: this.name,
      phase: state.phase,
      hostId: state.seats.find(s => s.isHost)?.id ?? -1,
      seats: state.seats.map(seat => ({
        id: seat.id,
        name: seat.name,
        isAI: seat.isAI,
        isHost: seat.isHost,
        isConnected: seat.isConnected,
      })),
      rules: { ...state.rules },
      aiDifficulty: AI_DIFFICULTY,
      minSeats: MIN_ROOM_SEATS,
      maxSeats: MAX_ROOM_SEATS,
      youId: viewerId,
      version: state.version,
    };
  }

  private broadcastAll(): void {
    if (!this.state) return;

    for (const connection of this.getConnections()) {
      const seatId = this.seatIdFor(connection);
      if (seatId === null) continue;

      const room = this.buildRoomView(seatId);
      const game: GameStateView | null = this.state.game
        ? toGameStateView(this.state.game, seatId)
        : null;

      if (game) {
        this.send(connection, { type: 'game', room, game });
      } else {
        this.send(connection, { type: 'room', room });
      }
    }
  }

  private send(connection: Connection, message: ServerMessage): void {
    try {
      connection.send(JSON.stringify(message));
    } catch {
      // The socket may be closing; onClose will mark the seat offline.
    }
  }

  private sendError(seat: RoomSeat, code: RoomErrorCode): void {
    for (const connection of this.getConnections()) {
      if (this.seatIdFor(connection) === seat.id) {
        this.send(connection, { type: 'error', code });
      }
    }
  }

  private seatFor(connection: Connection): RoomSeat | null {
    const state = connection.state as ConnectionSeat | null;
    if (!state || typeof state.seatId !== 'number' || !this.state) return null;
    return this.state.seats.find(seat => seat.id === state.seatId) ?? null;
  }

  private seatIdFor(connection: Connection): number | null {
    const state = connection.state as ConnectionSeat | null;
    return state && typeof state.seatId === 'number' ? state.seatId : null;
  }

  private hasOtherConnection(seatId: number, exceptConnectionId: string): boolean {
    for (const connection of this.getConnections()) {
      if (connection.id === exceptConnectionId) continue;
      if (this.seatIdFor(connection) === seatId) return true;
    }
    return false;
  }

  private isCurrentSeat(game: GameState, seat: RoomSeat): boolean {
    const current = game.players[game.currentPlayerIndex];
    return !!current && current.id === seat.id && !current.hasFinished && !current.isAI;
  }

  // ---------------------------------------------------------------------------
  // Storage helpers
  // ---------------------------------------------------------------------------

  private async save(): Promise<void> {
    if (!this.state) return;
    await this.ctx.storage.put(STORAGE_KEY, this.state);
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
  }

  private lowestFreeSeatId(): number {
    const used = new Set(this.state?.seats.map(seat => seat.id) ?? []);
    for (let id = 0; id < MAX_ROOM_SEATS; id++) {
      if (!used.has(id)) return id;
    }
    return 0;
  }

  private promoteHost(): void {
    if (!this.state) return;
    if (this.state.seats.some(seat => seat.isHost)) return;

    const nextHost =
      this.state.seats.find(seat => !seat.isAI && seat.isConnected) ??
      this.state.seats.find(seat => !seat.isAI);

    if (nextHost) nextHost.isHost = true;
  }

  private async destroy(): Promise<void> {
    for (const connection of this.getConnections()) {
      this.send(connection, { type: 'closed', reason: 'roomNotFound' as RoomCloseReason });
      connection.close(1000, 'roomClosed');
    }
    this.clearAITimer();
    for (const seatId of this.graceTimers.keys()) this.clearGrace(seatId);
    this.state = null;
    this.loaded = true;
    await this.ctx.storage.deleteAll();
  }
}
