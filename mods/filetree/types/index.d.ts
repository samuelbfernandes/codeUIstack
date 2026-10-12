export type FiletreeEntry = { name: string; path: string; isDir: boolean }

/** One scanned directory: its (capped) entries, how many were left out, whether it was listed at all. */
export type FiletreeDir = { entries: FiletreeEntry[]; more: number; isScanned: boolean }

/** The scanned tree: directories by path relative to the session's directory ('' is the root). */
export type FiletreeTree = {
  root: string
  dirs: Record<string, FiletreeDir>
  /** Entries dropped by the cap, summed over every directory. */
  more: number
  /** True when the cap stopped the scan before every directory was listed. */
  isCapped: boolean
}

/** A path Claude used: read (Read, Grep, Glob) or edit (Edit, Write, MultiEdit, NotebookEdit). */
export type FiletreeTouch = { kind: 'read' | 'edit'; at: number; isCommitted: boolean }

declare module 'claude-code' {
  interface PluginState {
    filetree: {
      tree: FiletreeTree | null
      touched: Record<string, FiletreeTouch>
      expanded: Record<string, boolean>
      tick: number
      /** The one automatic open: not tried yet, waiting for the pane's first drawing, or settled for the session. */
      autoOpen: 'new' | 'checking' | 'done'
    }
  }
}
