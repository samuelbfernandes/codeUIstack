declare module 'claude-code' {
  interface PluginState {
    'review-cost': {
      /** The persisted on/off switch ($.store 'off'), mirrored here so the moddeck side bar can show it. Default false (on). */
      isOff: boolean
    }
  }
}
