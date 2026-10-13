// scope-watch: `/scope-watch <folder>` names the folder the person is working in (kept per project). When Claude then
// edits a file outside it (Edit, Write, MultiEdit, NotebookEdit), the person gets a toast and the model a short note
// asking it to check the edit was intended, each once per path. `/scope-watch off` clears the folder.
// FAIL OPEN: it never blocks or changes an edit; it looks only after the edit ran, and any error leaves the result as is.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { absolute, isInside, normalize, relativeTo, unquote } from './lib'

type Dollar = EngineInterface

const COMMAND = 'scope-watch'
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const MAX_PATHS = 50

const folder = atom({ plugin: 'scope-watch', key: 'folder' } as const, null)
const outside = atom({ plugin: 'scope-watch', key: 'outside' } as const, 0)
const paths = atom({ plugin: 'scope-watch', key: 'paths' } as const, [])
const root = atom({ plugin: 'scope-watch', key: 'root' } as const, '')

const storeKey = (cwd: string) => `folder:${normalize(cwd)}`

/** Loads the folder stored for the session's current folder, once per change of folder. Returns the cwd. */
async function ensureLoaded($: Dollar): Promise<string> {
  const cwd = normalize(await $.session.cwd())
  if ((await read($, root)) === cwd) return cwd
  const stored = await $.store.get(storeKey(cwd))
  await update($, root, () => cwd)
  await update($, folder, () => (typeof stored === 'string' && stored !== '' ? stored : null))
  await update($, outside, () => 0)
  await update($, paths, () => [])

  return cwd
}

async function status($: Dollar): Promise<string> {
  await ensureLoaded($)
  const watched = await read($, folder)
  if (watched === null) return 'scope-watch · no folder set\nUse /scope-watch <folder> to name the folder you are working in.'
  const count = await read($, outside)
  const seen = await read($, paths)
  const lines = [`scope-watch · watching ${watched} · ${count} edit${count === 1 ? '' : 's'} outside it this session`]
  if (seen.length > 0) lines.push(`Outside: ${seen.slice(-5).join(', ')}${seen.length > 5 ? ` and ${seen.length - 5} more` : ''}`)

  return lines.join('\n')
}

async function setFolder($: Dollar, raw: string): Promise<string> {
  const typed = unquote(raw)
  if (/[\u0000-\u001f\u007f]/.test(typed)) return 'scope-watch · a folder may not hold control characters'
  const cwd = await ensureLoaded($)
  const full = absolute(cwd, typed)
  let warning = ''
  try {
    const stat = await $.fs.stat(full)
    if (stat.kind !== 'dir') return `scope-watch · ${typed} is not a folder; nothing changed`
  } catch {
    warning = '\nIt does not exist yet; edits will be compared with it anyway.'
  }
  const shown = relativeTo(cwd, full)
  await $.store.set(storeKey(cwd), shown)
  await update($, folder, () => shown)
  await update($, outside, () => 0)
  await update($, paths, () => [])

  return `scope-watch · watching ${shown}${warning}`
}

async function run($: Dollar, args: string): Promise<string> {
  const word = args.trim()
  if (word === '' || word.toLowerCase() === 'status') return status($)
  if (word.toLowerCase() === 'off') {
    const cwd = await ensureLoaded($)
    await $.store.delete(storeKey(cwd))
    await update($, folder, () => null)
    await update($, outside, () => 0)
    await update($, paths, () => [])

    return 'scope-watch · off (no folder set)'
  }

  return setFolder($, word)
}

/** After an edit ran: the note for the model when the file lies outside the folder and was not noted before. */
async function noteFor($: Dollar, input: Record<string, unknown>): Promise<string | undefined> {
  const target = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : undefined
  if (target === undefined || target === '') return undefined
  const cwd = await ensureLoaded($)
  const watched = await read($, folder)
  if (watched === null) return undefined
  const file = absolute(cwd, target)
  if (isInside(file, absolute(cwd, watched))) return undefined
  await update($, outside, n => n + 1)
  const shown = relativeTo(cwd, file)
  const seen = await read($, paths)
  if (seen.includes(shown)) return undefined // toast and note once per path
  await update($, paths, list => [...list, shown].slice(-MAX_PATHS))
  $.ui.toast(`scope-watch: ${shown} is outside ${watched}`, { timeoutMs: 6000 })

  return `scope-watch: ${shown} is outside the folder the person is working in (${watched}). Check this edit was intended.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await ensureLoaded($)
    } catch {
      // loaded again on first use
    }
    try {
      await $.command.register({ name: COMMAND, description: 'Name the folder you work in; edits outside it are flagged', argumentHint: '[folder|off|status]' })
    } catch {
      // fail-open: the session goes on without the command
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => ({ text: await run($, e.args) })).catch(() => ({
    text: 'scope-watch · that did not work, nothing changed',
  }))

  // Watches only, after the edit ran: never blocks, never changes the edit or its result beyond one added note.
  on('tool.call', async ($, e, next) => {
    if (!EDIT_TOOLS.has(String(e.tool))) return next(e)
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    try {
      const note = await noteFor($, e as unknown as Record<string, unknown>)
      if (note !== undefined) return { ...ran, context: [...(ran.context ?? []), note] } as typeof ran
    } catch {
      // a scope problem never reaches the model
    }

    return ran
  }).catch(($, e, next) => next(e))
}
