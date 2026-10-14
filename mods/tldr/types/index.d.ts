/** What the small model made of the last long reply. */
export type TldrDigest = {
  /** Two or three plain sentences. */
  summary: string
  /** Decisions, questions or warnings that need the reader. */
  needs: string[]
  /** What happens next, or what the reader should do. */
  next: string[]
  /** Sentences copied word for word from the reply that must not be skipped; each one is marked in the transcript. */
  mustRead: string[]
}

/** What the reader sees while on: the must-read sentences only, or those plus the TL;DR box above the prompt. */
export type TldrMode = 'highlight' | 'summary'

declare module 'claude-code' {
  interface PluginState {
    tldr: {
      /** True while off (it ships off). The persisted switch is `$.store` 'on'; mirrored for the moddeck side bar. */
      isOff: boolean
      /** The mode while on (`summary` ships as the default). Persisted as `$.store` 'mode'; mirrored for the moddeck side bar. */
      mode: TldrMode
      /** The tint of the paragraphs that hold a must-read sentence in the app (green by default). Persisted as `$.store` 'color'. */
      color: 'red' | 'yellow' | 'olive' | 'green' | 'blue' | 'purple' | 'plum'
      /** The last long reply's digest; null before the first one, after /clear, or once dismissed. */
      digest: TldrDigest | null
      /** Must-read sentences of this session's recent replies, marked wherever the transcript draws them. */
      marks: string[]
      /** The box above the prompt is folded to one line. */
      isFolded: boolean
    }
  }
}
