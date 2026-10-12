/** Counts of what was hidden, by kind. Kinds and numbers only: a secret is never kept. */
export type Tally = {
  /** Hidden in tool output, by kind (`github-token`, `password`...). */
  tool: Record<string, number>
  /** Hidden in typed prompts the person chose to send redacted, by kind. */
  typed: Record<string, number>
  /** Typed prompts held back. */
  held: number
  /** Typed prompts sent as typed after the question. */
  sentAsTyped: number
  /** True once this turn's one-line note was shown. */
  hasAnnounced: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'secret-guard': {
      tally: Tally
      /** The on/off switch as the person last set it; null until read from $.store. */
      isOn: boolean | null
    }
  }
}
