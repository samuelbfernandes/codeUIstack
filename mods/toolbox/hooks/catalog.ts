// What the side bar lists. Switches are read live from each mod's own state (only the ones this side bar can see are
// drawn); a click runs that mod's own command at once. Everything else is put in the prompt box for the person to send.

/** A mod with an on/off switch the side bar can read (register.tsx names its state); `isOn` reads it (undefined = cannot tell). */
export type Switch = {
  id: 'aside' | 'suggest' | 'reflect' | 'secret-guard'
  label: string
  command: string
  isOn: (value: unknown) => boolean | undefined
  /** Spends model tokens when on: drawn with a "$". */
  costs: boolean
}

const offFlag = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? !value : undefined)
const onFlag = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined)

export const SWITCHES: Switch[] = [
  { id: 'aside', label: 'aside', command: 'aside', isOn: offFlag, costs: true },
  { id: 'suggest', label: 'suggest', command: 'suggest-model', isOn: offFlag, costs: false },
  { id: 'reflect', label: 'reflect', command: 'reflect', isOn: offFlag, costs: true },
  { id: 'secret-guard', label: 'secret-guard', command: 'secret-guard', isOn: onFlag, costs: false },
]

/** An item that fills the prompt box. A text ending in a space waits for the person to finish it. */
export type Fill = { id: string; label: string; text: string; costs: boolean }

export const TOOLS: Fill[] = [
  { id: 'aside-ask', label: 'aside · ask a side question', text: '/aside ', costs: true },
  { id: 'suggest-explain', label: 'suggest · test a prompt', text: '/suggest-model explain ', costs: false },
  { id: 'branch-janitor', label: 'branch-janitor · finished branches', text: 'branch-janitor', costs: false },
  { id: 'cache-tax', label: 'cache-tax · cache status', text: 'cache-tax', costs: false },
  { id: 'usage', label: 'budget-guard · usage report', text: 'usage', costs: false },
  { id: 'agents', label: 'savvy-progress · helper agents', text: 'agents-info', costs: false },
  { id: 'filetree', label: 'filetree · file tree', text: 'filetree', costs: false },
  { id: 'replay', label: 'replay-theater · replay edits', text: 'replay', costs: false },
  { id: 'diagram', label: 'diagram · draw the last mermaid', text: 'diagram', costs: false },
  { id: 'reflect-status', label: 'reflect · status', text: 'reflect status', costs: false },
]

export const SKILLS: Fill[] = [
  { id: 'dual-model-review', label: 'dual-model-review', text: 'Use the dual-model-review skill to review my last change', costs: false },
  { id: 'agents-md-scaffold', label: 'agents-md-scaffold', text: 'Use the agents-md-scaffold skill to set up AGENTS.md for this repo', costs: false },
]

/** tool-skins' theme names, in its own order. */
export const SKINS = ['noir', 'tokyo-night', 'dracula', 'catppuccin', 'gruvbox', 'nord', 'solarized-dark']

export const priced = (label: string, costs: boolean): string => (costs ? `$ ${label}` : label)
