// Update check: pure helpers. The look-up itself is `git ls-remote --tags` run by register.tsx; nothing here touches the engine.

/** The project release this copy of moddeck shipped with (a test and scripts/check-all.sh keep it equal to pyproject.toml). */
export const RELEASE = '0.5.0'
export const REPO = 'samuelbfernandes/moddeck'
export const REMOTE = `https://github.com/${REPO}.git`
/** The tags are looked up at most this often; a re-open inside the window reuses the last answer. */
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

export type Version = readonly [number, number, number]

/** `v0.4.2` or `0.4.2`; a pre-release (`0.5.0-rc1`) or anything else is not a version we offer. */
export function parseVersion(text: string): Version | undefined {
  const m = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(text.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}

export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (a === undefined || b === undefined) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!
  return false
}

/** The highest release tag in `git ls-remote --tags --refs` output ("<sha>\trefs/tags/v0.4.1" per line), without the `v`. */
export function latestRelease(lsRemote: string): string | undefined {
  let best: string | undefined
  for (const line of lsRemote.split('\n')) {
    const tag = /refs\/tags\/(\S+)\s*$/.exec(line)?.[1]
    const v = tag === undefined ? undefined : parseVersion(tag)
    if (v === undefined) continue
    const text = v.join('.')
    if (best === undefined || isNewer(text, best)) best = text
  }
  return best
}

export type Runner = 'pipx' | 'uvx'

/** The installer's own documented one-liner (docs/INSTALL.md) for a given release, with `update --scope user -y` so the recorded choices are kept and nothing asks a question (there is no terminal to answer in). */
export function installArgv(runner: Runner, version: string): string[] {
  const from = `git+https://github.com/${REPO}@v${version}`
  return runner === 'pipx' ? ['pipx', 'run', '--spec', from, 'moddeck', 'update', '--scope', 'user', '-y'] : ['uvx', '--from', from, 'moddeck', 'update', '--scope', 'user', '-y']
}

export const manualCommand = (version: string): string => installArgv('pipx', version).join(' ')

export const ASK_HEADER = 'New version' // the chip is 12 characters at most
export const UPDATE_NOW = 'Update now'
export const LATER = 'Later'
export const SKIP = 'Skip this version'

export const askText = (latest: string, current: string): string =>
  [
    `Moddeck ${latest} is available (you have ${current}).`,
    `Update now runs: ${manualCommand(latest)}`,
    'It reinstalls with your recorded choices; restart Claude Code afterwards to use it.',
  ].join('\n')
