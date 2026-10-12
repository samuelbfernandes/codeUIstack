// moddeck: a side bar with the toolkit's mods and skills, one boxed row each. A switch (green on, red off) flips at once by
// running the mod's own command; the skin dropdown switches at once through /skin; a row runs its command at once when
// that is harmless, or puts it in the prompt box (`$.prompt.fill`) when it needs your text or changes something.
// Nothing here spends tokens or sends a prompt by itself.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { SKILLS, SKINS, TOOLS, priced, splitCommand } from './catalog'
import type { Action, SavedPrompt, Tool } from './catalog'
import { linkedWorktree, parseStatusV2 } from './gitinfo'
import type { GitInfo } from './gitinfo'
import {
  DEFAULT_BOX,
  DEFAULT_ROWS,
  EMPTY_ACTIVITY,
  ROW_IDS,
  buildRows,
  finishRun,
  hideRow,
  layoutLines,
  parseRows,
  providerOf,
  showRow,
  startRun,
  targetOf,
} from './sessionrows'
import type { Activity, BoxSettings, EnvCounts, Layout, RowId, Snapshot, TokenTotals } from './sessionrows'

type Dollar = EngineInterface

const PANE = 'moddeck'
const TITLE = 'Moddeck'
const COLUMNS = 40
const HINT = 'Side panel · use /tui fullscreen'
const FAILED = 'Moddeck · could not open'
const PANE_SURFACES = new Set(['terminal', 'desktop'])

const autoOpen = atom({ plugin: 'moddeck', key: 'autoOpen' } as const, 'new')
/** First row shown in each scrolling list (`skills`, `prompts`): a list scrolls a few rows at a time when it has many. */
const tops = atom({ plugin: 'moddeck', key: 'tops' } as const, {} as Record<string, number>)
const DEFAULT_SKILL_ROWS = 4
/** What the person last picked in a dropdown here (`skin`, `blast-radius`, `review-cost`): the pick shows at once, even where the other mod's state is not watched for redraws. */
const picks = atom({ plugin: 'moddeck', key: 'picks' } as const, {} as Record<string, string>)

// ---- the Session box: what is kept in memory (never in the transcript), and read by the pane ---------------------------------
type MeasureAtom = {
  context: { tokens?: number; window?: number; percent?: number }
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: number
}
type MetaAtom = { model?: string; effort?: string | number; provider?: string; startedAt?: number; breakdown?: { name: string; tokens: number }[] }
/** The latest figures `session.measure` raised (or `session.usage()` gave at start). */
const measure = atom({ plugin: 'moddeck', key: 'measure' } as const, null as MeasureAtom | null)
const meta = atom({ plugin: 'moddeck', key: 'meta' } as const, {} as MetaAtom)
/** Git state of the working directory, refreshed at session start and after each turn; null = not a repository. */
const gitState = atom({ plugin: 'moddeck', key: 'git' } as const, null as GitInfo | null)
const tokenTotals = atom({ plugin: 'moddeck', key: 'tokens' } as const, null as TokenTotals | null)
const activity = atom({ plugin: 'moddeck', key: 'activity' } as const, EMPTY_ACTIVITY as Activity)
const envCounts = atom({ plugin: 'moddeck', key: 'env' } as const, null as EnvCounts | null)
/** The rows shown (a comma list in display order) and the layout, as /moddeck rows set them; null = not set by the person (the settings apply). */
const rowsList = atom({ plugin: 'moddeck', key: 'rows' } as const, null as string | null)
const layoutPick = atom({ plugin: 'moddeck', key: 'layout' } as const, null as Layout | null)

const LEDGER = { plugin: 'budget-guard', key: 'ledger' } as const
const CACHE = { plugin: 'cache-tax', key: 'cache' } as const

const HELP = [
  'Moddeck · /moddeck shows or hides the side bar',
  `/moddeck rows list · hide <id> · show <id> · compact · expanded`,
  `ids: ${ROW_IDS.join(', ')}`,
].join('\n')

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback
}

function defer($: Dollar, work: () => Promise<void>): void {
  $.clock.after(1, () => {
    work().catch(() => undefined)
  })
}

// The other mods' state this side bar reads. The engine wants each reference written out here, so the list of what a
// module reads can be checked; a mod that is not installed (or a read that is refused) reads as "cannot see".
const SUGGEST_OFF = { plugin: 'suggest-model', key: 'isOff' } as const
const REFLECT_OFF = { plugin: 'reflect', key: 'isOff' } as const
const SECRET_ON = { plugin: 'secret-guard', key: 'isOn' } as const
const SKIN = { plugin: 'tool-skins', key: 'theme' } as const
const DATA_OFF = { plugin: 'data-guard', key: 'isOff' } as const
const BIGFILE_OFF = { plugin: 'big-file-guard', key: 'isOff' } as const
const REPRO_OFF = { plugin: 'repro-log', key: 'isOff' } as const
const AUTOTEST_OFF = { plugin: 'auto-test', key: 'isOff' } as const
const PING_OFF = { plugin: 'long-run-ping', key: 'isOff' } as const
const PROMPTS = { plugin: 'prompt-library', key: 'items' } as const
const BLAST_LEVEL = { plugin: 'blast-radius', key: 'level' } as const
const REVIEW_OFF = { plugin: 'review-cost', key: 'isOff' } as const

async function valueOf(read: Promise<unknown>): Promise<unknown> {
  try {
    return ((await read) as { value?: unknown } | undefined)?.value
  } catch {
    return undefined
  }
}

const firstLine = (text: string | undefined): string => (text ?? '').split('\n')[0]?.trim() ?? ''

/** Show a command's reply: its first line as a toast, the whole text in the transcript. */
function show($: Dollar, text: string | undefined, fallback: string): void {
  const body = (text ?? '').trim()
  $.ui.toast(firstLine(body) || fallback)
  if (body.includes('\n')) $.ui.log(body)
}

/** A switch click: run the mod's own `on` / `off` at once. */
async function flip($: Dollar, s: Tool, isOn: boolean): Promise<void> {
  try {
    const out = (await $.command.run({ command: s.command ?? s.id, args: isOn ? 'off' : 'on' })) as { text?: string } | undefined
    show($, out?.text, `${s.label} · ${isOn ? 'off' : 'on'}`)
  } catch {
    $.ui.toast(`Moddeck · could not switch ${s.label}`)
  }
}

/** Run the command now, or (when it needs your text or changes something) put it in the prompt box; nothing is sent. */
async function act($: Dollar, action: Action): Promise<void> {
  const typed = action.text.trim()
  try {
    if (action.run) {
      const { command, args } = splitCommand(action.text)
      const out = (await $.command.run({ command, args })) as { text?: string } | undefined
      show($, out?.text, `Moddeck · ${typed}`)
      return
    }
    const out = (await $.prompt.fill({ text: action.text } as never)) as { isFilled?: boolean } | undefined
    if (out?.isFilled === false) $.ui.toast(`Moddeck · type it yourself: ${typed}`)
  } catch {
    $.ui.toast(action.run ? `Moddeck · could not run ${typed}` : `Moddeck · type it yourself: ${typed}`)
  }
}

/** A dropdown pick: remember it for the drawing, then run the mod's own command with it. */
async function pick($: Dollar, id: string, command: string, value: string): Promise<void> {
  await safe(() => update($, picks, p => ({ ...p, [id]: value })))
  try {
    const out = (await $.command.run({ command, args: value })) as { text?: string } | undefined
    $.ui.toast(firstLine(out?.text) || `${command} · ${value}`)
  } catch {
    $.ui.toast(`Moddeck · could not set ${command} to ${value}`)
  }
}

async function safe(f: () => Promise<unknown>): Promise<void> {
  try {
    await f()
  } catch {
    // a pick is still run; only its early redraw is lost
  }
}

async function isPaneOpen($: Dollar): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === PANE)
}

async function toggle($: Dollar): Promise<string> {
  await update($, autoOpen, () => 'done') // the person has taken over: never open it for them after this
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    return 'Moddeck · closed'
  }
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
  return opened.isPlaced ? 'Moddeck · open' : 'Moddeck · waiting for room\nTry /tui fullscreen, or a wider window.'
}

/** Once per session, from a timer: open where there is room; whether it docked is settled by its first drawing. */
async function autoOpenPane($: Dollar): Promise<void> {
  if ((await read($, autoOpen)) !== 'new') return
  await update($, autoOpen, () => 'done')
  if (await isPaneOpen($)) return
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
  if (opened.isPlaced) await update($, autoOpen, () => 'checking')
  else await $.ui.close({ id: PANE })
}

async function settleAutoOpen($: Dollar, placement: 'dock' | 'inline'): Promise<void> {
  if ((await read($, autoOpen)) !== 'checking') return
  await update($, autoOpen, () => 'done')
  if (placement !== 'dock') await $.ui.close({ id: PANE })
}


// ---- gathering the Session box's figures: every source is tried on its own and a failure only drops its row ----------------
async function attempt<T>(f: () => Promise<T>): Promise<T | undefined> {
  try {
    return await f()
  } catch {
    return undefined
  }
}

async function storedText($: Dollar, key: string): Promise<string | undefined> {
  const v = await attempt(() => $.store.get(key))
  return typeof v === 'string' ? v : undefined
}

async function nowOf($: Dollar): Promise<number> {
  const t = await attempt(() => $.clock.now())
  return typeof t === 'number' && Number.isFinite(t) ? t : Date.now()
}

function contextOf(c: { tokens?: number; window?: number; percent?: number } | undefined): MeasureAtom['context'] {
  return { tokens: c?.tokens, window: c?.window, percent: c?.percent }
}

/** `git status` and `rev-parse`, read-only and short; not a repository (or no git) leaves the atom null. */
async function refreshGit($: Dollar): Promise<void> {
  let info: GitInfo | null = null
  try {
    const st = await $.process.run(['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch'], { timeoutMs: 4000 })
    if (st.exitCode === 0) info = parseStatusV2(st.stdout) ?? null
    if (info) {
      const rev = await attempt(() => $.process.run(['git', 'rev-parse', '--git-dir', '--git-common-dir'], { timeoutMs: 2000 }))
      const worktree = rev && rev.exitCode === 0 ? linkedWorktree(rev.stdout) : undefined
      if (worktree) info = { ...info, worktree }
    }
  } catch {
    info = null
  }
  await safe(() => update($, gitState, () => info))
}

/** CLAUDE.md files (the project root and its parents up to home, plus ~/.claude/CLAUDE.md), rules, MCP servers, hooks, plugins. */
async function countEnvironment($: Dollar): Promise<EnvCounts> {
  const out: EnvCounts = {}
  const home = await attempt(() => $.env.get('HOME'))
  const found = await attempt(() => $.fs.ancestors({ names: ['CLAUDE.md'] }))
  if (found) {
    const inHome = found.filter(f => !home || f.dir === home || f.dir.startsWith(`${home}/`))
    let n = inHome.length
    if (home) {
      const own = await attempt(() => $.fs.read(`${home}/.claude/CLAUDE.md`))
      if (typeof own === 'string') n++
    }
    out.claudeMd = n
  }
  const rules = await attempt(() => $.fs.list('.claude/rules'))
  if (rules) out.rules = rules.filter(r => r.kind === 'file' && r.name.endsWith('.md')).length
  const settings = (await attempt(() => $.settings.read())) as Record<string, unknown> | undefined
  const servers = new Set<string>()
  const norm = (n: string) => n.replace(/[^a-zA-Z0-9]/g, '_')
  const tools = await attempt(() => $.tool.list())
  for (const t of tools ?? []) {
    const name = t.mcp ? t.name.slice(5).split('__')[0] : undefined
    if (name) servers.add(norm(name))
  }
  if (settings?.mcpServers && typeof settings.mcpServers === 'object') for (const k of Object.keys(settings.mcpServers)) servers.add(norm(k))
  if (tools !== undefined || settings !== undefined) out.mcp = servers.size
  if (settings) {
    const hooks = settings.hooks
    if (hooks && typeof hooks === 'object') {
      out.hooks = Object.values(hooks as Record<string, unknown>).reduce<number>(
        (n, entries) => n + (Array.isArray(entries) ? entries.reduce<number>((m, en) => m + (Array.isArray((en as { hooks?: unknown })?.hooks) ? (en as { hooks: unknown[] }).hooks.length : 1), 0) : 0),
        0,
      )
    }
    const plugins = settings.enabledPlugins
    if (plugins && typeof plugins === 'object') out.plugins = Object.values(plugins as Record<string, unknown>).filter(v => v === true).length
  }
  return out
}

/** Once per session, from a timer: load what /moddeck rows saved, and read the model, provider, start time, environment and git. */
async function primeSession($: Dollar): Promise<void> {
  const rows = await storedText($, 'rows')
  if (rows !== undefined) await safe(() => update($, rowsList, () => rows))
  const layout = await storedText($, 'layout')
  if (layout === 'compact' || layout === 'expanded') await safe(() => update($, layoutPick, () => layout))

  const usage = await attempt(() => $.session.usage())
  const model = (await attempt(async () => ((await $.config.list()).find(r => r.key === 'model')?.value))) ?? (await attempt(() => $.session.model()))
  const env = async (name: string, f: () => Promise<string | undefined>) => (await attempt(f)) ?? ((await attempt(() => $.settings.read())) as { env?: Record<string, string> } | undefined)?.env?.[name]
  const provider = providerOf({
    bedrock: await env('CLAUDE_CODE_USE_BEDROCK', () => $.env.get('CLAUDE_CODE_USE_BEDROCK')),
    vertex: await env('CLAUDE_CODE_USE_VERTEX', () => $.env.get('CLAUDE_CODE_USE_VERTEX')),
    foundry: await env('CLAUDE_CODE_USE_FOUNDRY', () => $.env.get('CLAUDE_CODE_USE_FOUNDRY')),
    baseUrl: await env('ANTHROPIC_BASE_URL', () => $.env.get('ANTHROPIC_BASE_URL')),
  })
  await safe(() =>
    update($, meta, m => ({
      ...m,
      model: m.model ?? (typeof model === 'string' && model !== '' ? model : undefined),
      provider,
      startedAt: typeof usage?.startedAt === 'number' ? usage.startedAt : m.startedAt,
    })),
  )
  if (usage) await safe(() => update($, measure, m => m ?? { context: contextOf(usage.context), rateLimits: usage.rateLimits ?? [], cost: usage.cost?.usd }))
  const counts = await attempt(() => countEnvironment($))
  if (counts) await safe(() => update($, envCounts, () => counts))
  await refreshGit($)
}

/** The biggest used categories of the window, from the engine's own local estimate (`summary`: no model or token-count call). */
async function breakdownOf($: Dollar): Promise<{ name: string; tokens: number }[] | undefined> {
  const u = await attempt(() => $.session.usage({ breakdown: 'summary' }))
  const cats = u?.context.breakdown?.categories
  if (!cats) return undefined
  return cats
    .filter(c => c.kind === 'used' && c.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 3)
    .map(c => ({ name: c.name, tokens: c.tokens }))
}

async function observeMeasure($: Dollar, e: { context: MeasureAtom['context']; rateLimits: MeasureAtom['rateLimits']; cost?: { usd: number }; changed: readonly string[] }): Promise<void> {
  await update($, measure, () => ({ context: contextOf(e.context), rateLimits: e.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })), cost: e.cost?.usd }))
  const percent = e.context.percent ?? 0
  if (percent >= 85 && e.changed.includes('context')) {
    const breakdown = await breakdownOf($)
    await update($, meta, m => ({ ...m, breakdown }))
  } else if (percent < 85) {
    const held = (await read($, meta)).breakdown
    if (held !== undefined) await update($, meta, m => ({ ...m, breakdown: undefined }))
  }
}

/** The settings the Session box reads, settled once at load. */
type Conf = { showSession: boolean; layout: Layout; rows: string; box: Omit<BoxSettings, 'width'> }

/** What is shown now: the person's /moddeck rows choice (this session's, else saved), else the settings. */
async function currentRows($: Dollar, c: Conf): Promise<RowId[]> {
  const picked = (await read($, rowsList)) ?? (await storedText($, 'rows')) ?? c.rows
  return parseRows(picked)
}
async function currentLayout($: Dollar, c: Conf): Promise<Layout> {
  const picked = (await read($, layoutPick)) ?? (await storedText($, 'layout'))
  return picked === 'compact' || picked === 'expanded' ? picked : c.layout
}

/** `/moddeck rows ...`: change the Session box and keep it (in this plugin's store). Unknown words change nothing. */
async function rowsCommand($: Dollar, c: Conf, words: string[]): Promise<string> {
  const [verb, id] = [words[0] ?? 'list', words[1]?.toLowerCase()]
  const shownNow = await currentRows($, c)
  const describe = async () => {
    const shown = await currentRows($, c)
    const hidden = ROW_IDS.filter(r => !shown.includes(r))
    return `Rows: ${shown.join(', ') || 'none'}${hidden.length > 0 ? `\nHidden: ${hidden.join(', ')}` : ''}\nLayout: ${await currentLayout($, c)}`
  }
  if (verb === 'list' && words.length <= 1) return describe()
  if ((verb === 'compact' || verb === 'expanded') && words.length === 1) {
    await update($, layoutPick, () => verb)
    await attempt(() => $.store.set('layout', verb))
    return `Moddeck · rows ${verb}`
  }
  if ((verb === 'hide' || verb === 'show') && words.length === 2 && id !== undefined && (ROW_IDS as readonly string[]).includes(id)) {
    const next = (verb === 'hide' ? hideRow(shownNow, id as RowId) : showRow(shownNow, id as RowId)).join(',')
    await update($, rowsList, () => next)
    await attempt(() => $.store.set('rows', next))
    return `Moddeck · ${verb === 'hide' ? 'hid' : 'showing'} ${id}\n${await describe()}`
  }
  return HELP
}


/** Everything the Session box could show right now; a source that fails or is absent leaves its field out. */
async function snapshotOf($: Dollar): Promise<Snapshot> {
  const now = await nowOf($)
  let m = await read($, measure)
  const held = await read($, meta)
  let startedAt = held.startedAt
  if (m === null || startedAt === undefined) {
    const u = await attempt(() => $.session.usage())
    if (u) {
      startedAt = typeof u.startedAt === 'number' ? u.startedAt : startedAt
      m = m ?? { context: contextOf(u.context), rateLimits: u.rateLimits ?? [], cost: u.cost?.usd }
    }
  }
  const ledger = await valueOf($.state.get(LEDGER as never))
  const cache = await valueOf($.state.get(CACHE as never))
  const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined)
  const l = obj(ledger)
  const c = obj(cache)
  const nn = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : v === null ? null : undefined)
  return {
    now,
    model: held.model,
    provider: held.provider,
    effort: held.effort,
    startedAt,
    context: m?.context,
    breakdown: held.breakdown,
    rateLimits: m?.rateLimits,
    cost: m?.cost,
    ledger: l ? { today: nn(l.today) ?? undefined, week: nn(l.week) } : undefined,
    cache: c ? { expiresAt: nn(c.expiresAt), hitRate: nn(c.hitRate) } : undefined,
    git: await read($, gitState),
    tokens: await read($, tokenTotals),
    activity: await read($, activity),
    env: await read($, envCounts),
  }
}


export const register: Register = (on, options) => {
  const isAutoOpen = options.autoOpen !== false
  const rows = typeof options.skillRows === 'number' && options.skillRows >= 1 ? Math.floor(options.skillRows) : DEFAULT_SKILL_ROWS
  const conf: Conf = {
    showSession: options.showSession !== false,
    layout: options.sessionLayout === 'compact' ? 'compact' : 'expanded',
    rows: typeof options.sessionRows === 'string' ? options.sessionRows : DEFAULT_ROWS,
    box: {
      sevenDayAt: num(options.usageSevenDayAt, DEFAULT_BOX.sevenDayAt),
      toolsMaxVisible: Math.max(1, Math.floor(num(options.toolsMaxVisible, DEFAULT_BOX.toolsMaxVisible))),
      pushWarn: Math.max(1, num(options.pushWarn, DEFAULT_BOX.pushWarn)),
      envThreshold: num(options.envThreshold, DEFAULT_BOX.envThreshold),
    },
  }
  const showSession = conf.showSession

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'moddeck', description: 'Show or hide the moddeck side bar; "rows" sets what its Session box shows' })
    } catch {
      // the side bar can still be opened another way
    }
    if (showSession) defer($, () => primeSession($)) // reading only: never blocks the start
    if (isAutoOpen && e.isInteractive && e.surface !== null && PANE_SURFACES.has(e.surface)) defer($, () => autoOpenPane($))
    return next(e)
  })

  on('command.run', { command: 'moddeck' }, async ($, e) => {
    const words = String((e as { args?: unknown }).args ?? '').trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return { text: await toggle($) }
    if (words[0]!.toLowerCase() === 'rows') return { text: await rowsCommand($, conf, words.slice(1).map(w => w.toLowerCase())) }
    return { text: HELP }
  }).catch(() => ({ text: FAILED }))

  // ---- observers for the Session box: each lets the event through first (or, for a step, before it), and only keeps books ----
  on('session.measure', async ($, e, next) => {
    const out = await next(e)
    try {
      await observeMeasure($, e as never)
    } catch {
      // the box shows the last figures it had
    }
    return out
  })

  // A step streams, so this hook is a generator that forwards the stream untouched; the books are kept from a timer, off its path.
  on('turn.step', async function* ($, e, next) {
    try {
      defer($, async () => {
        if (e.agentId !== undefined) return // a subagent's model is not the session's
        const held = await read($, meta)
        if (held.model !== e.model || held.effort !== e.effort) await update($, meta, m => ({ ...m, model: e.model, effort: e.effort }))
      })
    } catch {
      // the model row keeps what it had
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const out = await next(e)
    try {
      if (e.agentId === undefined) {
        const u = e.usage
        if (u) {
          const tps = e.durationMs >= 500 && u.output_tokens > 0 ? u.output_tokens / (e.durationMs / 1000) : undefined
          await update($, tokenTotals, t => ({
            input: (t?.input ?? 0) + u.input_tokens,
            output: (t?.output ?? 0) + u.output_tokens,
            cacheRead: (t?.cacheRead ?? 0) + u.cache_read_input_tokens,
            cacheWrite: (t?.cacheWrite ?? 0) + u.cache_creation_input_tokens,
            tokensPerSecond: tps ?? t?.tokensPerSecond,
          }))
        }
        if (showSession) defer($, () => refreshGit($))
      }
    } catch {
      // the totals keep their last value
    }
    return out
  })

  on('tool.call', async ($, e, next) => {
    const id = String((e as { tool_use_id?: unknown }).tool_use_id ?? '')
    const name = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const target = name === 'Skill' && typeof input.skill === 'string' ? input.skill : targetOf(input)
    try {
      void update($, activity, a => startRun(a, { id, name, target, state: 'running' })).catch(() => undefined)
    } catch {
      // nothing is kept for this call
    }
    const out = await next(e)
    try {
      const failed = (out as { isError?: boolean; deny?: unknown } | undefined)?.isError === true || (out as { deny?: unknown } | undefined)?.deny !== undefined
      await update($, activity, a => finishRun(a, id, failed ? 'error' : 'done'))
    } catch {
      // a call may stay marked running
    }
    return out
  }).catch(($, e, next) => next(e)) // a failed book-keeping never refuses the call

  on('session.compact', async ($, e, next) => {
    const out = await next(e)
    try {
      const done = e.agentId === undefined && e.trigger !== 'precompute' && typeof (out as { skip?: unknown } | undefined)?.skip !== 'string'
      if (done) await update($, activity, a => ({ ...a, compactions: a.compactions + 1 }))
    } catch {
      // the count keeps its last value
    }
    return out
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Select, Text } = $.ui.resolve(e)
    if ((await read($, autoOpen)) === 'checking') defer($, () => settleAutoOpen($, e.props.placement))
    const isInline = e.props.placement === 'inline' || e.viewport?.isFullscreen === false
    if (e.surface === 'terminal' && isInline) return <Text dimColor>{HINT}</Text>

    // The Session box at the top: live figures from the engine, each row hidden when its figure is missing.
    let sessionBox: unknown = null
    if (showSession) {
      try {
        const settings: BoxSettings = { ...conf.box, width: Math.max(20, e.props.bodyColumns - 6) }
        const built = buildRows(await snapshotOf($), settings)
        const shown = (await currentRows($, conf)).map(id => built[id]).filter((r): r is NonNullable<typeof r> => r !== undefined)
        const lines = layoutLines(shown, await currentLayout($, conf), settings.width)
        if (lines.length > 0) {
          sessionBox = (
            <Box key="session" flexDirection="column" borderStyle="round" paddingX={1}>
              <Text bold>Session</Text>
              {lines.map(l => (
                <Box key={`session:row:${l.key}`}>
                  {l.parts.map((p, i) => (
                    <Text key={`session:part:${l.key}:${i}`} color={p.color} dimColor={p.dim} bold={p.bold} wrap="truncate-end">
                      {p.text}
                    </Text>
                  ))}
                </Box>
              ))}
            </Box>
          )
        }
      } catch {
        sessionBox = null // the side bar still draws without it
      }
    }

    // Switches: only the ones whose state this side bar can read; the pill is the button.
    // Each switch reads its own mod's state; a mod that is not installed (or not readable) is simply not drawn.
    const flag = (v: unknown, isOff: boolean): boolean | undefined => (typeof v === 'boolean' ? (isOff ? !v : v) : undefined)
    const ons: Record<string, boolean | undefined> = {
      suggest: flag(await valueOf($.state.get(SUGGEST_OFF as never)), true),
      reflect: flag(await valueOf($.state.get(REFLECT_OFF as never)), true),
      'secret-guard': flag(await valueOf($.state.get(SECRET_ON as never)), false),
      'data-guard': flag(await valueOf($.state.get(DATA_OFF as never)), true),
      'big-file-guard': flag(await valueOf($.state.get(BIGFILE_OFF as never)), true),
      'repro-log': flag(await valueOf($.state.get(REPRO_OFF as never)), true),
      'auto-test': flag(await valueOf($.state.get(AUTOTEST_OFF as never)), true),
      'long-run-ping': flag(await valueOf($.state.get(PING_OFF as never)), true),
    }
    const skin = await valueOf($.state.get(SKIN as never))
    const blast = await valueOf($.state.get(BLAST_LEVEL as never))
    const reviewOff = await valueOf($.state.get(REVIEW_OFF as never))
    const chosen = await read($, picks)
    // The level each dropdown shows: the person's last pick, else the mod's own state; undefined = the mod is not readable.
    const levelOf: Record<string, string | undefined> = {
      'blast-radius': chosen['blast-radius'] ?? (typeof blast === 'string' ? blast : undefined),
      'review-cost': chosen['review-cost'] ?? (typeof reviewOff === 'boolean' ? (reviewOff ? 'off' : 'on') : undefined),
    }

    // A press lands on the text of a Button, so the text is padded to the row's width and a click anywhere on the row works.
    // (A desktop draws narrower spaces than a terminal does, so it gets more.)
    const room = Math.max(0, Math.round((e.props.bodyColumns - 6) * (e.surface === 'desktop' ? 1.35 : 1)))
    const fill = (text: string) => text + '\u00a0'.repeat(Math.max(0, room - text.length))

    // Every row is a box with a round border, one per row.
    const row = (key: string, child: unknown, color?: string) => (
      <Box key={key} borderStyle="round" borderColor={color} paddingX={1}>
        {child as never}
      </Box>
    )
    const button = (key: string, label: string, action: Action, costs?: boolean) => (
      <Button key={key} plain onPress={() => act($, action)}>
        <Text wrap="truncate-end">{fill(priced(label, costs))}</Text>
      </Button>
    )
    // Options sit right under their row, indented. Two or more, never one: a lone task is the row itself.
    const optionsOf = (t: Tool) =>
      (t.options ?? []).length > 0 && (
        <Box key={`options:${t.id}`} flexDirection="column" paddingLeft={4}>
          {(t.options ?? []).map(o => button(`option:${t.id}:${o.text}`, o.label, o, o.costs))}
        </Box>
      )

    const tools = TOOLS.flatMap(t => {
      if (t.isSkin) {
        // tool-skins keeps its theme in state only once one has been picked, so an unset one reads as the default.
        const theme = chosen.skin ?? (typeof skin === 'string' ? skin : SKINS[0]!)
        return [
          row(
            'row:skin',
            <Select key="skin" label="Skin " value={SKINS.includes(theme) ? theme : SKINS[0]!} options={SKINS.map(name => ({ value: name }))} onSelect={(name: string) => pick($, 'skin', 'skin', name)} />,
          ),
        ]
      }
      if (t.levels !== undefined) {
        // blast-radius and review-cost work by themselves: a dropdown of levels, one of them off; green while on, red while off.
        const level = levelOf[t.id]
        if (level === undefined) return [] // not installed, or not readable: not drawn
        const bg = level === 'off' ? 'error' : 'success'
        return [
          <Box key={`row:${t.id}`} borderStyle="round" borderColor={bg} backgroundColor={bg} paddingX={1}>
            <Select key={`level:${t.id}`} label={`${t.label} `} value={level} options={t.levels.map(v => ({ value: v }))} onSelect={(v: string) => pick($, t.id, t.command ?? t.id, v)} />
          </Box>,
        ]
      }
      if (t.isSwitch) {
        const isOn = ons[t.id]
        if (isOn === undefined) return [] // not installed, or not readable: not drawn
        const bg = isOn ? 'success' : 'error'
        return [
          <Box key={`row:${t.id}`} borderStyle="round" borderColor={bg} backgroundColor={bg} paddingX={1}>
            <Button key={`switch:${t.id}`} plain onPress={() => flip($, t, isOn)}>
              <Text bold color="inverseText" backgroundColor={bg} wrap="truncate-end">
                {fill(`${priced(t.label, t.costs)} · ${isOn ? 'on' : 'off'}`)}
              </Text>
            </Button>
          </Box>,
          ...(isOn ? [optionsOf(t)] : []), // the options show only while the switch is green
        ]
      }
      if (t.click !== undefined) return [row(`row:${t.id}`, button(`tool:${t.id}`, t.label, t.click, t.costs)), optionsOf(t)]
      return [row(`row:${t.id}`, <Text dimColor>{`${t.label} · ${t.note ?? 'runs by itself'}`}</Text>)]
    })

    // A list with its own scroll: `rows` rows at a time, with ▲ / ▼ buttons, only when there are more.
    const scrolled = await read($, tops)
    const windowed = (id: string, items: unknown[], draw: (item: never) => unknown) => {
      const many = items.length > rows
      const top = Math.max(0, Math.min(scrolled[id] ?? 0, items.length - rows))
      const scrollTo = (to: number) => update($, tops, t => ({ ...t, [id]: Math.max(0, Math.min(to, items.length - rows)) }))
      const shown = items.slice(many ? top : 0, many ? top + rows : undefined).map(draw as never)
      const scroller = many && (
        <Box key={`${id}:scroll`} gap={2}>
          <Button key={`${id}:up`} plain onPress={() => scrollTo(top - 1)}>
            <Text dimColor={top === 0}>▲ up</Text>
          </Button>
          <Text dimColor>{`${top + 1}–${Math.min(top + rows, items.length)} of ${items.length}`}</Text>
          <Button key={`${id}:down`} plain onPress={() => scrollTo(top + 1)}>
            <Text dimColor={top + rows >= items.length}>▼ down</Text>
          </Button>
        </Box>
      )
      return { shown, scroller }
    }
    const skillList = windowed('skills', SKILLS, ((k: (typeof SKILLS)[number]) => row(`row:skill:${k.id}`, button(`skill:${k.id}`, k.label, { text: k.text, run: false }))) as never)

    // Saved prompts (prompt-library): a click puts the text in the prompt box. Not drawn while that mod is not readable.
    const saved = await valueOf($.state.get(PROMPTS as never))
    const prompts: SavedPrompt[] = Array.isArray(saved)
      ? (saved as unknown[]).filter((p): p is SavedPrompt => typeof (p as SavedPrompt)?.name === 'string' && typeof (p as SavedPrompt)?.text === 'string')
      : []
    const promptList = windowed('prompts', prompts, ((p: SavedPrompt) => row(`row:prompt:${p.name}`, button(`prompt:${p.name}`, p.name, { text: p.text, run: false }))) as never)

    return (
      <Box flexDirection="column" gap={1}>
        {sessionBox as never}
        <Box flexDirection="column">
          <Text bold>Tools</Text>
          <Text dimColor>Green or red: click to switch (dropdowns pick a level). Others: click to run, or to put it in the prompt box when it needs your text</Text>
          {tools}
        </Box>
        <Text dimColor wrap="truncate-end">{'─'.repeat(300)}</Text>
        <Box flexDirection="column">
          <Text bold>Skills</Text>
          {skillList.scroller}
          {skillList.shown}
        </Box>
        {prompts.length > 0 && (
          <Box flexDirection="column">
            <Text bold>Prompts</Text>
            <Text dimColor>Click to put it in the prompt box · /prompts to add or remove</Text>
            {promptList.scroller}
            {promptList.shown}
          </Box>
        )}
        <Text dimColor>$ = spends model tokens</Text>
      </Box>
    )
  })
}
