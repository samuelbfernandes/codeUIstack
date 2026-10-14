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

declare module 'claude-code' {
  interface PluginState {
    tldr: {
      /** True while off (it ships off). The persisted switch is `$.store` 'on'; mirrored for the moddeck side bar. */
      isOff: boolean
      /** The last long reply's digest; null before the first one, after /clear, or once dismissed. */
      digest: TldrDigest | null
      /** Must-read sentences of this session's recent replies, marked wherever the transcript draws them. */
      marks: string[]
      /** The box above the prompt is folded to one line. */
      isFolded: boolean
    }
  }
}
