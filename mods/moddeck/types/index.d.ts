/** One saved prompt, as prompt-library keeps it. */
export type SavedPrompt = { name: string; text: string }
/** One side question in the Side Question panel. */
export type BtwEntry = { id: number; at: number; question: string; status: 'thinking' | 'done' | 'failed'; answer: string; isCut: boolean; tokens: number | null; note: string }
/** The automatic open of the side bar, once per session. */
export type AutoOpen = 'new' | 'checking' | 'done'
/** How the Session box lays its rows out. */
export type DeckLayout = 'expanded' | 'compact'
/** The latest `session.measure` figures (or `session.usage()` at start); a figure the engine did not give is absent. */
export type DeckMeasure = {
  context: { tokens?: number; window?: number; percent?: number }
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: number
}
/** What the Session box's model row shows, plus the window's biggest categories while it is nearly full. */
export type DeckMeta = { model?: string; effort?: string | number; provider?: string; startedAt?: number; breakdown?: { name: string; tokens: number }[] }
/** The working directory's git state (porcelain v2): counts are files, each counted once. */
export type DeckGit = {
  branch: string
  isDetached: boolean
  ahead: number
  behind: number
  hasUpstream: boolean
  modified: number
  added: number
  deleted: number
  untracked: number
  conflicts: number
  worktree?: string
}
/** Session token totals (main loop) and the last turn's output speed. */
export type DeckTokens = { input: number; output: number; cacheRead: number; cacheWrite: number; tokensPerSecond?: number }
/** The last tool calls (bounded), the skills and MCP servers used, and the compactions seen. */
export type DeckActivity = {
  runs: { id: string; name: string; target?: string; state: 'running' | 'done' | 'error' }[]
  skills: string[]
  mcp: Record<string, number>
  compactions: number
}
/** What the environment row counts; a field the engine did not give is absent. */
export type DeckEnv = { claudeMd?: number; rules?: number; mcp?: number; hooks?: number; plugins?: number }

declare module 'claude-code' {
  interface PluginState {
    moddeck: {
      /** The one automatic open: 'new' until tried, 'checking' until the first drawing says whether it docked, then 'done'. */
      autoOpen: AutoOpen
      /** Index of the first row shown in each scrolling list (`skills`, `prompts`): moved by the scroll bar and the wheel. */
      tops: Record<string, number>
      /** What the person last picked in the dropdown (`blast-radius`), and the level its switch goes back to (`blast-radius:last`). */
      picks: Record<string, string>
      /** The Session box's latest figures; null before any. */
      measure: DeckMeasure | null
      /** Model, effort, provider, start time and (nearly full) breakdown for the model and context rows. */
      meta: DeckMeta
      /** Git state, refreshed at start and after each turn; null = not a repository. */
      git: DeckGit | null
      /** Session token totals; null until a turn reported usage. */
      tokens: DeckTokens | null
      /** Recent tool calls, skills, MCP servers and compactions (in memory only). */
      activity: DeckActivity
      /** Counts for the environment row; null until read. */
      env: DeckEnv | null
      /** Rows shown, a comma list in display order, as `/moddeck rows` set it (also kept in the store as `rows`); null = the settings apply. */
      rows: string | null
      /** The last few side questions and answers of the Side Question panel, newest first (in memory only). */
      btw: BtwEntry[]
      /** A newer release than the installed one, not yet updated to; null = none known. */
      updateAvail: string | null
      /** The newest commit or checkpoint (ms); null = none; undefined = not read. */
      backupAt: number | null | undefined
      /** The permission mode from the settings. */
      permMode: string | undefined
      /** The Side Question panel is expanded. */
      btwOpen: boolean
      /** The text in the Side Question's Ask here field, emptied after asking and by ✕ close. */
      btwDraft: string
      /** Lines each list shows (`skills`, `prompts`), as its more/fewer buttons set it (also kept in the store); null = not loaded. */
      listRows: Record<string, number> | null
      /** Starred skill ids, drawn at the top of the Skills box (also kept in the store); null = not loaded. */
      starred: string[] | null
      /** Every skill the session has (name, and the matching slash command's line), read once from the engine; null = not read yet. */
      installedSkills: { name: string; desc?: string }[] | null
      /** The pane is shown wide (the expand button); false = its usual width. */
      wide: boolean
      /** The Session box layout as `/moddeck rows compact|expanded` set it (also kept in the store as `layout`); null = the settings apply. */
      layout: DeckLayout | null
      /** The desktop app's side bar colours as `/moddeck theme light|dark` set them (also kept in the store as `theme`); null = the `appTheme` setting. */
      theme: 'light' | 'dark' | null
    }
  }
}
