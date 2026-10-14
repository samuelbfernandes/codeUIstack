declare module 'claude-code' {
  interface PluginState {
    concise: {
      /** True while off (it ships off). The persisted switch is `$.store` 'on'; mirrored so the moddeck side bar can read it. */
      isOff: boolean
    }
  }
}
