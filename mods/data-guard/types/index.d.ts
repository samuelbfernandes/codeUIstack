/** What data-guard counted this session. Plain numbers; never a path or a value. */
export type DataGuardTally = {
  /** git commit / git add commands looked at. */
  checked: number
  /** Questions asked. */
  asked: number
  /** Commands held (Hold it, Fix it, Esc). */
  held: number
  /** Notebooks stripped of outputs. */
  stripped: number
}

declare module 'claude-code' {
  interface PluginState {
    'data-guard': {
      /** The persisted on/off switch ($.store 'off'), mirrored here so the moddeck side bar can read it. */
      isOff: boolean
      tally: DataGuardTally
    }
  }
}
