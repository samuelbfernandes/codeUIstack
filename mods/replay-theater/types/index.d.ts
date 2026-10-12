export type Change = { old: string; new: string }

export type Edit = {
  id: number
  /** The turn counter value when the edit ran (see `turn` in the state). */
  turn: number
  path: string
  /** Edit, Write, MultiEdit or NotebookEdit. */
  tool: string
  changes: Change[]
  /** Write only: the file did not exist before. */
  created?: boolean
  /** One line shown under the header (what could not be captured, etc.). */
  note?: string
  /** Contents were cut to keep memory small. */
  truncated?: boolean
}

export type Ready = { turn: number; edits: number; files: number }

/** What the pane shows: the edits of one turn, or of the whole session. */
export type View = { scope: 'turn' | 'all'; turn: number; i: number }

declare module 'claude-code' {
  interface PluginState {
    'replay-theater': {
      edits: Edit[]
      /** Counts turn.start events; edits carry the value current when they ran. */
      turn: number
      /** Turns that ran a Bash command which looks like it modifies files. */
      shellTurns: number[]
      ready: Ready | null
      view: View | null
      /** When the turn hint last showed, ms; 0 = not yet this session. */
      hintAt: number
    }
  }
}
