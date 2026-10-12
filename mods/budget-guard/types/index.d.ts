/** Token and time totals of the main session since budget-guard started watching it. */
export type BudgetTally = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** Cost estimated from the tokens above at rough list prices; used only where the engine keeps no cost ledger. */
  estUsd: number
  /** Main-loop turns finished. */
  turns: number
  /** The longest turn so far, ms (kept apart because the per-turn list is capped). */
  longestMs: number
}

/** One finished main-loop turn: how long it ran and how many tokens it used. */
export type BudgetTurn = { ms: number; tokens: number }

/** One plan rate-limit window as the engine reports it. */
export type BudgetWindow = { kind: string; pct: number; resetsAt?: string }

/** The last usage reading ($.session.usage / session.measure): what the band and the report draw from. */
export type BudgetSnap = {
  /** The engine's own session cost in USD; null where it keeps no ledger. */
  usd: number | null
  ctxPct: number | null
  ctxTokens: number | null
  ctxWindow: number | null
  windows: BudgetWindow[]
}

declare module 'claude-code' {
  interface PluginState {
    'budget-guard': {
      tally: BudgetTally
      /** The newest turns, capped (see MAX_TURNS). */
      turns: BudgetTurn[]
      /** When the running main-loop turn began, ms; null between turns. */
      turnStart: number | null
      /** The limit set by `budget N` for this session; null = use the setting. */
      limit: number | null
      snap: BudgetSnap
    }
  }
}
