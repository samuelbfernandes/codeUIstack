/** Whether `gh` answered `--version` this session; null = not probed yet. */
export type BranchJanitorGh = boolean | null

declare module 'claude-code' {
  interface PluginState {
    'branch-janitor': {
      /** When the open cleanup question was asked (ms since epoch); 0 or absent = no question open. */
      askingSince: number
      hasGh: BranchJanitorGh
      /** Session memory: what was last looked at per directory, and which branch tips `gh` was asked about. */
      memory: Record<string, unknown>
      /** The "watching branches" line was already shown this session. */
      watching: boolean
      /** Off for this repository (git config toolkit.branchJanitor false); null outside a repository. */
      isOff: boolean | null
    }
  }
}
