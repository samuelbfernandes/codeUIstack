/** The automatic open of the side bar, once per session. */
export type AutoOpen = 'new' | 'checking' | 'done'

declare module 'claude-code' {
  interface PluginState {
    moddeck: {
      /** The one automatic open: 'new' until tried, 'checking' until the first drawing says whether it docked, then 'done'. */
      autoOpen: AutoOpen
      /** Index of the first skill shown; the skills list scrolls when there are more than fit. */
      skillTop: number
    }
  }
}
