export type AsideStatus = 'thinking' | 'done' | 'failed'

/** One side question as the pane shows it. Plain JSON: it lives in $.state. */
export type AsideEntry = {
  id: number
  /** When it was asked (ms since epoch); an entry still thinking long after this is treated as lost. */
  at: number
  question: string
  status: AsideStatus
  /** The answer, cut to the maxAnswerChars setting; empty until done. */
  answer: string
  /** The answer was cut. */
  isCut: boolean
  /** Input + output + cache tokens the fork reported; null until it answers. */
  tokens: number | null
  /** Why there is no answer (a short plain phrase); empty otherwise. */
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    aside: {
      /** Newest first, at most five. */
      asides: AsideEntry[]
      /** The persisted on/off switch, mirrored here so the band's chip redraws when it flips. */
      isOff: boolean
    }
  }
}
