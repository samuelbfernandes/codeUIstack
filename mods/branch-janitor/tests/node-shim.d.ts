// Type declarations for the few Node modules the real-git integration script uses. That script is NOT a
// hooks module and not run by `claude plugin test` (whose sandbox has no process or fs): run it with
// `bun tests/real-git.integration.ts`. Only the names it calls are declared.
declare module 'node:child_process' {
  export function spawnSync(
    command: string,
    args: readonly string[],
    options?: { cwd?: string; encoding?: 'utf8'; input?: string; timeout?: number; env?: Record<string, string | undefined> },
  ): { status: number | null; stdout: string; stderr: string; error?: Error }
}
declare module 'node:fs' {
  export function mkdtempSync(prefix: string): string
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void
  export function writeFileSync(path: string, data: string): void
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void
  export function realpathSync(path: string): string
}
declare module 'node:os' {
  export function tmpdir(): string
  export const devNull: string
}
declare module 'node:path' {
  export function join(...parts: string[]): string
}
