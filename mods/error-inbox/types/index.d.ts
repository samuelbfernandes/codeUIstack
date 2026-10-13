/** refused: a hook or plugin turned the call down; denied: the person or a permission rule did; failed: it ran and errored. */
export type ErrorInboxKind = 'refused' | 'denied' | 'failed'

/** One failed or refused tool call. */
export type ErrorInboxEntry = {
  /** Unique within the session. */
  id: string
  tool: string
  kind: ErrorInboxKind
  /** The command or file path only, secrets replaced by ***, at most 200 characters; '' for other tools. */
  input: string
  /** The error as the model read it, secrets replaced by ***, at most 600 characters. */
  error: string
  /** When it came back, ms since the epoch. */
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'error-inbox': {
      /** The last 30, oldest first. Memory only: gone when the session ends. */
      entries: ErrorInboxEntry[]
      /** The persisted on/off switch (`$.store` 'off'), mirrored so the moddeck side bar can read it. */
      isOff: boolean
    }
  }
}
