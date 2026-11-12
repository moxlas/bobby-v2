import { Card, GameState, GameOptions, AIDifficulty, Player, PlayerMove } from '../../types/game';
import { endTurn } from '../gameLogic';

export type AIMove = { type: 'play' | 'take' | 'endTurn'; cards: Card[]; takeType?: 'take3' | 'takeAll' };

export interface OpponentCardTracker {
  knownHands: Map<number, Card[]>;
  unknownCounts: Map<number, number>;
  unknownValueCeilings: Map<number, number>;
}

export type HumanImitationStyle = 'weighted' | 'nearest' | 'consensus';

export interface AdversarialSearchContext {
  rootPlayerId: number;
  initialFinishCount: number;
  maxNodes: number;
  nodes: number;
  exhausted: boolean;
  transpositions: Map<string, number>;
  path: Set<string>;
  deadline: number;
}

