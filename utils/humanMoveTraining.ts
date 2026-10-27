/**
 * Compiled move statistics from 6 supplied demonstration files:
 * 919 unique two-player decisions across 45 games.
 * Per-state examples, including public opponent-action context, live in humanMoveTrainingData.ts.
 */
export const HUMAN_MOVE_TRAINING = {
  "records": 919,
  "games": 45,
  "sourceFiles": [
    "bobby-human-demonstrations (1) (1).json",
    "bobby-human-demonstrations (1).json",
    "bobby-human-demonstrations (2) (1).json",
    "bobby-human-demonstrations (2).json",
    "bobby-human-demonstrations (3).json",
    "bobby-human-demonstrations.json"
  ],
  "pileTopChoices": {
    "9": {
      "states": 263,
      "takes": 0
    },
    "10": {
      "states": 154,
      "takes": 0
    },
    "11": {
      "states": 106,
      "takes": 0
    },
    "12": {
      "states": 137,
      "takes": 7
    },
    "13": {
      "states": 155,
      "takes": 82
    },
    "14": {
      "states": 104,
      "takes": 80
    }
  },
  "highPileChoices": {
    "13": {
      "states": 155,
      "takes": 82
    },
    "14": {
      "states": 104,
      "takes": 80
    }
  },
  "highCardControl": {
    "highSinglePlays": 237,
    "highSinglesWithLowerAlternative": 107,
    "highSinglesWithLowerAlternativeAndAnotherHighKept": 107,
    "highSinglesLeavingOneCardAndKeepingAnotherHigh": 17,
    "highSinglesLeavingOneLowCard": 0
  },
  "quadBreaks": {
    "quadInHandStates": 586,
    "singleBreaks": 77,
    "breaksByRank": {
      "9": 0,
      "10": 2,
      "11": 3,
      "12": 19,
      "13": 40,
      "14": 13
    },
    "breaksByPileTop": {
      "9": 3,
      "10": 23,
      "11": 26,
      "12": 25,
      "13": 0,
      "14": 0
    },
    "breaksOnNine": 3
  },
  "quadChoices": {
    "statesTakingWithQuadInHand": 87,
    "statesBreakingHighQuad": 53,
    "statesPlayingQuad": 75,
    "playsByRank": {
      "9": 0,
      "10": 7,
      "11": 10,
      "12": 13,
      "13": 18,
      "14": 27
    },
    "highPileQuadOffers": 162,
    "highQuadCompletionTakeOpportunities": 51,
    "quadCompletionTakeStats": {
      "13": {
        "opportunities": 117,
        "takes": 57
      },
      "14": {
        "opportunities": 46,
        "takes": 37
      }
    }
  },
  "trajectoryOutcomes": {
    "decisionsWithNextObservation": 874,
    "byMove": {
      "otherPlay": {
        "states": 438,
        "opponentHighCardsTaken": 0,
        "averageCardSwing": 1.15,
        "averageHighCardSwing": 0.22,
        "positiveSwingRate": 0.347,
        "opponentTakeRate": 0.313
      },
      "highSingle13": {
        "states": 167,
        "opponentHighCardsTaken": 122,
        "averageCardSwing": 1.79,
        "averageHighCardSwing": -1.22,
        "positiveSwingRate": 0.485,
        "opponentTakeRate": 0.485
      },
      "take": {
        "states": 169,
        "opponentHighCardsTaken": 4,
        "averageCardSwing": -3.49,
        "averageHighCardSwing": 1.67,
        "positiveSwingRate": 0,
        "opponentTakeRate": 0.13
      },
      "highSingle14": {
        "states": 52,
        "opponentHighCardsTaken": 45,
        "averageCardSwing": 1.98,
        "averageHighCardSwing": -1.42,
        "positiveSwingRate": 0.558,
        "opponentTakeRate": 0.558
      },
      "fourOfAKind": {
        "states": 48,
        "opponentHighCardsTaken": 0,
        "averageCardSwing": 4,
        "averageHighCardSwing": -1.5,
        "positiveSwingRate": 1,
        "opponentTakeRate": 0
      }
    }
  }
} as const;

export function getDemonstratedHighPileTakeRate(value: 13 | 14): number {
  const observations = HUMAN_MOVE_TRAINING.highPileChoices[value];
  // Smooth small samples so a single export does not become a hard rule.
  return (observations.takes + 5) / (observations.states + 10);
}

export function getDemonstratedPickupAdjustment(topValue: number): number {
  const topKey = String(topValue) as keyof typeof HUMAN_MOVE_TRAINING.pileTopChoices;
  const observations = HUMAN_MOVE_TRAINING.pileTopChoices[topKey];
  if (!observations) return 0;
  const smoothedRate = (observations.takes + 2) / (observations.states + 8);
  return Math.round((smoothedRate - 0.25) * 140);
}

export function getDemonstratedPickupRate(topValue: number): number {
  const topKey = String(topValue) as keyof typeof HUMAN_MOVE_TRAINING.pileTopChoices;
  const observations = HUMAN_MOVE_TRAINING.pileTopChoices[topKey];
  return observations ? (observations.takes + 2) / (observations.states + 8) : 0.25;
}

export function getDemonstratedQuadCompletionTakeRate(value: 13 | 14): number {
  const observations = HUMAN_MOVE_TRAINING.quadChoices.quadCompletionTakeStats[value];
  return (observations.takes + 1) / (observations.opportunities + 2);
}

export function getDemonstratedQuadBreakShare(value: number): number {
  if (value !== 12 && value !== 13 && value !== 14) return 0;
  return HUMAN_MOVE_TRAINING.quadBreaks.breaksByRank[value] /
    Math.max(1, HUMAN_MOVE_TRAINING.quadBreaks.singleBreaks);
}
