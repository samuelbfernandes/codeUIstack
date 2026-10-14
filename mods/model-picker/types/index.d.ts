/** One prediction as /model-picker status lists it. The prompt is cut to a short snippet and lives in session memory only. */
export type SuggestModelEntry = {
  snippet: string
  tier: 'light' | 'standard' | 'deep' | 'review'
  confidence: number
  reasons: string[]
  /** What happened: why nothing was shown, or the person's answer. */
  outcome: string
}

declare module 'claude-code' {
  interface PluginState {
    'model-picker': {
      /** Prompts from the person checked this session. */
      seen: number
      /** "Keep ... and don't suggest again this session" was chosen. */
      isMuted: boolean
      /** The persisted on/off switch, mirrored here so the band's button redraws when it flips. */
      isOff: boolean
      /** Result of the one `codex --version` probe; null = not probed yet. */
      codexOk: boolean | null
      /** The session's effort level as the last main-thread request named it; empty = none seen. Read by effort-watch. */
      effort: string
      /** Short effort advice for the moddeck's model row (`medium would do`, `try high`); empty = the effort fits. */
      effortAdvice: string
      /** The model this conversation was routed to at its first prompt (`Haiku`); '' when not routed. */
      routedTo: string
      /** The last predictions, newest last (at most 5). */
      recent: SuggestModelEntry[]
    }
  }
}
