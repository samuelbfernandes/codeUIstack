// Native Windows handling: the measurer's probes are Unix `find` and `du`, which do not exist there (Windows has its own
// `find`, a text search, that would answer nothing and make a destructive command look harmless). So on Windows a risky
// command is held WITHOUT a listing, saying so, instead of being measured.
import type { Finding } from './classify'
import type { Report } from './measure'

export const WINDOWS_NOTE = 'Nothing can be listed on Windows. Check the path yourself first'

/** A drive-letter or UNC path: `C:\Users\me`, `C:/Users/me`, `\\server\share`. */
export const looksWindows = (p: string | undefined): boolean => p !== undefined && /^([A-Za-z]:[\\/]|\\\\)/.test(p)

/** Reports that say plainly nothing was measured. Conditional findings (`> file`) need a file check, so they pass. */
export function unmeasured(found: Finding[]): { reports: Report[]; unlisted: number } {
  const held = found.filter(f => f.conditional === undefined)
  return {
    reports: held.slice(0, 6).map(f => ({ finding: f, groups: [], summary: [], notes: [WINDOWS_NOTE], unmeasured: 'native Windows' })),
    unlisted: Math.max(0, held.length - 6),
  }
}
