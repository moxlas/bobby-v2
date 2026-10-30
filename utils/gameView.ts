import type { Card, GameState, Player } from '../types/game';
import type { GameStateView, SeatPlayer } from '../types/online';

function cloneCard(card: Card): Card {
  return { ...card };
}

function toSeatPlayer(player: Player, viewerId: number | null, revealed: boolean): SeatPlayer {
  const visible = player.id === viewerId || revealed;
  return {
    ...player,
    hand: visible ? player.hand.map(cloneCard) : [],
    handCount: player.hand.length,
  };
}

/**
 * Build the view one seat is allowed to see.
 *
 * Only the viewer's own hand survives. Everyone else's cards are replaced by a
 * count, and the finish ranking never carries hands at all (the loser's hand
 * would otherwise leak the whole game). The pile, move history and options are
 * public information.
 *
 * One exception: once a seat has finished while the game is still running, that
 * screen becomes a spectator view, so the hand of whoever is on turn is revealed
 * to keep the rest of the game watchable.
 */
export function toGameStateView(state: GameState, viewerId: number | null): GameStateView {
  const viewer = viewerId === null
    ? null
    : (state.players.find(player => player.id === viewerId) ?? null);
  const activePlayer = state.players[state.currentPlayerIndex] ?? null;
  const spectating = !!viewer?.hasFinished && state.phase !== 'finished';

  return {
    ...state,
    players: state.players.map(player =>
      toSeatPlayer(player, viewerId, spectating && player.id === activePlayer?.id)),
    finishOrder: state.finishOrder.map(player => toSeatPlayer(player, null, false)),
    loser: state.loser ? toSeatPlayer(state.loser, null, false) : null,
    deck: [],
    youId: viewerId,
  };
}
