/** One prediction as /model-fit status lists it. The prompt is cut to a short snippet and lives in session memory only. */
export type ModelFitEntry = {
  snippet: string
  tier: 'light' | 'standard' | 'deep' | 'review'
  confidence: number
  reasons: string[]
  /** What happened: why nothing was shown, or the person's answer. */
  outcome: string
}

declare module 'claude-code' {
  interface PluginState {
    'model-fit': {
      /** Prompts from the person checked this session. */
      seen: number
      /** "Keep ... and don't suggest again this session" was chosen. */
      isMuted: boolean
      /** The persisted on/off switch, mirrored here so the band's button redraws when it flips. */
      isOff: boolean
      /** Result of the one `codex --version` probe; null = not probed yet. */
      codexOk: boolean | null
      /** The last predictions, newest last (at most 5). */
      recent: ModelFitEntry[]
    }
  }
}
