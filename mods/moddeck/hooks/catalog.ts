// What the side bar lists: every mod, one boxed row each (options indented under the row that owns them), then a
// divider, then the skills. Commands are always written with their "/": the slash is required everywhere now.
//
//  - a switch row (`suggest`, `reflect`, `secret-guard`: the ones that work by themselves) is green when on and red when off;
//    a click flips it, and its options (only `suggest` has any) show only while it is on;
//  - any other row runs its command at once (`run`), or puts it in the prompt box when it needs your text or changes something;
//  - a tool with a single task has just the row: no indented button repeats it.

/** A command line as typed, with its slash: `/reflect status`. A text ending in a space waits for the person to finish it. */
export type Action = { text: string; run: boolean }

export type Option = { label: string; costs?: boolean } & Action

export type Group = 'Prompt helpers' | 'Guards' | 'Automation' | 'Model controls' | 'Workspace utilities'
export const GROUPS: Group[] = ['Prompt helpers', 'Guards', 'Automation', 'Model controls', 'Workspace utilities']

export type Tool = {
  id: string
  label: string
  /** Presentation only: the card the row sits in, a one-glyph icon and a short description. None of it changes behaviour. */
  group: Group
  icon: string
  desc?: string
  /** Spends model tokens: drawn with a "$". */
  costs?: boolean
  /** A switch: the command to run with `on` / `off` (`/suggest-model on`). */
  command?: string
  isSwitch?: boolean
  /** What a click does (rows that are not switches). */
  click?: Action
  /** A dropdown of levels, one of them `off`: green while on, red while off. The pick runs `/<command> <level>` at once. */
  levels?: string[]
  /** A row with nothing to type says when it appears instead. */
  note?: string
  /** Under the row: only while a switch is on, always for the others. */
  options?: Option[]
}

export const TOOLS: Tool[] = [
  {
    id: 'suggest',
    label: 'suggest',
    group: 'Prompt helpers',
    icon: '✦',
    desc: 'Checks each prompt against the model',
    isSwitch: true,
    command: 'suggest-model',
    options: [
      { label: 'status', text: '/suggest-model', run: true },
      { label: 'explain a prompt', text: '/suggest-model explain ', run: false },
    ],
  },
  {
    id: 'reflect',
    label: 'reflect',
    group: 'Prompt helpers',
    icon: '◌',
    desc: 'Turns corrections into rules',
    costs: true,
    isSwitch: true,
    command: 'reflect',
  },
  // Each mod keeps its own on/off and answers /<command> on|off; the side bar only reads their state.
  { id: 'secret-guard', label: 'secret-guard', group: 'Guards', icon: '🔒', desc: 'Keeps secrets out of the context', isSwitch: true, command: 'secret-guard' },
  { id: 'data-guard', label: 'data-guard', group: 'Guards', icon: '▤', desc: 'Asks before data files are committed', isSwitch: true, command: 'data-guard' },
  { id: 'big-file-guard', label: 'big-file-guard', group: 'Guards', icon: '▢', desc: 'Cuts large files to their first lines', isSwitch: true, command: 'big-file-guard' },
  {
    id: 'repro-log',
    label: 'repro-log',
    group: 'Guards',
    icon: '☰',
    desc: 'Records a reproducibility recipe',
    isSwitch: true,
    command: 'repro',
    options: [
      { label: 'write the recipe', text: '/repro', run: true },
      { label: 'status', text: '/repro status', run: true },
    ],
  },
  {
    id: 'auto-test',
    label: 'auto-test',
    group: 'Automation',
    icon: '✓',
    desc: 'Runs the tests after edits',
    isSwitch: true,
    command: 'auto-test',
    options: [
      { label: 'run the tests now', text: '/auto-test run', run: true },
      { label: 'status', text: '/auto-test status', run: true },
    ],
  },
  { id: 'long-run-ping', label: 'long-run-ping', group: 'Automation', icon: '◷', desc: 'Pings when a long run ends', isSwitch: true, command: 'long-run-ping' },
  { id: 'blast-radius', label: 'blast-radius', group: 'Model controls', icon: '◎', desc: 'Asks before risky commands', command: 'blast-radius', levels: ['off', 'low', 'medium', 'high'] },
  { id: 'review-cost', label: 'review-cost', group: 'Model controls', icon: '$', desc: 'Shows review cost before a push', command: 'review-cost', levels: ['off', 'on'] },
  {
    id: 'checkpoint',
    label: 'checkpoint',
    group: 'Workspace utilities',
    icon: '⛁',
    desc: 'Snapshots of the working tree',
    click: { text: '/checkpoint', run: true },
    options: [
      { label: 'list', text: '/checkpoint list', run: true },
      { label: 'restore', text: '/checkpoint restore ', run: false },
    ],
  },
  {
    id: 'branch-janitor',
    label: 'branch-janitor',
    group: 'Workspace utilities',
    icon: '⑂',
    desc: 'Offers to delete finished branches',
    click: { text: '/branch-janitor', run: true },
    options: [
      { label: 'clean', text: '/branch-janitor clean', run: false },
      { label: 'off', text: '/branch-janitor off', run: false },
    ],
  },
  {
    id: 'cache-tax',
    label: 'cache-tax',
    group: 'Workspace utilities',
    icon: '♨',
    desc: 'Warns before a cold cache is re-written',
    click: { text: '/cache-tax', run: true },
    options: [
      { label: 'keep the cache warm', costs: true, text: '/keepwarm 90m', run: false },
      { label: 'stop keeping it warm', text: '/keepwarm off', run: false },
    ],
  },
  { id: 'budget-guard', label: 'budget-guard', group: 'Workspace utilities', icon: '▥', desc: 'Usage line and limits', click: { text: '/budget-guard', run: true } },
  { id: 'savvy-progress', label: 'savvy-progress', group: 'Workspace utilities', icon: '▰', desc: 'Plan tasks and subagents', click: { text: '/agents-info', run: true } },
  { id: 'filetree', label: 'filetree', group: 'Workspace utilities', icon: '⌥', desc: 'File tree beside the chat', click: { text: '/filetree', run: true } },
  { id: 'replay-theater', label: 'replay-theater', group: 'Workspace utilities', icon: '▶', desc: 'Step through the last edits', click: { text: '/replay', run: true } },
  { id: 'diagram', label: 'diagram', group: 'Workspace utilities', icon: '◇', desc: 'Draws the last mermaid diagram', click: { text: '/diagram', run: true } },
]

export type Skill = { id: string; label: string; text: string }

export const SKILLS: Skill[] = [
  { id: 'dual-model-review', label: 'dual-model-review', text: 'Use the dual-model-review skill to review my last change' },
  { id: 'agents-md-scaffold', label: 'agents-md-scaffold', text: 'Use the agents-md-scaffold skill to set up AGENTS.md for this repo' },
  { id: 'align', label: 'align', text: 'Use the align skill: interview me before we build ' },
  { id: 'burst', label: 'burst', text: 'Use the burst skill: three versions of ' },
  { id: 'assess-plugin', label: 'assess-plugin', text: 'Use the assess-plugin skill to assess ' },
]

export const priced = (label: string, costs: boolean | undefined): string => (costs ? `$ ${label}` : label)

/** `/reflect status` -> { command: 'reflect', args: 'status' }. */
export function splitCommand(text: string): { command: string; args: string } {
  const body = text.replace(/^\//, '').trim()
  const at = body.indexOf(' ')
  return at === -1 ? { command: body, args: '' } : { command: body.slice(0, at), args: body.slice(at + 1).trim() }
}

/** One saved prompt, as prompt-library keeps it. */
export type SavedPrompt = { name: string; text: string }
