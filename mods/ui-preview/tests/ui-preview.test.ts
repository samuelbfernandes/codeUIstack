import { expect, test } from 'claude-code/testing'

import {
  addOutput,
  argvFor,
  appOf,
  browserCandidates,
  classify,
  detect,
  isLocalUrl,
  parseArgs,
  parseRoutes,
  relPathOf,
  reviewText,
  scrub,
  shotArgv,
  urlIn,
} from '../hooks/lib'
import type { Probe } from '../hooks/lib'
import { OPENAPI, ROOT, mountPane, settle, slash, start, world } from './world'

const PLUMBER_R = "#* @get /echo\nfunction(msg = '') list(msg = msg)\n"
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/** A Probe over a map of relative paths to text. */
function probeOf(files: Record<string, string>): Probe {
  return {
    list: async dir => {
      const prefix = dir === '' ? '' : `${dir}/`
      const names = new Map<string, 'file' | 'dir'>()
      for (const f of Object.keys(files)) {
        if (!f.startsWith(prefix)) continue
        const [head, ...tail] = f.slice(prefix.length).split('/')
        names.set(head!, tail.length > 0 ? 'dir' : 'file')
      }
      return [...names].map(([name, kind]) => ({ name, kind }))
    },
    read: async f => {
      if (!(f in files)) throw new Error('missing')
      return files[f]!
    },
  }
}

// ---------------------------------------------------------------- detection

const CASES: [string, Record<string, string>, string | undefined, string | undefined][] = [
  ['plumber wins over a JS front end', { 'plumber.R': PLUMBER_R, 'package.json': '{"scripts":{"dev":"vite"}}' }, 'plumber', 'plumber.R'],
  ['entrypoint.R, then plumber.R, then api.R', { 'api.R': PLUMBER_R, 'plumber.R': PLUMBER_R, 'entrypoint.R': PLUMBER_R }, 'plumber', 'entrypoint.R'],
  ['an entrypoint.R with no annotations that builds a router', { 'entrypoint.R': 'pr("routes.R") |> pr_set_debug(TRUE)\n' }, 'plumber', 'entrypoint.R'],
  ['a plumber file one folder down', { 'R/helpers.R': 'f <- 1', 'api/api.R': '#*  @post /sum\nfunction(a, b) a + b' }, 'plumber', 'api/api.R'],
  ['an @assets annotation alone', { 'serve.R': '#* @assets ./www /\nlist()' }, 'plumber', 'serve.R'],
  ['npm dev at the root', { 'package.json': '{"scripts":{"dev":"vite","build":"vite build"}}', 'helpers.R': 'x <- 1' }, 'npm', 'package.json'],
  ['npm dev in frontend/', { 'frontend/package.json': '{"scripts":{"dev":"vite"}}' }, 'npm', 'frontend/package.json'],
  ['package.json without dev', { 'package.json': '{"scripts":{"start":"node a.js"}}' }, undefined, undefined],
  ['Shiny for R', { 'app.R': 'library(shiny)\nshinyApp(ui, server)' }, 'shiny-r', 'app.R'],
  ['Shiny for Python', { 'app.py': 'from shiny import App, ui\napp = App(ui.page_fluid(), None)' }, 'shiny-py', 'app.py'],
  ['Streamlit', { 'dashboard.py': 'import streamlit as st\nst.title("x")', 'util.py': 'import os' }, 'streamlit', 'dashboard.py'],
  ['node_modules and renv are not searched', { 'node_modules/x/plumber.R': PLUMBER_R, 'renv/api.R': PLUMBER_R }, undefined, undefined],
  ['nothing', { 'README.md': '# hi' }, undefined, undefined],
]
for (const [name, files, kind, file] of CASES) {
  test(`detect: ${name}`, async () => {
    const found = await detect(probeOf(files))
    expect(found?.kind).toBe(kind)
    expect(found?.file).toBe(file)
  })
}

test('classify a named file', () => {
  expect(classify('src/api.R', PLUMBER_R)?.kind).toBe('plumber')
  expect(classify('app.R', 'shiny::shinyApp(ui, server)')?.kind).toBe('shiny-r')
  expect(classify('x.py', 'import streamlit as st')?.kind).toBe('streamlit')
  expect(classify('x.py', 'import shiny')?.kind).toBe('shiny-py')
  expect(classify('web/package.json', '{"scripts":{"dev":"vite"}}')).toEqual({ kind: 'npm', file: 'web/package.json', dir: 'web', label: 'npm run dev · web/package.json' })
  expect(classify('notes.R', 'x <- 1')).toBeUndefined()
})

// ---------------------------------------------------------------- argv

test('argv for each kind, as arrays, bound to 127.0.0.1', () => {
  expect(argvFor(appOf('plumber', 'api/plumber.R'), 8000)).toEqual({
    argv: ['Rscript', '-e', "pr <- plumber::plumb('api/plumber.R'); plumber::pr_run(pr, host = '127.0.0.1', port = 8000)"],
    cwd: '',
  })
  expect(argvFor(appOf('plumber', 'api/entrypoint.R'), 8001).argv[2]).toBe("pr <- plumber::plumb(dir = 'api'); plumber::pr_run(pr, host = '127.0.0.1', port = 8001)")
  expect(argvFor(appOf('plumber', "it's.R"), 8000).argv[2]).toContain("plumber::plumb('it\\'s.R')")
  expect(argvFor(appOf('npm', 'frontend/package.json'), 5173)).toEqual({ argv: ['npm', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173'], cwd: 'frontend' })
  expect(argvFor(appOf('npm', 'package.json'), 5174, 'npm.cmd').argv[0]).toBe('npm.cmd')
  expect(argvFor(appOf('shiny-r', 'app.R'), 8000).argv).toEqual(['Rscript', '-e', "shiny::runApp('.', host = '127.0.0.1', port = 8000, launch.browser = FALSE)"])
  expect(argvFor(appOf('shiny-r', 'inst/app/app.R'), 8000).argv[2]).toContain("shiny::runApp('inst/app'")
  expect(argvFor(appOf('shiny-py', 'app.py'), 8000).argv).toEqual(['shiny', 'run', '--host', '127.0.0.1', '--port', '8000', 'app.py'])
  expect(argvFor(appOf('streamlit', 'dash.py'), 8000).argv).toEqual(['streamlit', 'run', 'dash.py', '--server.headless', 'true', '--server.address', '127.0.0.1', '--server.port', '8000'])
})

test('screenshot argv and browser candidates', () => {
  expect(shotArgv('chromium', '/p/s.png', '/p/prof', 'http://127.0.0.1:8000')).toEqual([
    'chromium', '--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1280,800', '--user-data-dir=/p/prof', '--no-first-run', '--no-default-browser-check', '--screenshot=/p/s.png', 'http://127.0.0.1:8000',
  ])
  const c = browserCandidates({ localAppData: 'C:\\Users\\me\\AppData\\Local' }).map(x => x.path)
  expect(c.slice(0, 5)).toEqual([MAC_CHROME, '/Applications/Chromium.app/Contents/MacOS/Chromium', 'google-chrome', 'chromium', 'chromium-browser'])
  expect(c).toContain('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  expect(c).toContain('C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
  expect(c).toContain('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
})

test('command words', () => {
  expect(parseArgs('')).toEqual({ kind: 'open' })
  expect(parseArgs('start')).toEqual({ kind: 'start', file: '', port: undefined, error: '' })
  expect(parseArgs('start api/plumber.R --port 9000')).toEqual({ kind: 'start', file: 'api/plumber.R', port: 9000, error: '' })
  expect(parseArgs('start --port=9001')).toMatchObject({ port: 9001, error: '' })
  expect(parseArgs('start --port 80').kind === 'start' && (parseArgs('start --port 80') as { error: string }).error).toContain('1024')
  expect(parseArgs('SHOT')).toEqual({ kind: 'shot' })
  expect(parseArgs('launch')).toEqual({ kind: 'unknown', word: 'launch' })
  expect(relPathOf('/proj', './api/plumber.R')).toBe('api/plumber.R')
  expect(relPathOf('/proj', '/proj/app.py')).toBe('app.py')
  expect(relPathOf('/proj', '/etc/passwd')).toBeUndefined()
  expect(relPathOf('/proj', '../other/app.R')).toBeUndefined()
  expect(relPathOf('C:\\proj', 'C:\\proj\\app.R')).toBe('app.R')
})

// ---------------------------------------------------------------- localhost only

test('isLocalUrl allows only http://127.0.0.1:N and http://localhost:N', () => {
  for (const ok of ['http://127.0.0.1:8000', 'http://localhost:5173/', 'http://127.0.0.1:8000/openapi.json', 'http://localhost:3000/a?b=c']) expect(isLocalUrl(ok)).toBe(true)
  for (const bad of [
    'https://127.0.0.1:8000',
    'http://127.0.0.1',
    'http://localhost',
    'http://example.com:80',
    'http://127.0.0.1.evil.com:80',
    'http://localhost@evil.com:80',
    'http://localhost:80@evil.com',
    'http://127.0.0.2:8000',
    'http://[::1]:8000',
    'http://localhost:99999',
    'http://localhost:0',
    'file:///etc/passwd',
  ]) expect(isLocalUrl(bad)).toBe(false)
})

test('the URL a child prints, its output kept bounded and scrubbed', () => {
  expect(urlIn('Running plumber API at http://127.0.0.1:8000')).toBe('http://127.0.0.1:8000')
  expect(urlIn('  \u001b[32m➜\u001b[39m  Local:   \u001b[36mhttp://localhost:\u001b[1m5174\u001b[22m/\u001b[39m')).toBe('http://localhost:5174')
  expect(urlIn('see https://example.com:443/x')).toBeUndefined()
  expect(scrub('token=abc123 and password: hunter2, API_KEY="xyz"')).toBe('token=*** and password: ***, API_KEY=***')
  expect(scrub('Authorization: Bearer abcdefghijkl')).toBe('Authorization: Bearer ***')
  expect(scrub('key sk-ant-REDACTED-abcdefghijklmnop')).toBe('key ***')
  expect(scrub('x'.repeat(500)).length).toBeLessThan(310)
  let kept = addOutput([], '', 'one\ntw')
  expect(kept).toEqual({ lines: ['one'], partial: 'tw' })
  kept = addOutput(kept.lines, kept.partial, 'o\n')
  expect(kept.lines).toEqual(['one', 'two'])
  const many = addOutput([], '', Array.from({ length: 100 }, (_, i) => `l${i}`).join('\n') + '\n')
  expect(many.lines).toHaveLength(60)
  expect(many.lines[59]).toBe('l99')
})

test('plumber routes from openapi.json', () => {
  expect(parseRoutes(OPENAPI)).toEqual([
    { method: 'GET', path: '/echo', summary: 'Echo back the input' },
    { method: 'POST', path: '/sum', summary: 'Add two numbers' },
    { method: 'GET', path: '/items/{id}', summary: '' },
    { method: 'DELETE', path: '/items/{id}', summary: 'Remove an item' },
  ])
  expect(parseRoutes('not json')).toEqual([])
  expect(parseRoutes('{"paths":null}')).toEqual([])
  const big = { paths: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`/r${i}`, { get: {} }])) }
  expect(parseRoutes(JSON.stringify(big))).toHaveLength(200)
})

test('review draft', () => {
  expect(reviewText('http://127.0.0.1:8000', '/p/shot.png')).toBe(
    'Review the running app at http://127.0.0.1:8000. Screenshot: /p/shot.png. Check layout, spacing, contrast and broken requests; if the chrome-devtools MCP is connected, open the page with it and read the console and network errors.',
  )
})

// ---------------------------------------------------------------- the running mod

test('nothing runs at session start', async ($, on) => {
  const w = world(on, { 'plumber.R': PLUMBER_R })
  await start($)
  await settle(w, 5000)
  expect(w.spawned).toHaveLength(0)
  expect(w.fetched).toHaveLength(0)
  expect(w.runs).toHaveLength(0)
  expect(await slash($, 'status')).toBe('ui-preview · stopped')
})

test('start a plumber API: argv, poll until it answers, routes in the pane, stop', async ($, on) => {
  const w = world(on, { 'plumber.R': PLUMBER_R, 'package.json': '{"scripts":{"dev":"vite"}}' })
  w.output = ['Running plumber API at http://127.0.0.1:8000\n', 'Running swagger Docs at http://127.0.0.1:8000/__docs__/\n']
  await start($)
  const text = await slash($, 'start')
  expect(text).toBe('ui-preview · starting plumber API · plumber.R at http://127.0.0.1:8000')
  await settle(w)
  expect(w.spawned).toEqual([{ argv: ['Rscript', '-e', "pr <- plumber::plumb('plumber.R'); plumber::pr_run(pr, host = '127.0.0.1', port = 8000)"], cwd: ROOT }])
  expect(w.panes.map(p => p.id)).toEqual(['ui-preview'])
  expect(await slash($, 'status')).toContain('ui-preview · starting')

  w.up.add('http://127.0.0.1:8000')
  await settle(w, 1000)
  expect(await slash($, 'status')).toContain('ui-preview · running · plumber API · plumber.R · http://127.0.0.1:8000\n4 routes')
  expect(w.fetched).toContain('http://127.0.0.1:8000/openapi.json')
  expect(w.fetched.every(isLocalUrl)).toBe(true)

  expect(await slash($, 'stop')).toBe('ui-preview · stopped')
  await settle(w)
  expect(w.killed).toBe(1)
  expect(await slash($, 'status')).toContain('ui-preview · stopped')

  // Drawn once the child is gone: a live child keeps every act of the kit waiting on it.
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountPane($, surface)
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts.some(t => /^POST\s+\/sum\s+Add two numbers$/.test(t))).toBe(true)
    expect(texts.some(t => t.includes('root http://127.0.0.1:8000/'))).toBe(true)
    expect(texts.some(t => t.includes('Running plumber API at'))).toBe(true)
    expect(await ui.find({ key: 'start' })).toBeDefined()
    await ui.unmount()
  }
  expect(await slash($, 'stop')).toBe('ui-preview · nothing is running')
})

test('a taken port moves to the next one; a printed URL that differs wins', async ($, on) => {
  const w = world(on, { 'package.json': '{"scripts":{"dev":"vite"}}' })
  w.up.add('http://127.0.0.1:5173')
  w.output = ['  VITE v5  ready\n  ➜  Local:   http://localhost:5180/\n']
  await start($)
  expect(await slash($, 'start')).toBe('ui-preview · starting npm run dev · package.json at http://127.0.0.1:5174 (port 5173 was taken)')
  await settle(w)
  expect(w.spawned[0]!.argv).toEqual(['npm', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '5174'])
  expect(await slash($, 'status')).toContain('http://localhost:5180')
  await slash($, 'stop')
})

test('start with a file argument and a port; a file outside the project is refused', async ($, on) => {
  const w = world(on, { 'apps/dash.py': 'import streamlit as st' })
  await start($)
  expect(await slash($, 'start ../x/app.R')).toContain('outside this project')
  expect(await slash($, 'start missing.py')).toContain('was not found')
  expect(await slash($, 'start apps/dash.py --port 9100')).toContain('Streamlit · apps/dash.py at http://127.0.0.1:9100')
  await settle(w)
  expect(w.spawned[0]!.argv).toEqual(['streamlit', 'run', 'apps/dash.py', '--server.headless', 'true', '--server.address', '127.0.0.1', '--server.port', '9100'])
  expect(await slash($, 'start')).toContain('already running')
  await slash($, 'stop')
})

test('no app found says so and starts nothing', async ($, on) => {
  const w = world(on, { 'README.md': '#' })
  await start($)
  expect(await slash($, 'start')).toContain('no app found')
  expect(w.spawned).toHaveLength(0)
})

test('the child ending is shown as exited', async ($, on) => {
  const w = world(on, { 'app.R': 'shinyApp(ui, server)' })
  await start($)
  await slash($, 'start')
  await settle(w)
  w.exit?.()
  await settle(w)
  expect(await slash($, 'status')).toContain('ui-preview · exited · Shiny for R · app.R')
  expect(await slash($, 'status')).toContain('the app ended (exit 0)')
})

test('no answer within 60 s is said, the child kept', async ($, on) => {
  const w = world(on, { 'plumber.R': PLUMBER_R })
  await start($)
  await slash($, 'start')
  await settle(w, 61_000)
  expect(await slash($, 'status')).toContain('ui-preview · silent')
  expect(w.killed).toBe(0)
  await slash($, 'stop')
})

test('screenshot: headless Chrome writes .claude/ui-preview/shot.png; the terminal pane shows the Image, the desktop the path', async ($, on) => {
  const w = world(on, { 'plumber.R': PLUMBER_R })
  w.onPath.add(MAC_CHROME)
  await start($)
  expect(await slash($, 'shot')).toContain('start the app first')
  await slash($, 'start')
  w.up.add('http://127.0.0.1:8000')
  await settle(w, 1000)
  const png = `${ROOT}/.claude/ui-preview/shot.png`
  expect(await slash($, 'shot')).toBe(`ui-preview · screenshot saved: ${png}`)
  const run = w.runs.find(a => a[0] === MAC_CHROME)!
  expect(run).toEqual(shotArgv(MAC_CHROME, png, `${ROOT}/.claude/ui-preview/chrome-profile`, 'http://127.0.0.1:8000'))
  expect(w.files['.claude/ui-preview/.gitignore']).toBe('*\n')
  await slash($, 'stop')

  const term = await mountPane($, 'terminal')
  const image = await term.find({ type: 'Image' })
  expect(image?.props.source).toMatchObject({ file: png, format: 'png' })
  await term.unmount()
  const desk = await mountPane($, 'desktop')
  expect(await desk.find({ type: 'Image' })).toBeUndefined()
  expect(await desk.find({ type: 'Text', text: `screenshot: ${png}` })).toBeDefined()
  await desk.unmount()
})

test('a plumber API with no front end (404 at its root) is photographed at its docs page', async ($, on) => {
  const w = world(on, { 'plumber.R': PLUMBER_R })
  w.onPath.add('chromium')
  w.rootStatus = 404
  await start($)
  await slash($, 'start')
  w.up.add('http://127.0.0.1:8000')
  await settle(w, 1000)
  expect(await slash($, 'status')).toContain('ui-preview · running')
  expect(await slash($, 'shot')).toContain('screenshot saved')
  expect(w.runs.find(a => a[0] === 'chromium' && a[1] !== '--version')?.at(-1)).toBe('http://127.0.0.1:8000/__docs__/')
  await slash($, 'stop')
})

test('screenshot with no browser says so', async ($, on) => {
  const w = world(on, { 'plumber.R': PLUMBER_R })
  await start($)
  await slash($, 'start')
  await settle(w)
  expect(await slash($, 'shot')).toBe('ui-preview · no Chrome, Chromium or Edge found for screenshots')
  expect(w.runs.map(a => a[0])).toEqual(['google-chrome', 'chromium', 'chromium-browser'])
  await slash($, 'stop')
})

test('Ask Claude to review fills the prompt box, or copies when it cannot', async ($, on) => {
  const w = world(on, { 'plumber.R': PLUMBER_R })
  await start($)
  await slash($, 'start')
  await settle(w)
  const ui = await mountPane($, 'terminal')
  await ui.press({ key: 'review' })
  expect(w.fills).toEqual([reviewText('http://127.0.0.1:8000', undefined)])
  w.isFillRefused = true
  await ui.press({ key: 'review' })
  expect(w.copies).toEqual([reviewText('http://127.0.0.1:8000', undefined)])
  expect(await ui.find({ type: 'Text', text: /copied to the clipboard/ })).toBeDefined()
  await ui.press({ key: 'stop' })
  expect(w.killed).toBe(1)
  expect(await ui.find({ key: 'start' })).toBeDefined()
  await ui.unmount()
})

test('/ui-preview opens the pane; an unknown word says so', async ($, on) => {
  const w = world(on)
  await start($)
  expect(await slash($)).toBe('ui-preview · stopped')
  expect(w.panes.map(p => p.id)).toEqual(['ui-preview'])
  expect(await slash($, 'launch')).toContain('unknown option')
})
