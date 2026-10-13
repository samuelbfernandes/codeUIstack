declare module 'claude-code' {
  interface PluginState {
    'format-on-edit': {
      /** True while format-on-edit is off (it ships off). The persisted switch is `$.store` 'on'; loaded at session.start. */
      isOff: boolean
      /** Files a formatter changed this session. */
      formatted: number
    }
  }
}
