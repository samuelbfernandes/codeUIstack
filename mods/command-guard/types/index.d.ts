/** The runtime sensitivity: off = never ask, low = ask for everything, medium = from medium up, high = only high. */
export type BlastLevel = 'off' | 'low' | 'medium' | 'high'

declare module 'claude-code' {
  interface PluginState {
    'command-guard': {
      /** The persisted runtime level (`$.store` 'level'), mirrored here so other mods, such as the moddeck side bar, can read it. Overrides the askFrom setting. */
      level: BlastLevel
    }
  }
}
