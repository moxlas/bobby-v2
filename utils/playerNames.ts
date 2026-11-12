/**
 * Comparison key for a player's display name.
 *
 * Names are trimmed and compared case-insensitively so that "Bob", "bob", and
 * " Bob " cannot appear as separate seats. Surrounding whitespace is ignored;
 * inner spacing is preserved.
 */
export function playerNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * True when two seats would share the same display name.
 *
 * Blank names are ignored here because they are rejected separately, and a
 * blank is not a name collision.
 */
export function hasDuplicatePlayerNames(players: readonly { name: string }[]): boolean {
  const seen = new Set<string>();

  for (const player of players) {
    const key = playerNameKey(player.name);
    if (!key) continue;
    if (seen.has(key)) return true;
    seen.add(key);
  }

  return false;
}

/** True when `name` already belongs to one of the existing participants. */
export function isPlayerNameTaken(
  players: readonly { name: string }[],
  name: string,
): boolean {
  const key = playerNameKey(name);
  if (!key) return false;
  return players.some(player => playerNameKey(player.name) === key);
}
