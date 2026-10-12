// big-file-guard: a Read of a large data or log file with no offset/limit of its own is cut to the first lines,
// and the model is told so in a note after the result. Never blocks.
// FAIL OPEN: any error leaves the call exactly as the model made it (or the result exactly as it came back).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

type Dollar = EngineInterface

const COMMAND = 'big-file-guard'
const KINDS = new Set(['csv', 'tsv', 'json', 'jsonl', 'ndjson', 'log', 'txt'])

const saved = atom({ plugin: 'big-file-guard', key: 'saved' } as const, 0)
const isOff = atom({ plugin: 'big-file-guard', key: 'isOff' } as const, false)

type Cfg = { isEnabled: boolean; maxKb: number; headLines: number }

const num = (v: unknown, fallback: number, min: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min ? Math.floor(v) : fallback

const extOf = (path: string): string => {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

async function setSwitch($: Dollar, off: boolean): Promise<void> {
  if (off) await $.store.set('off', true)
  else await $.store.delete('off')
  await update($, isOff, () => off)
}


async function isSwitchedOff($: Dollar): Promise<boolean> {
  try {
    return await read($, isOff)
  } catch {
    return false
  }
}

async function status($: Dollar, cfg: Cfg): Promise<string> {
  const off = await isSwitchedOff($)
  const state = !cfg.isEnabled ? 'disabled (the enabled setting is false)' : off ? 'off' : 'on'
  const tokens = await read($, saved)
  return [
    `big-file-guard · ${state}`,
    `Cuts csv, tsv, json, jsonl, ndjson, log and txt files over ${cfg.maxKb} KB to the first ${cfg.headLines} lines`,
    `Saved this session: about ${tokens} tokens`,
  ].join('\n')
}

async function run($: Dollar, cfg: Cfg, arg: string): Promise<string> {
  const word = arg.trim().toLowerCase()
  if (word === '' || word === 'status') return status($, cfg)
  if (word !== 'on' && word !== 'off') return `big-file-guard · unknown option “${word.slice(0, 30)}”\nUse /big-file-guard, /big-file-guard on or /big-file-guard off.`
  try {
    await setSwitch($, word === 'off')
  } catch {
    return 'big-file-guard · that did not work, nothing changed'
  }
  return word === 'on' ? 'big-file-guard · on' : 'big-file-guard · off · /big-file-guard on turns it back on'
}

/** The size in bytes when this call should be cut, else undefined. Any doubt means undefined. */
async function sizeToCut($: Dollar, cfg: Cfg, e: Record<string, unknown>): Promise<number | undefined> {
  try {
    if (e.tool !== 'Read' || !cfg.isEnabled || (await isSwitchedOff($))) return undefined
    if (e.offset !== undefined || e.limit !== undefined) return undefined
    const path = e.file_path
    if (typeof path !== 'string' || !KINDS.has(extOf(path))) return undefined
    const stat = await $.fs.stat(path)
    if (stat.kind !== 'file' || stat.size <= cfg.maxKb * 1024) return undefined
    return stat.size
  } catch {
    return undefined
  }
}

export const register: Register = (on, options) => {
  const cfg: Cfg = { isEnabled: options.enabled !== false, maxKb: num(options.maxKb, 256, 1), headLines: num(options.headLines, 200, 1) }

  on('session.start', async ($, e, next) => {
    try {
      const stored = (await $.store.get('off')) === true
      await update($, isOff, () => stored)
    } catch {
      // reads as on
    }
    try {
      await $.command.register({ name: COMMAND, description: 'Show or switch big-file-guard: /big-file-guard [on|off|status]', argumentHint: '[on|off|status]' })
    } catch {
      // fail-open
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => ({ text: await run($, cfg, e.args) })).catch(() => ({
    text: 'big-file-guard · could not read its own state',
  }))

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const size = await sizeToCut($, cfg, e as unknown as Record<string, unknown>)
    if (size === undefined) return next(e)

    const ran = await next({ ...e, limit: cfg.headLines } as typeof e)
    try {
      if (ran.deny !== undefined || ran.isError === true) return ran
      const file = (ran.result as { file?: { content?: unknown; numLines?: unknown; totalLines?: unknown } } | undefined)?.file
      const shownBytes = typeof file?.content === 'string' ? file.content.length : (ran.text ?? '').length
      const shownLines = typeof file?.numLines === 'number' ? file.numLines : cfg.headLines
      const total = typeof file?.totalLines === 'number' && file.totalLines > 0 ? `${file.totalLines}` : `~${Math.max(shownLines, Math.round(size / Math.max(1, shownBytes / Math.max(1, shownLines))))}`
      const kb = Math.round(size / 1024)
      const note = `big-file-guard: showed the first ${shownLines} of ${total} lines (file is ${kb} KB). Ask for a range (offset and limit), or use head/wc/summary tools for the rest.`
      const gain = Math.max(0, Math.floor(size / 4) - Math.floor(shownBytes / 4))
      await update($, saved, n => n + gain)
      return { ...ran, context: [...(ran.context ?? []), note] } as typeof ran
    } catch {
      return ran
    }
  }).catch(($, e, next) => next(e))
}
