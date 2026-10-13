export type TestLedgerKind = 'test' | 'lint' | 'build' | 'format' | 'check'

/** One finished check command Claude ran through Bash. */
export type TestLedgerRun = {
  /** Unique within the session. */
  id: string
  kind: TestLedgerKind
  /** The tool(s) recognised: 'pytest', 'cargo clippy', 'Rscript', 'npm run build + eslint'. */
  tool: string
  /** The command, secrets replaced by ***, cut to 200 characters. */
  command: string
  /** pass: the Bash call succeeded; fail: it returned an error (non-zero exit) or was interrupted; background: moved to the background, outcome unknown. */
  status: 'pass' | 'fail' | 'background'
  /** The exit code when the failed result names one. */
  exitCode?: number
  /** When it ended, ms since the epoch. */
  at: number
  /** How long the call took, ms. */
  ms: number
}

declare module 'claude-code' {
  interface PluginState {
    'test-ledger': {
      /** The last 40 runs, oldest first. Memory only: gone when the session ends. */
      runs: TestLedgerRun[]
      /** The persisted on/off switch (`$.store` 'off'), mirrored so the moddeck side bar can read it. */
      isOff: boolean
    }
  }
}
