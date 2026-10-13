declare module 'claude-code' {
  interface PluginState {
    'scope-watch': {
      /** The folder being watched, relative to the session's folder (or absolute when outside it); null when none is set. */
      folder: string | null
      /** File edits outside that folder this session (every edit counted, repeats included). */
      outside: number
      /** The distinct paths edited outside the folder this session, as shown (relative where possible), oldest first, at most 50. */
      paths: string[]
      /** The session folder the watched folder belongs to (the `$.store` key is `folder:` + this). */
      root: string
    }
  }
}
