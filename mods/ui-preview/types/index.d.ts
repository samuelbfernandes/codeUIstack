/** Which kind of app ui-preview runs. */
export type UiPreviewKind = 'plumber' | 'npm' | 'shiny-r' | 'shiny-py' | 'streamlit'
/** The app found (or named): its kind, the file, its folder (relative to the project root, '' for the root), a label. */
export type UiPreviewApp = { kind: UiPreviewKind; file: string; dir: string; label: string }
/** stopped: no child; starting: started, URL not answering yet; running: it answers; silent: no answer within 60 s; exited: the child ended. */
export type UiPreviewStatus = 'stopped' | 'starting' | 'running' | 'silent' | 'exited'
/** One plumber route from /openapi.json. */
export type UiPreviewRoute = { method: string; path: string; summary: string }
/** The last screenshot: the PNG's absolute path and a number that changes with its content. */
export type UiPreviewShot = { path: string; generation: number }

declare module 'claude-code' {
  interface PluginState {
    'ui-preview': {
      /** Where the app stands, for the pane and the moddeck side bar. */
      status: UiPreviewStatus
      /** The app's local URL ('' before a start). */
      url: string
      app: UiPreviewApp | null
      /** The child's last 60 output lines, secret-looking values replaced by ***. */
      lines: string[]
      /** Plumber routes (method, path, summary), at most 200. */
      routes: UiPreviewRoute[]
      shot: UiPreviewShot | null
      /** The last thing said (a failure, where a draft went). */
      note: string
    }
  }
}
