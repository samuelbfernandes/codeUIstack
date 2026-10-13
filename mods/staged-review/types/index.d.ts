/** What the last `/staged-review` (or Refresh) read from git, already bounded for drawing. */
export type StagedReviewReport = {
  /** The path the person named, '' for the whole index. */
  path: string
  /** `git diff --cached --stat` output, bounded. */
  stat: string
  /** `git diff --cached` output, bounded. */
  diff: string
  /** True when nothing is staged (for this path). */
  isEmpty: boolean
  /** True when the stat or the diff was cut to fit the pane. */
  isCut: boolean
  /** Why git could not be read ('' when it could): not a repository, git missing, a timeout. */
  error: string
  /** When it was read, ms since the epoch. */
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'staged-review': {
      /** The last reading, or null before the first `/staged-review`. */
      report: StagedReviewReport | null
    }
  }
}
