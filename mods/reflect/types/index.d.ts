export type Scope = 'project' | 'global'

/** A rule the small model proposed, waiting for the person's decision. */
export type Proposal = { rule: string; scope: Scope }

declare module 'claude-code' {
  interface PluginState {
    reflect: {
      /** The one rule on offer, or null. Newest wins; a prompt submit clears it. */
      proposal: Proposal | null
      /** True while the band shows the Input to edit the rule. */
      isEditing: boolean
      /** Counts prompt submits; a model reply for an older count is stale. */
      seq: number
      /** The persisted on/off switch, mirrored for the toolbox side bar. */
      isOff: boolean
    }
  }
}
