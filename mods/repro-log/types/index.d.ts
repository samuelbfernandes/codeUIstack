/** One recorded step: a command that succeeded, or a file that was edited or written (name only). */
export type Step = {
  kind: 'cmd' | 'file'
  /** The command (secrets masked) or the file path. */
  text: string
  /** When it happened (ms since epoch). */
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'repro-log': {
      /** The ordered steps of this project, oldest first, capped by the maxSteps setting. */
      steps: Step[]
      /** The persisted on/off switch, mirrored here so the moddeck side bar can read it. */
      isOff: boolean
    }
  }
}
