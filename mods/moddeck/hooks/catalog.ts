// What the side bar lists: every mod, one line each inside its group's card (name, then its controls, then a short
// description), then the skills. Commands are always written with their "/": the slash is required everywhere now.
//
//  - a switch (the mods that work by themselves) is its name, green when on and red when off; a click flips it, and its
//    actions show only while it is on;
//  - blast-radius is a switch too (off, or back to its last level) with a dropdown of levels right after the name;
//  - any other name runs its command at once (`run`), or puts it in the prompt box when it needs your text or changes
//    something; a tool with a single task has just its name: no button repeats it.

/** A command line as typed, with its slash: `/reflect status`. A text ending in a space waits for the person to finish it. */
export type Action = { text: string; run: boolean }

export type Option = { label: string; costs?: boolean } & Action

export type Group = 'Prompt helpers' | 'Guards' | 'Automation' | 'Model controls' | 'Workspace utilities' | 'UI development'
/** In drawing order, one card under the other. */
export const GROUPS: Group[] = ['Prompt helpers', 'Model controls', 'Guards', 'Automation', 'Workspace utilities', 'UI development']

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
  /** A dropdown of levels, one of them `off`: the name is green while on, red while off. The pick runs `/<command> <level>` at once. */
  levels?: string[]
  /** A row with nothing to type says when it appears instead. */
  note?: string
  /** Buttons right after the name (keep the labels short: the description gets what is left): only while a switch is on, always for the others. */
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
      { label: 'explain', text: '/suggest-model explain ', run: false },
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
  { id: 'concise', label: 'concise', group: 'Prompt helpers', icon: '»', desc: 'Short, action-first replies', isSwitch: true, command: 'concise' },
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
      { label: 'recipe', text: '/repro', run: true },
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
      { label: 'run', text: '/auto-test run', run: true },
      { label: 'status', text: '/auto-test status', run: true },
    ],
  },
  { id: 'long-run-ping', label: 'long-run-ping', group: 'Automation', icon: '◷', desc: 'Pings when a long run ends', isSwitch: true, command: 'long-run-ping' },
  {
    id: 'format-on-edit',
    label: 'format-on-edit',
    group: 'Automation',
    icon: '¶',
    desc: 'Formats edited files (Air, Ruff, Prettier)',
    isSwitch: true,
    command: 'format-on-edit',
    options: [{ label: 'status', text: '/format-on-edit status', run: true }],
  },
  {
    id: 'test-ledger',
    label: 'test-ledger',
    group: 'Automation',
    icon: '≡',
    desc: 'Test, lint and build runs and results',
    isSwitch: true,
    command: 'test-ledger',
    options: [{ label: 'open', text: '/test-ledger', run: true }],
  },
  {
    id: 'scope-watch',
    label: 'scope-watch',
    group: 'Guards',
    icon: '⌖',
    desc: 'Flags edits outside your folder',
    click: { text: '/scope-watch ', run: false },
    options: [
      { label: 'status', text: '/scope-watch status', run: true },
      { label: 'off', text: '/scope-watch off', run: false },
    ],
  },
  { id: 'blast-radius', label: 'blast-radius', group: 'Model controls', icon: '◎', desc: 'Asks before risky commands', command: 'blast-radius', levels: ['off', 'low', 'medium', 'high'] },
  { id: 'review-cost', label: 'review-cost', group: 'Model controls', icon: '$', desc: 'Shows review cost before a push', isSwitch: true, command: 'review-cost' },
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
      { label: 'warm', costs: true, text: '/keepwarm 90m', run: false },
      { label: 'cool', text: '/keepwarm off', run: false },
    ],
  },
  { id: 'budget-guard', label: 'budget-guard', group: 'Workspace utilities', icon: '▥', desc: 'Usage line and limits', click: { text: '/budget-guard', run: true } },
  { id: 'savvy-progress', label: 'savvy-progress', group: 'Workspace utilities', icon: '▰', desc: 'Plan tasks and subagents', click: { text: '/agents-info', run: true } },
  { id: 'filetree', label: 'filetree', group: 'Workspace utilities', icon: '⌥', desc: 'File tree beside the chat', click: { text: '/filetree', run: true } },
  { id: 'replay-theater', label: 'replay-theater', group: 'Workspace utilities', icon: '▶', desc: 'Step through the last edits', click: { text: '/replay', run: true } },
  { id: 'diagram', label: 'diagram', group: 'Workspace utilities', icon: '◇', desc: 'Draws the last mermaid diagram', click: { text: '/diagram', run: true } },
  { id: 'staged-review', label: 'staged-review', group: 'Workspace utilities', icon: '±', desc: 'What the next commit holds', click: { text: '/staged-review', run: true } },
  {
    id: 'error-inbox',
    label: 'error-inbox',
    group: 'Workspace utilities',
    icon: '!',
    desc: 'The last failed tool calls',
    isSwitch: true,
    command: 'error-inbox',
    options: [{ label: 'open', text: '/error-inbox', run: true }],
  },
  {
    id: 'decision-log',
    label: 'decision-log',
    group: 'Workspace utilities',
    icon: '✎',
    desc: 'docs/DECISIONS.md, one row per decision',
    click: { text: '/decision-log', run: true },
    options: [{ label: 'add', text: '/decision ', run: false }],
  },
  { id: 'csv-table', label: 'csv-table', group: 'Workspace utilities', icon: '▦', desc: 'Preview a csv or tsv file', click: { text: '/csv-table ', run: false } },
  {
    id: 'ui-preview',
    label: 'ui-preview',
    group: 'UI development',
    icon: '▣',
    desc: 'Run the app, list plumber routes, screenshot',
    click: { text: '/ui-preview', run: true },
    options: [
      { label: 'start', text: '/ui-preview start', run: false },
      { label: 'shot', text: '/ui-preview shot', run: true },
    ],
  },
  { id: 'color-lab', label: 'color-lab', group: 'UI development', icon: '◐', desc: 'Contrast and colour formats', click: { text: '/color-lab ', run: false } },
]

export type Skill = { id: string; label: string; desc: string; text: string }

export const SKILLS: Skill[] = [
  { id: 'dual-model-review', label: 'dual-model-review', desc: 'A second model tries to prove a change wrong', text: 'Use the dual-model-review skill to review my last change' },
  { id: 'agents-md-scaffold', label: 'agents-md-scaffold', desc: 'Sets up AGENTS.md, a decisions log, a rubric', text: 'Use the agents-md-scaffold skill to set up AGENTS.md for this repo' },
  { id: 'align', label: 'align', desc: 'Interviews you, writes a spec, hands off', text: 'Use the align skill: interview me before we build ' },
  { id: 'burst', label: 'burst', desc: 'Three graded versions of a text or idea', text: 'Use the burst skill: three versions of ' },
  { id: 'assess-plugin', label: 'assess-plugin', desc: 'Checks a plugin before you install it', text: 'Use the assess-plugin skill to assess ' },
  { id: 'no-ai-text', label: 'no-ai-text', desc: 'Edits AI tells out of a draft, keeps the voice', text: 'Use the no-ai-text skill on this draft: ' },
]

/** Starred items first (in list order), then the rest; unknown stars are ignored. */
export function starFirst<T>(items: readonly T[], starred: readonly string[], idOf: (item: T) => string): T[] {
  const on = new Set(starred)
  return [...items.filter(i => on.has(idOf(i))), ...items.filter(i => !on.has(idOf(i)))]
}

/** Fewest lines a list shows (when it has that many items). */
export const MIN_LIST_ROWS = 5

/** Lines a list shows: enough for every starred item, else the person's pick; at least MIN_LIST_ROWS, never more than it has. */
export function listSize(starredCount: number, picked: number, total: number): number {
  return Math.min(total, Math.max(MIN_LIST_ROWS, starredCount > 0 ? starredCount : picked))
}

/** Starred first, then switches that are on, then the rest; the catalogue order is kept inside each band. */
export function rankTools<T>(items: readonly T[], isStarred: (item: T) => boolean, isOn: (item: T) => boolean): T[] {
  const band = (i: T) => (isStarred(i) ? 0 : 2) + (isOn(i) ? 0 : 1)
  return items.map((item, at) => ({ item, at })).sort((a, b) => band(a.item) - band(b.item) || a.at - b.at).map(x => x.item)
}

/** Toggles one id in the starred list. */
export const toggleStar = (starred: readonly string[], id: string): string[] => (starred.includes(id) ? starred.filter(s => s !== id) : [...starred, id])

/** Lines a list shows: the person's choice for it, else the default; at least MIN_LIST_ROWS, at most MAX_LIST_ROWS. */
export const MAX_LIST_ROWS = 30
export const listRowsOf = (picked: Record<string, number>, id: string, fallback: number): number => Math.max(MIN_LIST_ROWS, Math.min(MAX_LIST_ROWS, Math.floor(picked[id] ?? fallback)))

/** One installed skill as the engine lists it: its name and, when a slash command carries it, that command's line. */
export type InstalledSkill = { name: string; desc?: string }

/** The toolkit's own skills first, then every other installed skill by name; a plugin skill `plug:name` keeps its prefix. */
export function allSkills(installed: readonly InstalledSkill[]): Skill[] {
  const own = new Set(SKILLS.map(k => k.id))
  const seen = new Set<string>()
  const rest: Skill[] = []
  for (const k of installed) {
    const name = k.name.trim()
    if (name === '' || own.has(name) || own.has(name.split(':').pop() ?? '') || seen.has(name)) continue
    seen.add(name)
    rest.push({ id: name, label: name, desc: (k.desc ?? '').replace(/\s+/g, ' ').trim(), text: `Use the ${name} skill ` })
  }
  rest.sort((a, b) => a.label.localeCompare(b.label))
  return [...SKILLS, ...rest]
}

export const priced = (label: string, costs: boolean | undefined): string => (costs ? `$ ${label}` : label)

/** `/reflect status` -> { command: 'reflect', args: 'status' }. */
export function splitCommand(text: string): { command: string; args: string } {
  const body = text.replace(/^\//, '').trim()
  const at = body.indexOf(' ')
  return at === -1 ? { command: body, args: '' } : { command: body.slice(0, at), args: body.slice(at + 1).trim() }
}

/** One saved prompt, as prompt-library keeps it. */
export type SavedPrompt = { name: string; text: string }
