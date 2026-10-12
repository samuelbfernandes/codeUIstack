declare module 'claude-code' {
  interface PluginState {
    checkpoint: {
      /** How many checkpoints are saved in this repository (refs/moddeck/checkpoints), mirrored for the moddeck side bar. */
      count: number
    }
  }
}
