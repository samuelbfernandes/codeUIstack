// The per-prompt probe: ONE bounded, read-only git call whose output changes whenever something the janitor
// cares about changes (a branch moved, appeared or vanished, a remote-tracking ref moved after a fetch, a
// remote branch was pruned, the checked-out branch changed, an upstream became ahead/behind/gone).
// The output is reduced to a short string so it is cheap to keep and compare.
import { gitIn } from './git'
import type { Run } from './git'

const PROBE_TIMEOUT_MS = 3_000

/** `%(HEAD)` is `*` on the checked-out branch, so switching branches changes the print too. */
export const PROBE_FORMAT = '%(HEAD)%(refname) %(objectname) %(upstream:track)'

/** 53-bit string hash (cyrb53): no crypto API is available to a hooks module, and a collision only costs a missed look. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** The fingerprint of the repository around `cwd`, or undefined outside a repository or when git fails or times out. */
export async function repoFingerprint(run: Run, cwd: string | undefined): Promise<string | undefined> {
  const r = await gitIn(run, cwd, PROBE_TIMEOUT_MS)('for-each-ref', `--format=${PROBE_FORMAT}`, 'refs/heads', 'refs/remotes')
  return r.exitCode === 0 ? `${r.stdout.length}.${hashText(r.stdout)}` : undefined
}
