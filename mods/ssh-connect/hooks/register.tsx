// ssh-connect: /ssh opens your terminal on a host from ~/.ssh/config; see ssh.ts. FAIL-OPEN: every error ends in one plain
// message, never a block. Passwords and 2FA codes are typed in the terminal window, never here.
import type { EngineInterface, Register } from 'claude-code'

import { runCommand } from './ssh'
import type { Deps, Platform } from './ssh'

const COMMAND = 'ssh'
const OFF = 'ssh · off · the enabled setting is false (change it in /config)'

async function attempt<T>(f: () => Promise<T>): Promise<T | undefined> {
  try {
    return await f()
  } catch {
    return undefined
  }
}

async function platformOf($: EngineInterface): Promise<Platform> {
  if ((await attempt(() => $.env.get('OS'))) === 'Windows_NT') return 'win32'
  const u = await attempt(() => $.process.run(['uname', '-s'], { timeoutMs: 3000 }))
  return u?.stdout.trim() === 'Darwin' ? 'darwin' : 'linux'
}

async function configOf($: EngineInterface): Promise<string | undefined> {
  const home = (await attempt(() => $.env.get('HOME'))) ?? (await attempt(() => $.env.get('USERPROFILE')))
  if (!home) return undefined
  const text = await attempt(() => $.fs.read(`${home.replace(/[\\/]+$/, '')}/.ssh/config`))
  return typeof text === 'string' ? text : undefined
}

export const register: Register = (on, options) => {
  const isEnabled = options.enabled !== false
  const defaultHost = typeof options.defaultHost === 'string' ? options.defaultHost : ''

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Open a terminal on an SSH host from ~/.ssh/config: /ssh connect|shell|status|disconnect|hosts [host]',
        argumentHint: '[connect | shell | status | disconnect | hosts] [host]',
      })
    } catch {
      // fail-open: without the command the mod is simply quiet
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (!isEnabled) return { text: OFF }
    const deps: Deps = { run: (argv, o) => $.process.run(argv, o), platform: await platformOf($), config: await configOf($), defaultHost }
    const out = await runCommand(deps, String((e as { args?: unknown }).args ?? ''))
    if (out.fill) await attempt(() => $.prompt.fill({ text: out.fill } as never))
    return { text: out.text }
  }).catch(() => ({ text: 'ssh · that did not work, nothing was changed' }))
}
