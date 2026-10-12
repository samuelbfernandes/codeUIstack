// Thin git layer: argv builder and a never-throwing runner. No shell is involved. Only plumbing that cannot
// change the branch, the index or the stash list is ever issued by checkpoint.ts.

export type RunResult = { exitCode: number; stdout: string; stderr: string }
export type RunOptions = { cwd?: string; timeoutMs?: number; stdin?: string; env?: Record<string, string> }
/** `$.process.run` as the mod needs it: an argv ARRAY, never a shell string. */
export type Run = (argv: readonly string[], options?: RunOptions) => Promise<RunResult>

const GIT_PREFIX = ['git', '-c', 'core.quotepath=off', '--no-optional-locks', '--no-pager', '--literal-pathspecs']
const GIT_TIMEOUT_MS = 60_000

export type Git = (args: readonly string[], extra?: { env?: Record<string, string>; stdin?: string }) => Promise<RunResult>

/** A git runner bound to a directory. It never throws: a spawn failure or timeout reads as exit code 127. */
export function gitIn(run: Run, cwd: string | undefined, timeoutMs: number = GIT_TIMEOUT_MS): Git {
  return async (args, extra) => {
    try {
      return await run([...GIT_PREFIX, ...args], { cwd, timeoutMs, ...(extra?.env ? { env: extra.env } : {}), ...(extra?.stdin !== undefined ? { stdin: extra.stdin } : {}) })
    } catch (error) {
      return { exitCode: 127, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
    }
  }
}
