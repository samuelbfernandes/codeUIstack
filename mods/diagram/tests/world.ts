import type { Engine } from 'claude-code/testing'
import type { On, RenderSurface, UiPane } from 'claude-code'

export const PANE_PROPS = {
  title: 'Diagram',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
} as const

export const FULLSCREEN = { columns: 120, rows: 40, isFullscreen: true } as const

export const FENCE = '```'
export const FLOW = `${FENCE}mermaid\nflowchart TD\n  A[Start] --> B[End]\n${FENCE}`

/** Everything beneath the plugin that a session would answer: panes, toasts, surfaces and the prompt bottom. */
export function world(on: On) {
  const panes: UiPane[] = []
  const opens: { id: string; title?: string; focus?: true; closeOnEscape?: true }[] = []
  const open = { isPlaced: true }
  const toasts: string[] = []
  const logs: string[] = []
  const registered: string[] = []
  const surfaces = { list: ['terminal'] as string[] }

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('command.register', ($, e) => {
    registered.push(e.name)

    return { value: undefined as never }
  })
  on('ui.panes', () => ({ value: [...panes] }))
  on('ui.open', ($, e) => {
    opens.push({ id: e.id, title: e.title, focus: e.focus, closeOnEscape: e.closeOnEscape })
    if (!panes.some(pane => pane.id === e.id)) panes.push({ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true })

    return { value: open.isPlaced ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'no room' } }
  })
  on('ui.close', ($, e) => {
    panes.splice(0, panes.length, ...panes.filter(pane => pane.id !== e.id))

    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    logs.push(e.text)

    return { value: undefined }
  })
  on('session.surfaces', () => ({ value: [...surfaces.list] as never }))
  // What a prompt no plugin handled becomes: it enters as text.
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.complete', ($, e) => ({ text: e.answer }))

  return { panes, opens, open, toasts, logs, registered, surfaces }
}

export type World = ReturnType<typeof world>

export const start = ($: Engine, surface: RenderSurface | null = 'terminal') => $.session.start({ cwd: '/proj', surface, isInteractive: true })

let turnCounter = 0

/** Ends a main-loop turn that answered with this text. */
export function answer($: Engine, text: string, extra: object = {}) {
  turnCounter += 1

  return $.turn.complete({ answer: text, durationMs: 1, isAborted: false, turnId: `t${turnCounter}`, reason: 'answer', ...extra } as never)
}

export const typed = ($: Engine, text: string, extra: object = {}) =>
  $.prompt.submit({ text, wait: false, origin: { kind: 'composer' }, ...extra } as never)

export const slash = ($: Engine, args = '') =>
  $.command.run({ command: 'diagram', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })

export const mountPane = ($: Engine, surface: 'terminal' | 'desktop', props: object = {}) =>
  $.ui.mount({
    plugin: 'diagram',
    surface,
    component: 'Pane',
    requestId: 'diagram',
    props: { ...PANE_PROPS, ...props },
    viewport: FULLSCREEN,
  } as never)
