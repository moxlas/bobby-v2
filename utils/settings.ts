import { DEFAULT_OPTIONS, GameOptions } from '../types/game';

const STORAGE_KEY = 'bobby-settings';

interface PlayerSetup {
  name: string;
  isAI: boolean;
}

interface SettingsData {
  players: PlayerSetup[];
  options: GameOptions;
}

export function loadSettings(): SettingsData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SettingsData;
  } catch {
    return null;
  }
}

export function saveSettings(players: PlayerSetup[], options: GameOptions): void {
  const data: SettingsData = { players, options };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // storage full or unavailable
  }
}

/**
 * Quick Play is a personal preference. Persist it from wherever it is toggled
 * (the pause menu, including online rooms) without touching the other options.
 */
export function saveSkipConfirmations(value: boolean): void {
  const saved = loadSettings();
  try {
    saveSettings(saved?.players ?? [], { ...(saved?.options ?? DEFAULT_OPTIONS), skipConfirmations: value });
  } catch {
    // storage full or unavailable
  }
}
