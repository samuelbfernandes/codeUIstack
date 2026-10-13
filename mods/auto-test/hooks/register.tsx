import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AutoTestLast } from '../types'
import { detect, fmtSeconds, fromText, parseArgs, tailOf, timeoutOf, whyOf } from './lib'
import type { TestCommand } from './lib'

type Dollar = EngineInterface

const COMMAND = 'auto-test'
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
const HELP = 'auto-test · /auto-test on | off | run | status | command <cmd> (command reset goes back to detecting)'

/** True while auto-test is off. Ships off, so the default is true; the persisted switch is `$.store` 'on'. */
const isOff = atom({ plugin: 'auto-test', key: 'isOff' } as const, true)
const last = atom({ plugin: 'auto-test', key: 'last' } as const, 'idle')

type Cfg = { isEnabled: boolean; command: string; timeoutMs: number; tellModel: boolean }
type LastRun = { status: AutoTestLast; label: string; at: number; ms: number; note: string }

type Ctx = { cfg: Cfg; isDirty: boolean; isRunning: boolean; isRerun: boolean; hasSaid: boolean; lastRun: LastRun | undefined }

/** Runs one call of `$` and swallows its failure: a missing toast or log line must never break a run (fail-open). */
async function quiet(work: () => unknown): Promise<void> {
  try {
    await work()
  } catch {
    /* nothing to do */
  }
}

function setLast(status: AutoTestLast, $: Dollar) {
  return update($, last, () => status).catch(() => undefined)
}

async function isOn(c: Ctx, $: Dollar): Promise<boolean> {
  if (!c.cfg.isEnabled) return false
  try {
    return (await $.store.get('on')) === true
  } catch {
    return false
  }
}

async function cwdOf(c: Ctx, $: Dollar): Promise<string> {
  try {
    return await $.session.cwd()
  } catch {
    return ''
  }
}

async function projectCommand(c: Ctx, $: Dollar, cwd: string): Promise<string> {
  try {
    const v = await $.store.get(`command:${cwd}`)
    return typeof v === 'string' ? v : ''
  } catch {
    return ''
  }
}

/** Project command, then the setting, then what the project root looks like. */
async function commandFor(c: Ctx, $: Dollar, cwd: string): Promise<TestCommand | undefined> {
  const stored = await projectCommand(c, $, cwd)
  if (stored !== '') return fromText(stored, 'project')
  if (c.cfg.command !== '') return fromText(c.cfg.command, 'setting')
  const at = (f: string) => (cwd === '' ? f : `${cwd.replace(/[\\/]$/, '')}/${f}`)
  return detect({ exists: f => $.fs.exists(at(f)), read: async f => String(await $.fs.read(at(f))) })
}

/** Says "could not run" once; later ones stay quiet until a run works. */
async function couldNot(c: Ctx, $: Dollar, why: string, label: string, started: number) {
  const now = await $.clock.now()
  c.lastRun = { status: 'idle', label, at: now, ms: now - started, note: `could not run: ${why}` }
  await setLast('idle', $)
  if (c.hasSaid) return
  c.hasSaid = true
  await quiet(() => $.ui.toast(`auto-test · could not run: ${why}`))
}

async function execute(c: Ctx, $: Dollar): Promise<void> {
  const cwd = await cwdOf(c, $)
  const started = await $.clock.now()
  let cmd: TestCommand | undefined
  try {
    cmd = await commandFor(c, $, cwd)
  } catch {
    cmd = undefined
  }
  if (cmd === undefined) return couldNot(c, $, 'no test command found (set one with /auto-test command <cmd>)', '', started)

  await setLast('running', $)
  let out: { exitCode: number; stdout: string; stderr: string }
  try {
    out = await $.process.run(cmd.argv, { cwd: cwd === '' ? undefined : cwd, timeoutMs: c.cfg.timeoutMs })
  } catch (error) {
    return couldNot(c, $, whyOf(error, c.cfg.timeoutMs), cmd.label, started)
  }
  const ms = (await $.clock.now()) - started
  // 127 = command not found, 5 from pytest = nothing collected: neither is a verdict on the code.
  if (out.exitCode === 127) return couldNot(c, $, `${cmd.argv[0] === 'sh' ? 'command' : cmd.argv[0]} not found`, cmd.label, started)
  if (cmd.label === 'pytest' && out.exitCode === 5) return couldNot(c, $, 'pytest found no tests', cmd.label, started)

  c.hasSaid = false
  if (out.exitCode === 0) {
    c.lastRun = { status: 'pass', label: cmd.label, at: started, ms, note: '' }
    await setLast('pass', $)
    await quiet(() => $.ui.toast(`auto-test · passed (${fmtSeconds(ms)})`))
    return
  }

  const tail = tailOf(out.stdout, out.stderr)
  c.lastRun = { status: 'fail', label: cmd.label, at: started, ms, note: tail }
  await setLast('fail', $)
  await quiet(() => $.ui.toast('auto-test · FAILED'))
  // One `$.ui.log` call per line: a newline inside one call draws as a stray glyph, and the tail is meant to be copied.
  await quiet(() => $.ui.log(`auto-test · FAILED · ${cmd.label} · exit ${out.exitCode} · ${fmtSeconds(ms)}`))
  for (const line of tail.split('\n')) if (line.trim() !== '') await quiet(() => $.ui.log(line))
  if (c.cfg.tellModel) {
    const note = `auto-test: the project's tests failed after your last edits (${cmd.label}, exit ${out.exitCode}). Last output:\n${tail}`
    await quiet(() => $.session.append({ message: { type: 'user', content: [{ type: 'text', text: note }] } }))
  }
}

/** Starts a run from a timer so the hook or command returns at once; one run at a time. */
function start(c: Ctx, $: Dollar) {
  if (c.isRunning) {
    c.isRerun = true
    return
  }
  c.isRunning = true
  $.clock.after(1, () => {
    void execute(c, $)
      .catch(() => setLast('idle', $))
      .finally(() => {
        c.isRunning = false
        if (c.isRerun) {
          c.isRerun = false
          start(c, $)
        }
      })
  })
}

async function status(c: Ctx, $: Dollar): Promise<string> {
  const isSwitchedOn = await isOn(c, $)
  const head = !c.cfg.isEnabled ? 'disabled (the enabled setting is false)' : isSwitchedOn ? 'on' : 'off (type /auto-test on)'
  const cwd = await cwdOf(c, $)
  let cmd: TestCommand | undefined
  try {
    cmd = await commandFor(c, $, cwd)
  } catch {
    cmd = undefined
  }
  const used = cmd === undefined ? 'none found (set one with /auto-test command <cmd>)' : `${cmd.label} (${cmd.source})`
  const lines = [`auto-test · ${head}`, `command: ${used}`]
  if (c.isRunning) lines.push('last: running now')
  else if (c.lastRun === undefined) lines.push('last: no run yet')
  else {
    const when = new Date(c.lastRun.at).toLocaleTimeString()
    const word = c.lastRun.status === 'pass' ? 'passed' : c.lastRun.status === 'fail' ? 'FAILED' : c.lastRun.note
    lines.push(`last: ${word}${c.lastRun.status === 'idle' ? '' : ` (${fmtSeconds(c.lastRun.ms)})`} at ${when}`)
  }
  return lines.join('\n')
}

async function flip(c: Ctx, $: Dollar, to: boolean): Promise<string> {
  if (!c.cfg.isEnabled) return 'auto-test · disabled · the enabled setting is false (change it in /config)'
  try {
    if (to) await $.store.set('on', true)
    else await $.store.delete('on')
    await update($, isOff, () => !to)
  } catch {
    return 'auto-test · that did not work, nothing changed'
  }
  if (!to) c.isDirty = false
  return to ? 'auto-test · on · tests run once after a turn that edits files' : 'auto-test · off'
}

async function setCommand(c: Ctx, $: Dollar, text: string): Promise<string> {
  const cwd = await cwdOf(c, $)
  try {
    if (text === '') {
      const shown = (await projectCommand(c, $, cwd)) || c.cfg.command
      return shown === '' ? 'auto-test · no command set · detecting from the project · /auto-test command <cmd> sets one' : `auto-test · command: ${shown}`
    }
    if (text.toLowerCase() === 'reset') {
      await $.store.delete(`command:${cwd}`)
      return 'auto-test · command cleared · detecting from the project again'
    }
    await $.store.set(`command:${cwd}`, text)
  } catch {
    return 'auto-test · that did not work, nothing changed'
  }
  return `auto-test · command for this project: ${text}`
}

export const register: Register = (on, options) => {
  const c: Ctx = {
    cfg: {
      isEnabled: options.enabled !== false,
      command: typeof options.command === 'string' ? options.command.trim() : '',
      timeoutMs: timeoutOf(options.timeoutSec) * 1000,
      tellModel: options.tellModel === true,
    },
    // Per module instance: a hot reload starts clean, which only costs one skipped run.
    isDirty: false,
    isRunning: false,
    isRerun: false,
    hasSaid: false,
    lastRun: undefined,
  }

  on('session.start', async ($, e, next) => {
    try {
      const stored = (await $.store.get('on')) === true // the switch outlives the session
      await update($, isOff, () => !stored)
      await update($, last, () => 'idle')
    } catch {
      // the switch then reads as off
    }
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Run the project tests after Claude edits files: /auto-test on | off | run | status | command <cmd>',
        argumentHint: 'on | off | run | status | command <cmd>',
        immediate: true,
      })
    } catch {
      // fail-open: without the command the mod is simply quiet
    }
    return next(e)
  })

  // Only notes that a file was touched. Observational: it never changes the call or its result.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (EDIT_TOOLS.has(String(e.tool)) && ran.deny === undefined && ran.isError !== true) c.isDirty = true
    return ran
  }).catch(($, e, next) => next(e))

  // The end of the model's turn (not a subagent's): at most one run, and only if something was edited and the switch is on.
  on('turn.complete', async ($, e, next) => {
    try {
      if (e.agentId === undefined && e.reason === 'answer' && c.isDirty) {
        c.isDirty = false
        if (await isOn(c, $)) start(c, $)
      }
    } catch {
      // fail-open: a problem here never touches the turn
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async ($, e) => {
    const p = parseArgs(e.args)
    switch (p.kind) {
      case 'on':
        return { text: await flip(c, $, true) }
      case 'off':
        return { text: await flip(c, $, false) }
      case 'status':
        return { text: await status(c, $) }
      case 'command':
        return { text: await setCommand(c, $, p.text) }
      case 'run':
        if (!c.cfg.isEnabled) return { text: 'auto-test · disabled · the enabled setting is false' }
        start(c, $)
        return { text: 'auto-test · running · the result shows in a moment' }
      case 'help':
        return { text: HELP }
      default:
        return { text: `auto-test · "${p.word}" is not a choice · ${HELP}` }
    }
  }).catch(() => ({ text: 'auto-test · that did not work, nothing changed' }))
}
