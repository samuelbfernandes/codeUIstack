import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { FsEntry, On, UiPane } from 'claude-code'

export const dir = (name: string): FsEntry => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })
export const file = (name: string): FsEntry => ({ name, kind: 'file', size: 10, mtimeMs: 1, isLink: false })

export const LISTING: Record<string, FsEntry[]> = {
  '/proj': [
    file('README.md'), dir('src'), dir('docs'), file('analysis.R'),
    dir('.git'), dir('node_modules'), dir('target'), dir('renv'), dir('.Rproj.user'),
    dir('__pycache__'), dir('.venv'), dir('dist'), dir('build'),
  ],
  '/proj/src': [file('b.R'), file('a.R'), dir('deep')],
  '/proj/src/deep': [file('d.R'), dir('deeper')],
  '/proj/src/deep/deeper': [file('e.R')],
  '/proj/docs': [file('x.md')],
  '/proj/node_modules': [file('left-pad.js')],
}

export const PANE_PROPS = {
  title: 'Filetree',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
} as const

export const FULLSCREEN = { columns: 120, rows: 40, isFullscreen: true } as const

export type World = ReturnType<typeof world>

/** Everything beneath the plugin that a session would answer: cwd, files, panes, git and the tools' results. */
export function world(on: On, listing: Record<string, FsEntry[]> = LISTING) {
  const clock = mock.clock(on)
  const panes: UiPane[] = []
  const git = { status: '', prefix: '', exitCode: 0 }
  const open = { isPlaced: true, reason: '' }
  const runs: string[][] = []
  const logs: string[] = []
  const results: Record<string, unknown> = {}

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.list', ($, e) => ({ value: listing[e.path] ?? [] }))
  on('ui.panes', () => ({ value: [...panes] }))
  on('ui.open', ($, e) => {
    panes.push({ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true })

    return { value: open.isPlaced ? { isPlaced: true as const } : { isPlaced: false as const, reason: open.reason } }
  })
  on('ui.close', ($, e) => {
    panes.splice(0, panes.length, ...panes.filter(pane => pane.id !== e.id))

    return { value: undefined }
  })
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    const stdout = e.argv.includes('rev-parse') ? git.prefix : git.status

    return { value: { exitCode: git.exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)

    return { value: undefined }
  })
  on('tool.call', ($, e) => ({ result: results[String(e.tool)] ?? {} }))
  // What a prompt no plugin handled becomes: it enters as text.
  on('prompt.submit', ($, e) => ({ text: e.text }))

  return { clock, panes, git, open, runs, results, logs }
}

export async function runCommand($: Engine, isFullscreen = true) {
  return $.command.run({
    command: 'filetree',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen, columns: 120 },
  })
}
