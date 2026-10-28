import type { Card, GameState, Player } from '../types/game';
import type { GameStateView, SeatPlayer } from '../types/online';

function cloneCard(card: Card): Card {
  return { ...card };
}

function toSeatPlayer(player: Player, viewerId: number | null): SeatPlayer {
  return {
    ...player,
    hand: player.id === viewerId ? player.hand.map(cloneCard) : [],
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
 */
export function toGameStateView(state: GameState, viewerId: number | null): GameStateView {
  return {
    ...state,
    players: state.players.map(player => toSeatPlayer(player, viewerId)),
    finishOrder: state.finishOrder.map(player => toSeatPlayer(player, null)),
    loser: state.loser ? toSeatPlayer(state.loser, null) : null,
    deck: [],
    youId: viewerId,
  };
}
