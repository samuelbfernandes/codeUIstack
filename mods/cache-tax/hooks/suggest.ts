// Which way forward costs least once the cache has gone cold. A plugin cannot delete or warm the cache after the
// fact; what it can do is point at the cheapest next step. These are rules of thumb, not measured prices.

export type Move = 'send' | 'compact' | 'clear'

/** A context this big is worth shrinking: /compact reads it once, and every later message re-writes far less. */
export const COMPACT_AT_TOKENS = 100_000
/** After this long away the next message is most likely a new task, and a fresh conversation re-writes nothing. */
export const FRESH_AFTER_MS = 6 * 60 * 60 * 1000

export function bestMove(tokens: number, idleMs: number): { move: Move; why: string } {
  if (idleMs >= FRESH_AFTER_MS) return { move: 'clear', why: 'after this long it is likely a new task, and a fresh start re-writes nothing' }
  if (tokens >= COMPACT_AT_TOKENS) return { move: 'compact', why: 'a big context: compacting pays the re-read once, then every message is cheaper' }
  return { move: 'send', why: 'a small context: compacting would cost about as much as sending' }
}
