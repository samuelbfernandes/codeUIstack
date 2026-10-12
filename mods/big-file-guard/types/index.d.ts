declare module 'claude-code' {
  interface PluginState {
    'big-file-guard': {
      /** Approximate tokens kept out of the conversation this session (bytes / 4, minus what was shown). */
      saved: number
      /** The persisted on/off switch (`$.store` 'off'), mirrored so the moddeck side bar can read it. */
      isOff: boolean
    }
  }
}
