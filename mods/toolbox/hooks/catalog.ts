// What the side bar lists: every mod, one boxed row each; then the skills; then each mod's options, indented.
// A mod with an on/off switch is drawn as a green/red row (read live from its own state, only when this side bar can
// see it) and a click flips it at once through its own command. Every other click puts a command in the prompt box.

/** The mods whose switch the side bar can read; register.tsx names each state, so the list of reads can be checked. */
export type SwitchId = 'aside' | 'suggest' | 'reflect' | 'secret-guard'

/** A command put in the prompt box. A text ending in a space waits for the person to finish it. */
export type Fill = { label: string; text: string; costs?: boolean }

export type Tool = {
  id: string
  label: string
  /** Spends model tokens: drawn with a "$". */
  costs?: boolean
  /** A switch: `command` is run with `on` / `off`. */
  switchId?: SwitchId
  command?: string
  /** The main click for a row that is not a switch. */
  fill?: string
  /** The row is the skin dropdown. */
  isSkin?: boolean
  /** A row with nothing to type says when it appears instead. */
  note?: string
  /** Shown below the tools, indented under the mod's name. */
  options?: Fill[]
}

export const TOOLS: Tool[] = [
  { id: 'aside', label: 'aside', costs: true, switchId: 'aside', command: 'aside', options: [{ label: 'ask a side question', text: '/aside ', costs: true }] },
  {
    id: 'suggest',
    label: 'suggest',
    switchId: 'suggest',
    command: 'suggest-model',
    options: [
      { label: 'status', text: 'suggest-model' },
      { label: 'explain a prompt', text: '/suggest-model explain ' },
    ],
  },
  { id: 'reflect', label: 'reflect', costs: true, switchId: 'reflect', command: 'reflect', options: [{ label: 'status', text: 'reflect status' }] },
  { id: 'secret-guard', label: 'secret-guard', switchId: 'secret-guard', command: 'secret-guard', options: [{ label: 'status', text: 'secret-guard' }] },
  { id: 'skin', label: 'skin', isSkin: true, options: [{ label: 'list the skins', text: 'skins' }] },
  { id: 'blast-radius', label: 'blast-radius', note: 'appears before a risky command' },
  { id: 'review-cost', label: 'review-cost', note: 'appears before a push is reviewed' },
  { id: 'branch-janitor', label: 'branch-janitor', fill: 'branch-janitor', options: [{ label: 'clean', text: 'branch-janitor clean' }, { label: 'off', text: 'branch-janitor off' }] },
  { id: 'cache-tax', label: 'cache-tax', fill: 'cache-tax', options: [{ label: 'keep the cache warm', text: '/keepwarm 90m', costs: true }, { label: 'stop keeping it warm', text: '/keepwarm off' }] },
  { id: 'budget-guard', label: 'budget-guard', fill: 'usage', options: [{ label: 'set a $10 limit', text: 'budget 10' }] },
  { id: 'savvy-progress', label: 'savvy-progress', fill: 'agents-info', options: [{ label: 'helper tree', text: 'agents tree' }] },
  { id: 'filetree', label: 'filetree', fill: 'filetree' },
  { id: 'replay-theater', label: 'replay-theater', fill: 'replay' },
  { id: 'diagram', label: 'diagram', fill: 'diagram', options: [{ label: 'close', text: 'diagram close' }] },
]

export type Skill = { id: string; label: string; text: string }

export const SKILLS: Skill[] = [
  { id: 'dual-model-review', label: 'dual-model-review', text: 'Use the dual-model-review skill to review my last change' },
  { id: 'agents-md-scaffold', label: 'agents-md-scaffold', text: 'Use the agents-md-scaffold skill to set up AGENTS.md for this repo' },
]

/** tool-skins' theme names, in its own order. */
export const SKINS = ['noir', 'tokyo-night', 'dracula', 'catppuccin', 'gruvbox', 'nord', 'solarized-dark']

export const priced = (label: string, costs: boolean | undefined): string => (costs ? `$ ${label}` : label)
