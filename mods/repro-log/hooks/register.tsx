import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Step } from '../types'
import {
  MANIFESTS, addStep, cleanCommand, isAnalysis, isSecretFile, maxStepsOf, programsOf, relPath,
  renderRecipe, runtimesFor, seedsOf, stamp,
} from './lib'

type Dollar = EngineInterface

const COMMAND = 'repro'
const DIR = '.moddeck/repro'

const steps = atom({ plugin: 'repro-log', key: 'steps' } as const, [])
/** Mirror of the persisted on/off switch (`$.store` 'off'), read by the moddeck side bar. */
const isOff = atom({ plugin: 'repro-log', key: 'isOff' } as const, false)

type Cfg = { isEnabled: boolean; max: number; programs: string[][] }

const cwdOf = async ($: Dollar): Promise<string> => {
  try {
    return await $.session.cwd()
  } catch {
    return ''
  }
}

const keyOf = (cwd: string) => `steps:${cwd}`

async function save($: Dollar, list: Step[]): Promise<void> {
  try {
    await $.store.set(keyOf(await cwdOf($)), list)
  } catch {
    // kept in memory only
  }
}

async function recordStep($: Dollar, cfg: Cfg, kind: Step['kind'], text: string): Promise<void> {
  if ((await $.store.get('off')) === true) return
  const step: Step = { kind, text, at: await $.clock.now() }
  const next = addStep(await read($, steps), step, cfg.max)
  await update($, steps, () => next)
  await save($, next)
}

/** Looks at a finished tool call. Never throws, never changes the call. */
async function observe($: Dollar, cfg: Cfg, tool: string, e: Record<string, unknown>, ran: Record<string, unknown>): Promise<void> {
  if (!cfg.isEnabled || ran.deny !== undefined || ran.isError === true) return
  if (tool === 'Bash') {
    const result = ran.result as { interrupted?: boolean } | undefined
    if (result?.interrupted === true) return
    const command = e.command
    if (typeof command !== 'string' || !isAnalysis(command, cfg.programs)) return
    const clean = cleanCommand(command)
    if (clean !== undefined) await recordStep($, cfg, 'cmd', clean)
    return
  }
  const raw = tool === 'NotebookEdit' ? e.notebook_path : e.file_path
  if (typeof raw !== 'string' || raw === '' || isSecretFile(raw)) return
  await recordStep($, cfg, 'file', relPath(raw, await cwdOf($)))
}

const first = (s: string) => s.split('\n').find(l => l.trim() !== '')?.trim() ?? ''

async function run($: Dollar, argv: string[]): Promise<string> {
  try {
    const r = await $.process.run(argv, { timeoutMs: 10_000 })
    return r.exitCode === 0 ? r.stdout : ''
  } catch {
    return ''
  }
}

async function versionLine($: Dollar, argv: string[]): Promise<string> {
  try {
    const r = await $.process.run(argv, { timeoutMs: 10_000 })
    return r.exitCode === 0 ? first(r.stdout !== '' ? r.stdout : r.stderr) : ''
  } catch {
    return ''
  }
}

async function writeRecipe($: Dollar, list: Step[]): Promise<string> {
  const now = await $.clock.now()
  const commands = list.filter(s => s.kind === 'cmd').map(s => s.text)
  const files = [...new Set(list.filter(s => s.kind === 'file').map(s => s.text))]

  const commit = first(await run($, ['git', 'rev-parse', 'HEAD']))
  const dirty = commit === '' ? undefined : (await run($, ['git', 'status', '--porcelain'])).trim() !== ''

  const versions: string[] = []
  for (const r of runtimesFor(commands)) {
    const argv = r === 'python3' ? ['python3', '--version'] : r === 'R' ? ['R', '--version'] : ['node', '--version']
    const v = await versionLine($, argv)
    if (v !== '') versions.push(v)
  }

  const manifests: { name: string; sha: string }[] = []
  for (const name of MANIFESTS) {
    try {
      if (!(await $.fs.exists(name))) continue
    } catch {
      continue
    }
    manifests.push({ name, sha: first(await run($, ['shasum', '-a', '256', name])).split(/\s+/)[0] ?? '' })
  }

  const text = renderRecipe({ at: now, commit, isDirty: dirty, versions, manifests, seeds: seedsOf(commands), commands, files })
  const path = `${DIR}/${stamp(now)}.md`
  await $.fs.write(path, text)
  return [
    `Repro · saved ${path}`,
    `${commands.length} command${commands.length === 1 ? '' : 's'} · ${files.length} changed file${files.length === 1 ? '' : 's'}`,
    commit === '' ? 'No git commit found' : `Git ${commit.slice(0, 7)} · ${dirty ? 'dirty' : 'clean'}`,
  ].join('\n')
}

async function flip($: Dollar, off: boolean): Promise<string> {
  try {
    if (off) await $.store.set('off', true)
    else await $.store.delete('off')
    await update($, isOff, () => off)
  } catch {
    return 'Repro · that did not work, nothing changed'
  }
  return off ? 'Repro · off · nothing is recorded · /repro on turns it back on' : 'Repro · on'
}

async function runRepro($: Dollar, cfg: Cfg, args: string): Promise<string> {
  const word = args.trim().toLowerCase()
  if (!cfg.isEnabled) return 'Repro · disabled · the enabled setting is false (change it in /config)'
  if (word === 'on') return flip($, false)
  if (word === 'off') return flip($, true)
  const list = await read($, steps)
  const off = (await read($, isOff)) === true
  if (word === 'status') return `Repro · ${list.length} step${list.length === 1 ? '' : 's'} recorded · recording is ${off ? 'off' : 'on'}`
  if (word === 'clear') {
    await update($, steps, () => [])
    await save($, [])
    return 'Repro · cleared'
  }
  if (word !== '') return 'Repro · use /repro, /repro status, /repro clear, /repro on or /repro off'
  if (list.length === 0) return 'Repro · nothing recorded yet · run an analysis command first'
  try {
    return await writeRecipe($, list)
  } catch {
    return 'Repro · could not write the file, nothing changed'
  }
}

export const register: Register = (on, options) => {
  const cfg: Cfg = {
    isEnabled: options.enabled !== false,
    max: maxStepsOf(options.maxSteps),
    programs: programsOf(options.programs),
  }

  on('session.start', async ($, e, next) => {
    try {
      await update($, isOff, () => false)
      const stored = (await $.store.get('off')) === true
      await update($, isOff, () => stored)
      const kept = await $.store.get(keyOf(await cwdOf($)))
      if (Array.isArray(kept)) await update($, steps, () => (kept as Step[]).slice(-cfg.max))
    } catch {
      // starts empty and on
    }
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Write a reproducibility recipe for this project: /repro, /repro status, /repro clear, /repro on, /repro off',
        argumentHint: '[status|clear|on|off]',
        immediate: true,
      })
    } catch {
      // fail-open: without the command the mod is quiet
    }
    return next(e)
  })

  // Observation only: the call always runs first and its result is returned as it came.
  on('tool.call', { tool: /^(Bash|Edit|Write|MultiEdit|NotebookEdit)$/ }, async ($, e, next) => {
    const ran = await next(e)
    try {
      await observe($, cfg, String(e.tool), e as unknown as Record<string, unknown>, ran as unknown as Record<string, unknown>)
    } catch {
      // bookkeeping must never touch the call
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async ($, e) => ({ text: await runRepro($, cfg, e.args) })).catch(() => ({
    text: 'Repro · no answer, nothing changed',
  }))
}
