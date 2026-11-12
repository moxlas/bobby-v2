import { Server, type Connection } from 'partyserver';
import { DEFAULT_OPTIONS, type GameRules, type GameState } from '../types/game';
import {
  MAX_ROOM_SEATS,
  MAX_ROOM_SPECTATORS,
  MIN_ROOM_SEATS,
  type ClientMessage,
  type GameStateView,
  type PublicRoomSummary,
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
  resolveHandCards,
  resumeGame,
  takeCards,
  validatePlay,
} from '../utils/gameLogic';
import { getAIDelay, getAIMove } from '../utils/aiLogic';
import { toGameStateView } from '../utils/gameView';
import { playerNameKey, isPlayerNameTaken } from '../utils/playerNames';
import { isValidRoomCode } from '../utils/roomCode';
import { ROOM_LIST_HEARTBEAT_MS } from '../utils/roomBrowser';
import type { Env } from './env';

const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const RECONNECT_GRACE_MS = 60 * 1000;
const AI_DIFFICULTY = 'expert' as const;
const STORAGE_KEY = 'room';
const DIRECTORY_ORIGIN = 'https://directory.internal';

interface RoomSeat {
  id: number;
  name: string;
  token: string;
  isAI: boolean;
  isHost: boolean;
  isConnected: boolean;
}

interface RoomSpectator {
  id: number;
  name: string;
  token: string;
  isConnected: boolean;
  joinedAt: number;
}

interface StoredRoom {
  phase: RoomPhase;
  seats: RoomSeat[];
  spectators: RoomSpectator[];
  game: GameState | null;
  rules: GameRules;
  createdAt: number;
  version: number;
  /** Rooms persist this opt-in; anything saved before it existed is private. */
  isPublic: boolean;
  /** Inactivity deadline, refreshed on every save. */
  expiresAt: number;
}

interface ConnectionSeat {
  seatId?: number;
  spectatorId?: number;
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

/**
 * One PartyServer room per code. The server is the only writer of the game
 * state: clients send intents, every seat receives its own redacted view.
 */
export class BobbyRoom extends Server<Env> {
  private state: StoredRoom | null = null;
  private loaded = false;
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly graceTimers = new Map<number, ReturnType<typeof setTimeout>>();
  /** The last published roster/phase, so game moves never touch the directory. */
  private listingSignature: string | null = null;
  /** Last time an entry was actually sent; keeps long games fresh. */
  private lastPublishedAt = 0;

  async onStart(): Promise<void> {
    await this.load();

    if (!this.state) return;

    // A fresh process has no live sockets, so every seat starts offline until
    // its owner reconnects with the session token. Spectators are ephemeral and
    // cannot reclaim a socket after a restart, so drop them.
    for (const seat of this.state.seats) {
      seat.isConnected = false;
    }
    this.state.spectators = [];

    if (this.state.game?.phase === 'playing') {
      this.scheduleAI();
      const current = this.state.game.players[this.state.game.currentPlayerIndex];
      const seat = current ? this.state.seats.find(s => s.id === current.id) : null;
      if (seat && !seat.isAI) this.scheduleGrace(seat.id);
    }

    // A cold start may follow a deploy or hibernation; refresh the public entry
    // so the directory keeps the room visible while it waits for players.
    if (this.state.isPublic) await this.syncListing(true);
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
    if (!seat) {
      const spectator = this.spectatorFor(sender);
      if (spectator) {
        if (parsed.type === 'leave') {
          await this.handleSpectatorLeave(spectator);
        } else {
          this.send(sender, { type: 'error', code: 'spectating' });
        }
        return;
      }
      this.send(sender, { type: 'error', code: 'notInRoom' });
      return;
    }
    if (!this.state) {
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
    if (!this.state) return;

    const seatId = this.seatIdFor(connection);
    if (seatId === null) {
      // Spectators are cheap to replace; a refresh simply joins again.
      const spectatorId = this.spectatorIdFor(connection);
      if (spectatorId === null) return;
      if (this.hasOtherSpectatorConnection(spectatorId, connection.id)) return;
      this.state.spectators = this.state.spectators.filter(s => s.id !== spectatorId);
      this.state.version++;
      await this.save();
      this.broadcastAll();
      return;
    }
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
    await this.load();
    const now = Date.now();

    if (this.state && this.state.expiresAt > now) {
      // Public rooms wake every minute to refresh their listing. This heartbeat
      // must not extend the inactivity deadline, so it does not call save().
      await this.syncListing(true);
      await this.ctx.storage.setAlarm(
        Math.min(this.state.expiresAt, now + ROOM_LIST_HEARTBEAT_MS),
      );
      return;
    }

    await this.unpublishListing();

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
      // Rooms persisted before spectators existed need the new list.
      if (!Array.isArray(this.state.spectators)) this.state.spectators = [];
      // Public listing is opt-in, so every older room stays private.
      if (typeof this.state.isPublic !== 'boolean') this.state.isPublic = false;
      if (!Number.isFinite(this.state.expiresAt)) {
        this.state.expiresAt = Date.now() + ROOM_TTL_MS;
      }
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
      if (playerNameKey(name) !== playerNameKey(existing.name) && this.isNameTaken(name, existing)) {
        this.send(connection, { type: 'error', code: 'nameTaken' });
        return;
      }
      await this.claimSeat(connection, existing, name);
      return;
    }

    const existingSpectator = token && this.state
      ? this.state.spectators.find(spectator => spectator.token === token)
      : undefined;

    if (existingSpectator) {
      if (playerNameKey(name) !== playerNameKey(existingSpectator.name) && this.isNameTaken(name, existingSpectator)) {
        this.send(connection, { type: 'error', code: 'nameTaken' });
        return;
      }
      await this.claimSpectator(connection, existingSpectator, name);
      return;
    }

    // New participants need a name nobody else in the room is using, so two
    // people never share one leaderboard row.
    if (!message.create && this.isNameTaken(name)) {
      this.send(connection, { type: 'error', code: 'nameTaken' });
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
        spectators: [],
        game: null,
        rules: sanitizeRules(DEFAULT_OPTIONS),
        createdAt: Date.now(),
        version: 0,
        // Public listing is opt-in, but the entry screen defaults it on.
        isPublic: message.publicRoom !== false,
        expiresAt: Date.now() + ROOM_TTL_MS,
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

    // A running (or paused) game accepts watchers; the finished screen accepts
    // new players so they can be dealt into the next round.
    if (this.state.phase === 'playing') {
      if (this.state.spectators.length >= MAX_ROOM_SPECTATORS) {
        this.send(connection, { type: 'error', code: 'roomFull' });
        return;
      }

      const spectator: RoomSpectator = {
        id: this.lowestFreeSpectatorId(),
        name,
        token: crypto.randomUUID(),
        isConnected: true,
        joinedAt: Date.now(),
      };
      this.state.spectators.push(spectator);
      this.state.spectators.sort((a, b) => a.id - b.id);
      await this.claimSpectator(connection, spectator, name);
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
      room: this.buildRoomView(seat.id, null),
      game: this.state.game ? toGameStateView(this.state.game, seat.id) : null,
    });
    this.broadcastAll();
  }

  private async claimSpectator(
    connection: Connection,
    spectator: RoomSpectator,
    name: string,
  ): Promise<void> {
    if (!this.state) return;

    for (const other of this.getConnections()) {
      if (other.id === connection.id) continue;
      if (this.spectatorIdFor(other) === spectator.id) {
        other.close(1000, 'replaced');
      }
    }

    spectator.isConnected = true;
    if (name && name !== spectator.name) spectator.name = name;
    spectator.name = sanitizeName(spectator.name) || spectator.name;
    connection.setState({ spectatorId: spectator.id } satisfies ConnectionSeat);

    this.state.version++;
    await this.save();

    this.send(connection, {
      type: 'welcome',
      token: spectator.token,
      youId: null,
      room: this.buildRoomView(null, spectator.id),
      game: this.state.game ? toGameStateView(this.state.game, null) : null,
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
    // Between games the host can clear AI seats so friends who joined the
    // finished table can take them in the next round.
    if (
      !this.state ||
      !seat.isHost ||
      (this.state.phase !== 'lobby' && this.state.phase !== 'finished')
    ) {
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
      const usedNames = new Set(
        [...this.state.seats, ...this.state.spectators].map(s => playerNameKey(s.name)),
      );
      let number = 1;
      while (usedNames.has(playerNameKey(`AI ${number}`))) number++;

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

    // Values and suits always come from the server's hand; the client only
    // supplies ids, so a modified client cannot promote its own cards.
    const playedCards = resolveHandCards(player.hand, cards);
    if (!playedCards) {
      this.sendError(seat, 'invalidMove');
      return;
    }

    const validation = validatePlay(playedCards, game.pile, isFirstMoveOfGame(game), game.options);
    if (!validation.valid) {
      this.sendError(seat, 'invalidMove');
      return;
    }

    // The server decides whether a combo keeps the turn; never trust the client.
    this.state!.game = playCards(game, seat.id, playedCards, validation.continueTurn ?? false);
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
    if (!this.state.game) return;

    // The restart button lives on the pause screen, so a paused game is just as
    // restartable as a finished one; anything else (setup) has nothing to deal.
    const phase = this.state.game.phase;
    if (phase !== 'playing' && phase !== 'paused' && phase !== 'finished') return;

    // AI seats can be removed on the finished screen, so re-check the seat count.
    if (this.state.seats.length < MIN_ROOM_SEATS) {
      this.sendError(seat, 'cannotStart');
      return;
    }

    this.clearAITimer();
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

  private async handleSpectatorLeave(spectator: RoomSpectator): Promise<void> {
    if (!this.state) return;

    this.state.spectators = this.state.spectators.filter(s => s.id !== spectator.id);

    for (const connection of this.getConnections()) {
      if (this.spectatorIdFor(connection) === spectator.id) {
        connection.close(1000, 'left');
      }
    }

    if (this.state.seats.filter(s => !s.isAI).length === 0) {
      await this.destroy();
      return;
    }

    this.state.version++;
    await this.save();
    this.broadcastAll();
  }

  // ---------------------------------------------------------------------------
  // Game flow
  // ---------------------------------------------------------------------------

  private dealNewGame(): void {
    if (!this.state) return;

    // Anyone who watched the previous game takes an open seat for the next one.
    this.promoteSpectatorsToSeats();

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

  private promoteSpectatorsToSeats(): void {
    if (!this.state || this.state.spectators.length === 0) return;

    for (const spectator of [...this.state.spectators]) {
      if (this.state.seats.length >= MAX_ROOM_SEATS) break;

      const seat: RoomSeat = {
        id: this.lowestFreeSeatId(),
        name: spectator.name,
        token: spectator.token,
        isAI: false,
        isHost: false,
        isConnected: spectator.isConnected,
      };
      this.state.seats.push(seat);
      this.state.spectators = this.state.spectators.filter(s => s.id !== spectator.id);

      for (const connection of this.getConnections()) {
        if (this.spectatorIdFor(connection) === spectator.id) {
          connection.setState({ seatId: seat.id } satisfies ConnectionSeat);
        }
      }
    }

    this.state.seats.sort((a, b) => a.id - b.id);
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
    const move = getAIMove(game, seatId, true);
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

  private buildRoomView(viewerId: number | null, spectatorId: number | null): RoomView {
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
      spectators: state.spectators.map(spectator => ({
        id: spectator.id,
        name: spectator.name,
        isConnected: spectator.isConnected,
        joinedAt: spectator.joinedAt,
      })),
      rules: { ...state.rules },
      aiDifficulty: AI_DIFFICULTY,
      minSeats: MIN_ROOM_SEATS,
      maxSeats: MAX_ROOM_SEATS,
      youId: viewerId,
      spectatorId,
      version: state.version,
    };
  }

  private broadcastAll(): void {
    if (!this.state) return;

    for (const connection of this.getConnections()) {
      const seatId = this.seatIdFor(connection);
      const spectatorId = this.spectatorIdFor(connection);
      if (seatId === null && spectatorId === null) continue;

      const room = this.buildRoomView(seatId, spectatorId);
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

  private spectatorFor(connection: Connection): RoomSpectator | null {
    const state = connection.state as ConnectionSeat | null;
    if (!state || typeof state.spectatorId !== 'number' || !this.state) return null;
    return this.state.spectators.find(spectator => spectator.id === state.spectatorId) ?? null;
  }

  private seatIdFor(connection: Connection): number | null {
    const state = connection.state as ConnectionSeat | null;
    return state && typeof state.seatId === 'number' ? state.seatId : null;
  }

  private spectatorIdFor(connection: Connection): number | null {
    const state = connection.state as ConnectionSeat | null;
    return state && typeof state.spectatorId === 'number' ? state.spectatorId : null;
  }

  private hasOtherConnection(seatId: number, exceptConnectionId: string): boolean {
    for (const connection of this.getConnections()) {
      if (connection.id === exceptConnectionId) continue;
      if (this.seatIdFor(connection) === seatId) return true;
    }
    return false;
  }

  private hasOtherSpectatorConnection(spectatorId: number, exceptConnectionId: string): boolean {
    for (const connection of this.getConnections()) {
      if (connection.id === exceptConnectionId) continue;
      if (this.spectatorIdFor(connection) === spectatorId) return true;
    }
    return false;
  }

  private isCurrentSeat(game: GameState, seat: RoomSeat): boolean {
    const current = game.players[game.currentPlayerIndex];
    return !!current && current.id === seat.id && !current.hasFinished && !current.isAI;
  }

  // ---------------------------------------------------------------------------
  // Public directory
  // ---------------------------------------------------------------------------

  /** Build the public view of this room; null before the room exists. */
  private buildListing(now = Date.now()): PublicRoomSummary | null {
    if (!this.state) return null;

    const host = this.state.seats.find(seat => seat.isHost);
    return {
      code: this.name,
      hostName: host?.name ?? 'Host',
      phase: this.state.phase,
      humans: this.state.seats.filter(seat => !seat.isAI).length,
      ai: this.state.seats.filter(seat => seat.isAI).length,
      spectators: this.state.spectators.length,
      maxSeats: MAX_ROOM_SEATS,
      createdAt: this.state.createdAt,
      updatedAt: now,
    };
  }

  /**
   * Publish the room when its phase or roster changes. A signature keeps game
   * moves (which bump `version`) from touching the directory on every turn.
   */
  private async syncListing(force = false): Promise<void> {
    if (!this.state?.isPublic) return;

    let listing: PublicRoomSummary | null;
    try {
      listing = this.buildListing();
    } catch {
      return;
    }
    if (!listing) return;

    const signature = [
      listing.phase,
      listing.humans,
      listing.ai,
      listing.spectators,
      listing.hostName,
      listing.maxSeats,
    ].join('|');

    const heartbeatDue = Date.now() - this.lastPublishedAt >= ROOM_LIST_HEARTBEAT_MS;
    if (!force && !heartbeatDue && signature === this.listingSignature) return;
    this.listingSignature = signature;

    await this.directoryRequest('/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ room: listing }),
    });
    this.lastPublishedAt = Date.now();
  }

  private async unpublishListing(): Promise<void> {
    this.listingSignature = null;
    if (this.state && !this.state.isPublic) return;

    try {
      await this.directoryRequest(`/rooms?code=${encodeURIComponent(this.name)}`, {
        method: 'DELETE',
      });
    } catch {
      // The room is going away regardless; a stale entry expires on its own.
    }
  }

  private async directoryRequest(path: string, init: RequestInit): Promise<void> {
    try {
      const id = this.env.Directory.idFromName('global');
      await this.env.Directory.get(id).fetch(`${DIRECTORY_ORIGIN}${path}`, init);
    } catch {
      // Listing is best-effort: never let the directory failure break a room.
    }
  }

  // ---------------------------------------------------------------------------
  // Storage helpers
  // ---------------------------------------------------------------------------

  private async save(): Promise<void> {
    if (!this.state) return;

    // Any activity keeps the room alive for another two hours.
    this.state.expiresAt = Date.now() + ROOM_TTL_MS;
    await this.ctx.storage.put(STORAGE_KEY, this.state);
    await this.ctx.storage.setAlarm(this.nextAlarmAt());
    await this.syncListing();
  }

  /** Public rooms wake every minute; private rooms only at their deadline. */
  private nextAlarmAt(): number {
    const now = Date.now();
    const expiresAt = this.state?.expiresAt ?? now + ROOM_TTL_MS;
    return this.state?.isPublic
      ? Math.min(expiresAt, now + ROOM_LIST_HEARTBEAT_MS)
      : expiresAt;
  }

  private isNameTaken(name: string, except?: RoomSeat | RoomSpectator): boolean {
    if (!this.state) return false;
    const participants = [...this.state.seats, ...this.state.spectators]
      .filter(participant => participant !== except);
    return isPlayerNameTaken(participants, name);
  }

  private lowestFreeSeatId(): number {
    const used = new Set(this.state?.seats.map(seat => seat.id) ?? []);
    for (let id = 0; id < MAX_ROOM_SEATS; id++) {
      if (!used.has(id)) return id;
    }
    return 0;
  }

  private lowestFreeSpectatorId(): number {
    const used = new Set(this.state?.spectators.map(spectator => spectator.id) ?? []);
    for (let id = 0; id < MAX_ROOM_SPECTATORS; id++) {
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
    await this.unpublishListing();

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
