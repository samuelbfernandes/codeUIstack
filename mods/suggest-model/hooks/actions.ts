// The three things a person can choose, each written to fail soft: an error is reported in
// a toast or the log and the prompt then goes on untouched.
import type { ConfigRow, ConfigSetResult, ProcessRunInit, ProcessRunResult } from 'claude-code'

import { describeTask } from './gate'
import type { Alias } from './gate'

// The engine validator follows `$` only inside the file that names it, so these helpers take
// small closures built in register.tsx (`run`, `config`, `spawn`) instead of `$` itself.
export type Run = (argv: readonly string[], init?: ProcessRunInit) => Promise<ProcessRunResult>
export type ConfigApi = { list: () => Promise<ConfigRow[]>; set: (key: string, value: string) => Promise<ConfigSetResult> }
export type Spawn = (args: { prompt: string; description: string; model: string }) => Promise<{ deny?: string }>

const CODEX_TIMEOUT_MS = 300_000
const CODEX_PROBE_TIMEOUT_MS = 8_000
const CODEX_MAX_PROMPT_CHARS = 8_000 // argv limits are tight on Windows
const CODEX_MAX_REPLY_CHARS = 20_000

export const CODEX_INSTRUCTIONS =
  'Please review the following request. Try to falsify it rather than confirm it. Cite file:line for every finding, ' +
  'and give PASS, FAIL or UNVERIFIABLE for each claim. Do not edit anything.'

/**
 * The auto-mode classifier sometimes answers an action started by a hook (not by a model request) with "gave no verdict ...
 * Issue the action again once, as-is". That is a transient refusal: the same action is tried once more, never a third time.
 */
export const isNoVerdict = (why: string | undefined): boolean => why !== undefined && /no verdict|issue the action again/i.test(why)

async function retriedOnce<T extends { deny?: string }>(attempt: () => Promise<T>): Promise<T> {
  const first = await attempt()
  return isNoVerdict(first.deny) ? await attempt() : first
}

// ------------------------------------------------------------------- model switch

/**
 * The /config row that holds the session model. Prefer the engine's `model` row; otherwise
 * an ENGINE row whose key or label mentions "model" (never another plugin's `reflect.model`
 * or similar) and which is not about fast mode, subagents or pricing.
 */
export function findModelRow(rows: readonly ConfigRow[]): ConfigRow | undefined {
  const exact = rows.find(r => r.key === 'model')
  if (exact) return exact
  return rows.find(
    r =>
      r.provider.plugin === 'engine' &&
      (r.kind === 'choice' || r.kind === 'text') &&
      /model/i.test(`${r.key} ${r.label}`) &&
      !/fast|small|subagent|agent|plan|pricing|effort|override/i.test(`${r.key} ${r.label}`),
  )
}

/** The row's value for an alias: an exact option, else the shortest option containing it; the alias itself for a free-text row. */
export function valueFor(row: ConfigRow, alias: Alias): string | undefined {
  if (row.options === undefined) return row.kind === 'text' ? alias : undefined
  const lower = alias.toLowerCase()
  const options = row.options
  return (
    options.find(o => o.toLowerCase() === lower) ??
    [...options.filter(o => o.toLowerCase().includes(lower))].sort((a, b) => a.length - b.length)[0]
  )
}

export type SwitchResult = { isSwitched: true } | { isSwitched: false; why: string }

/** Sets the model row; never throws. Callers toast `/model <alias>` on a failure. */
export async function switchModel(config: ConfigApi, alias: Alias): Promise<SwitchResult> {
  try {
    const row = findModelRow(await config.list())
    if (row === undefined) return { isSwitched: false, why: 'no model row in /config' }
    if (row.isLocked) return { isSwitched: false, why: 'the model is set by policy' }
    const value = valueFor(row, alias)
    if (value === undefined) return { isSwitched: false, why: `no ${alias} option in /config` }
    const result = await retriedOnce(() => config.set(row.key, value))
    return result.deny === undefined ? { isSwitched: true } : { isSwitched: false, why: result.deny }
  } catch (error) {
    return { isSwitched: false, why: error instanceof Error ? error.message : 'the change was refused' }
  }
}

export const manualSwitchHint = (alias: Alias): string =>
  `suggest-model: could not switch automatically. Type /model ${alias} yourself.`

// ---------------------------------------------------------------------- subagent

/** Starts the subagent in the background. Never throws: `ok`, or `why` (the engine's own reason, cut short). */
export async function spawnSubagent(spawn: Spawn, text: string, alias: Alias): Promise<{ ok: true } | { ok: false; why: string }> {
  try {
    const r = await retriedOnce(() => spawn({ prompt: text, description: describeTask(text), model: alias }))
    return r.deny === undefined ? { ok: true } : { ok: false, why: String(r.deny).slice(0, 160) }
  } catch (error) {
    return { ok: false, why: (error instanceof Error ? error.message : 'the call failed').slice(0, 160) }
  }
}

// ------------------------------------------------------------------------- codex

/** `codex --version` works? Both a missing program (rejects) and a failing one count as no. */
export async function probeCodex(run: Run): Promise<boolean> {
  try {
    return (await run(['codex', '--version'], { timeoutMs: CODEX_PROBE_TIMEOUT_MS })).exitCode === 0
  } catch {
    return false
  }
}

export type CodexResult = { ok: true; text: string } | { ok: false; why: string }

/** One read-only, ephemeral Codex review of the person's prompt. Best effort: never throws. */
export async function runCodex(run: Run, cwd: string | undefined, prompt: string): Promise<CodexResult> {
  try {
    const body = prompt.length > CODEX_MAX_PROMPT_CHARS ? `${prompt.slice(0, CODEX_MAX_PROMPT_CHARS)} [cut]` : prompt
    const r = await run(
      ['codex', 'exec', '-s', 'read-only', '--ephemeral', ...(cwd ? ['-C', cwd] : []), `${CODEX_INSTRUCTIONS}\n\n${body}`],
      { timeoutMs: CODEX_TIMEOUT_MS },
    )
    const out = r.stdout.trim()
    if (r.exitCode !== 0) return { ok: false, why: firstLine(r.stderr) || `exit code ${r.exitCode}` }
    if (out === '') return { ok: false, why: 'Codex returned nothing' }
    return { ok: true, text: out.length > CODEX_MAX_REPLY_CHARS ? `${out.slice(0, CODEX_MAX_REPLY_CHARS)}\n[cut]` : out }
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : 'could not run codex' }
  }
}

const firstLine = (s: string): string => s.trim().split(/\r?\n/)[0]?.slice(0, 160) ?? ''

export const codexContext = (reply: string): string =>
  `A read-only Codex review of the request above, run before this turn. Treat it as a second opinion: check its claims before relying on them.\n\n${reply}`
