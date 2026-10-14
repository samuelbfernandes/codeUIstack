export type CacheTaxActivity = {
  /** Last turn.start / turn.complete of the main loop, ms; 0 = unknown. */
  at: number
  /** Last keepwarm ping that touched the cache, ms; 0 = none. */
  pingAt: number
  /** Last known context size in tokens; 0 = unknown. */
  tokens: number
}

export type CacheTaxKeepwarm = {
  startedAt: number
  until: number
  intervalMs: number
  pings: number
  /** Estimated cost of the pings so far, USD. */
  usd: number
  /** Consecutive failed pings. */
  failures: number
  /** Cache-read tokens the last ping reported; null before the first. */
  lastCacheRead: number | null
  /** The last ping paid a cache write instead of a read (the cache had lapsed). */
  lastWasCold: boolean
}

export type CacheTaxTotals = {
  /** Cache-read and cache-write tokens summed over completed main-loop turns (from turn.complete usage). */
  read: number
  write: number
  /** Last completed turn: all four counts summed, and its output tokens; 0 = no turn yet. */
  lastTokens: number
  lastOut: number
  /** Uncached input tokens summed over the same turns (for the session hit rate). */
  input: number
}

export type CacheTaxCache = {
  /** When the main conversation's prompt cache goes cold, in $.clock.now() ms; null when unknown or before the first response. */
  expiresAt: number | null
  /** Cache-read share of all input tokens this session, 0-100, one decimal; null before the first response. */
  hitRate: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'cache-guard': {
      activity: CacheTaxActivity
      isBusy: boolean
      /** The prompt that was stopped once; the same text again passes. */
      held: { text: string } | null
      /** Set when a prompt passed after the TTL: the next turn.complete prices the write. */
      cold: { tokens: number } | null
      paid: { count: number; usd: number }
      totals: CacheTaxTotals
      /** Display mirror for other mods: the cache's expiry clock time and the hit rate. */
      cache: CacheTaxCache
      /** The '/keepwarm 90m' hint was shown in a cold-cache question this session. */
      hinted: boolean
      keepwarm: CacheTaxKeepwarm | null
    }
  }
}
