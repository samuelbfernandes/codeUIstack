declare module 'claude-code' {
  interface PluginState {
    'long-run-ping': {
      /** The persisted on/off switch, mirrored here so the moddeck side bar can read it. */
      isOff: boolean
    }
  }
}
