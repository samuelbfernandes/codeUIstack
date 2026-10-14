// Type declarations for the few Node modules the real-directory integration script uses. That script is NOT a hooks
// module and not run by `claude plugin test` (whose sandbox has no process or fs): run it with
// `bun tests/real-folder.integration.ts`. Only the names it calls are declared.
declare module 'node:child_process' {
  export function spawnSync(
    command: string,
    args: readonly string[],
    options?: { cwd?: string; encoding?: 'utf8'; timeout?: number },
  ): { status: number | null; stdout: string; stderr: string; error?: Error }
}
declare module 'node:fs' {
  export function mkdtempSync(prefix: string): string
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void
  export function writeFileSync(path: string, data: string): void
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void
  export function realpathSync(path: string): string
  export function symlinkSync(target: string, path: string): void
  export function utimesSync(path: string, atime: number, mtime: number): void
  export function existsSync(path: string): boolean
}
declare module 'node:os' {
  export function tmpdir(): string
  export const devNull: string
}
declare module 'node:path' {
  export function join(...parts: string[]): string
}
