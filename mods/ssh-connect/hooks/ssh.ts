// ssh-connect: pure logic for /ssh (no engine access). Reads Host names from the person's ~/.ssh/config, builds argv arrays
// (never a shell string) and the one platform-specific step: opening a terminal window, so any password or 2FA code is typed
// by the person and never passes through this mod.

export type Platform = 'darwin' | 'linux' | 'win32'
export type Run = (argv: readonly string[], o?: { timeoutMs?: number }) => Promise<{ exitCode: number; stdout: string; stderr: string }>
export type Deps = {
  run: Run
  platform: Platform
  /** The text of ~/.ssh/config, or undefined when it cannot be read. */
  config: string | undefined
  defaultHost: string
}
export type Reply = { text: string; fill?: string }

const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const LINUX_TERMINALS: readonly (readonly string[])[] = [['x-terminal-emulator', '-e'], ['gnome-terminal', '--'], ['konsole', '-e'], ['xfce4-terminal', '-x'], ['xterm', '-e']]
export const USAGE = 'usage: /ssh [connect|shell|status|disconnect|hosts] [host]'

export const isHostName = (s: string): boolean => HOST_RE.test(s)

/** The concrete `Host` names of an ssh config: patterns (`*`, `?`) and negations (`!`) are skipped, repeats kept once. */
export function parseHosts(config: string | undefined): string[] {
  const out: string[] = []
  for (const line of (config ?? '').split(/\r?\n/)) {
    const m = /^\s*Host\s+(.+?)\s*$/i.exec(line)
    if (!m) continue
    for (const h of m[1]!.split(/\s+/)) if (!/[*?!]/.test(h) && isHostName(h) && !out.includes(h)) out.push(h)
  }
  return out
}

/** Whether the config turns on connection sharing anywhere (`ControlMaster auto|yes|ask|autoask`). */
export const hasControlMaster = (config: string | undefined): boolean => /^\s*ControlMaster\s+(auto|yes|ask|autoask)\b/im.test(config ?? '')

export const connectArgv = (host: string, platform: Platform): string[] => (platform === 'win32' ? ['ssh', host] : ['ssh', '-fN', host])
export const shellArgv = (host: string): string[] => ['ssh', host]
export const checkArgv = (host: string): string[] => ['ssh', '-O', 'check', host]
export const exitArgv = (host: string): string[] => ['ssh', '-O', 'exit', host]

/** AppleScript string literal: only validated host names and flags go in, but escape anyway. */
const q = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** The argv that opens a terminal window running `ssh`; undefined when the platform has none we know (linux: `found` names the first on PATH). */
export function terminalArgv(platform: Platform, ssh: readonly string[], found?: readonly string[]): string[] | undefined {
  if (platform === 'win32') return ['cmd', '/c', 'start', '', ...ssh]
  if (platform === 'darwin') return ['osascript', '-e', `tell application "Terminal" to do script ${q(ssh.join(' '))}`, '-e', 'tell application "Terminal" to activate']
  return found ? [...found, ...ssh] : undefined
}

async function firstTerminal(run: Run): Promise<readonly string[] | undefined> {
  for (const t of LINUX_TERMINALS) {
    try {
      if ((await run(['which', t[0]!], { timeoutMs: 3000 })).exitCode === 0) return t
    } catch {
      // not found: try the next one
    }
  }
  return undefined
}

function pickHost(d: Deps, arg: string): { host: string } | { error: string } {
  const hosts = parseHosts(d.config)
  const want = arg || d.defaultHost.trim()
  if (want) return isHostName(want) ? { host: want } : { error: `ssh · "${want}" is not a valid host name (letters, digits, . _ -)` }
  if (hosts.length === 1) return { host: hosts[0]! }
  if (hosts.length === 0) return { error: 'ssh · no Host entries in ~/.ssh/config yet. Add one, then /ssh connect <host> (see the README)' }
  return { error: `ssh · which host? ${hosts.join(', ')}  (/ssh connect <host>, or set the default host in /config)` }
}

async function open(d: Deps, ssh: string[], what: string, host: string): Promise<Reply> {
  const fallback = `! ${ssh.join(' ')}`
  const found = d.platform === 'linux' ? await firstTerminal(d.run) : undefined
  const argv = terminalArgv(d.platform, ssh, found)
  if (!argv) return { text: `ssh · no terminal program found; run it yourself: ${ssh.join(' ')}`, fill: fallback }
  try {
    const r = await d.run(argv, { timeoutMs: 8000 })
    if (r.exitCode === 0) return { text: `ssh · ${what} ${host} in a new terminal window; type your password or 2FA code there` }
  } catch {
    // fall through
  }
  return { text: `ssh · could not open a terminal window; run it yourself: ${ssh.join(' ')}`, fill: fallback }
}

/** `ssh -O check` reports on stderr: "Master running (pid=…)" or an error when there is none. */
export async function status(d: Deps, host: string): Promise<string> {
  if (d.platform === 'win32') return `ssh · status is not available on Windows (its OpenSSH has no connection sharing); /ssh shell ${host} opens a session`
  if (!hasControlMaster(d.config)) return `ssh · ${host}: no ControlMaster in ~/.ssh/config, so connections are not shared (see the README)`
  try {
    const r = await d.run(checkArgv(host), { timeoutMs: 5000 })
    return r.exitCode === 0 ? `ssh · ${host} connected (${(r.stderr || r.stdout).trim().split('\n')[0]})` : `ssh · ${host} not connected; /ssh connect ${host}`
  } catch {
    return 'ssh · ssh is not installed or could not run'
  }
}

export async function runCommand(d: Deps, args: string): Promise<Reply> {
  const [sub = 'hosts', arg = ''] = args.trim().split(/\s+/)
  if (!['connect', 'shell', 'status', 'disconnect', 'hosts'].includes(sub)) return { text: USAGE }
  if (sub === 'hosts') {
    const hosts = parseHosts(d.config)
    return { text: hosts.length ? `ssh · hosts: ${hosts.join(', ')}` : 'ssh · no Host entries found in ~/.ssh/config' }
  }
  const p = pickHost(d, arg)
  if ('error' in p) return { text: p.error }
  if (sub === 'status') return { text: await status(d, p.host) }
  if (sub === 'disconnect') {
    if (d.platform === 'win32') return { text: 'ssh · nothing to close on Windows: close the terminal window' }
    try {
      const r = await d.run(exitArgv(p.host), { timeoutMs: 5000 })
      return { text: r.exitCode === 0 ? `ssh · ${p.host} disconnected` : `ssh · ${p.host} was not connected` }
    } catch {
      return { text: 'ssh · ssh is not installed or could not run' }
    }
  }
  if (sub === 'shell') return open(d, shellArgv(p.host), 'opened', p.host)
  return open(d, connectArgv(p.host, d.platform), d.platform === 'win32' ? 'opened' : 'connecting', p.host)
}
