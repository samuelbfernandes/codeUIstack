/** What the last run came to: idle (none yet), running, pass or fail. */
export type AutoTestLast = 'idle' | 'running' | 'pass' | 'fail'

declare module 'claude-code' {
  interface PluginState {
    'auto-test': {
      /** True while auto-test is off (it ships off). The persisted switch is `$.store` 'on'; loaded at session.start. */
      isOff: boolean
      /** The state of the last run, for the moddeck side bar. */
      last: AutoTestLast
    }
  }
}
