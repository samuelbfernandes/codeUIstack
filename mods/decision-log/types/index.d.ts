/** One row of docs/DECISIONS.md, cells unescaped for display. */
export type DecisionLogRow = { id: string; date: string; decision: string; rationale: string; status: string }

/** What `/decision-log` (or the last `/decision`) read from docs/DECISIONS.md. */
export type DecisionLogView = {
  /** The file's full path. */
  path: string
  /** The last 20 rows, in file order. */
  rows: DecisionLogRow[]
  /** How many rows the table has in all. */
  total: number
  /** True when the file does not exist yet. */
  isMissing: boolean
  /** Why it could not be read ('' when it could). */
  error: string
}

declare module 'claude-code' {
  interface PluginState {
    'decision-log': {
      /** The last reading of docs/DECISIONS.md, or null before the first. */
      view: DecisionLogView | null
    }
  }
}
