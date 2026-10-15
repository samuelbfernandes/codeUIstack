import { test, expect } from 'claude-code/testing'

import { hasControlMaster, parseHosts, runCommand, terminalArgv } from '../hooks/ssh'
import type { Deps, Platform } from '../hooks/ssh'

const CONFIG = `
Host example-cluster
  HostName login.example.org
  User someone
  ControlMaster auto
Host *
  ServerAliveInterval 30
Host alpha beta !gamma *.wild
`

function deps(o: Partial<Deps> & { platform?: Platform; fail?: (argv: string[]) => boolean; have?: string[] } = {}) {
  const calls: string[][] = []
  const d: Deps = {
    platform: 'darwin',
    config: CONFIG,
    defaultHost: '',
    run: async argv => {
      calls.push([...argv])
      if (o.fail?.([...argv])) return { exitCode: 1, stdout: '', stderr: 'nope' }
      if (argv[0] === 'which') return { exitCode: o.have?.includes(argv[1]!) ? 0 : 1, stdout: '', stderr: '' }
      return { exitCode: 0, stdout: '', stderr: 'Master running (pid=42)' }
    },
    ...o,
  }
  return { d, calls }
}

test('parseHosts keeps concrete names, skips patterns and negations, once each', () => {
  expect(parseHosts(CONFIG)).toEqual(['example-cluster', 'alpha', 'beta'])
  expect(parseHosts(undefined)).toEqual([])
  expect(hasControlMaster(CONFIG)).toBe(true)
  expect(hasControlMaster('Host a\n  User x')).toBe(false)
})

test('terminalArgv per platform', () => {
  expect(terminalArgv('win32', ['ssh', 'h'])).toEqual(['cmd', '/c', 'start', '', 'ssh', 'h'])
  expect(terminalArgv('darwin', ['ssh', '-fN', 'h'])![0]).toBe('osascript')
  expect(terminalArgv('darwin', ['ssh', '-fN', 'h'])![2]).toBe('tell application "Terminal" to do script "ssh -fN h"')
  expect(terminalArgv('linux', ['ssh', 'h'], ['gnome-terminal', '--'])).toEqual(['gnome-terminal', '--', 'ssh', 'h'])
  expect(terminalArgv('linux', ['ssh', 'h'])).toBeUndefined()
})

test('connect opens a terminal with ssh -fN on macOS and tells you to type the code there', async () => {
  const { d, calls } = deps()
  const r = await runCommand(d, 'connect example-cluster')
  expect(calls).toHaveLength(1)
  expect(calls[0]![2]).toContain('ssh -fN example-cluster')
  expect(r.text).toContain('type your password or 2FA code there')
})

test('Linux uses the first terminal found; none found falls back to a prompt line', async () => {
  const a = deps({ platform: 'linux', have: ['konsole'] })
  await runCommand(a.d, 'shell alpha')
  expect(a.calls.at(-1)).toEqual(['konsole', '-e', 'ssh', 'alpha'])
  const b = deps({ platform: 'linux', have: [] })
  const r = await runCommand(b.d, 'shell alpha')
  expect(r.fill).toBe('! ssh alpha')
})

test('Windows: a plain interactive ssh in a new console; status and disconnect say they are not available', async () => {
  const w = deps({ platform: 'win32' })
  await runCommand(w.d, 'connect alpha')
  expect(w.calls[0]).toEqual(['cmd', '/c', 'start', '', 'ssh', 'alpha'])
  expect((await runCommand(w.d, 'status alpha')).text).toContain('not available on Windows')
  expect((await runCommand(w.d, 'disconnect alpha')).text).toContain('Windows')
})

test('status and disconnect use ssh -O; a missing master is "not connected"', async () => {
  const up = deps()
  expect((await runCommand(up.d, 'status example-cluster')).text).toContain('connected (Master running')
  const down = deps({ fail: a => a[1] === '-O' })
  expect((await runCommand(down.d, 'status example-cluster')).text).toContain('not connected')
  expect((await runCommand(down.d, 'disconnect example-cluster')).text).toContain('was not connected')
  const none = deps({ config: 'Host a\n  User x' })
  expect((await runCommand(none.d, 'status a')).text).toContain('no ControlMaster')
})

test('host choice: argument, then the default, then the only host, else a list; bad names refused', async () => {
  const one = deps({ config: 'Host solo' })
  expect((await runCommand(one.d, 'status')).text).toContain('solo')
  const many = deps()
  expect((await runCommand(many.d, 'connect')).text).toContain('which host?')
  expect(many.calls).toHaveLength(0)
  const dflt = deps({ defaultHost: 'beta' })
  await runCommand(dflt.d, 'shell')
  expect(dflt.calls[0]![2]).toContain('ssh beta')
  for (const bad of ['-oProxyCommand=x', 'a;b', 'a b$', '../x', '`x`']) {
    const bd = deps()
    const r = await runCommand(bd.d, `shell ${bad.replace(/ /g, '')}`)
    expect(bd.calls, bad).toHaveLength(0)
    expect(r.text, bad).toMatch(/not a valid host name|usage|which host/)
  }
  expect((await runCommand(many.d, 'bogus')).text).toContain('usage')
})
