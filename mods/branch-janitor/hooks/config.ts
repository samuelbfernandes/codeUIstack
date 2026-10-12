import type { PluginOptions } from 'claude-code'

import type { Settings } from './janitor'
import { DEFAULT_PROTECTED } from './scan'

const num = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Number(v)
  return Number.isFinite(n) && v !== '' ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

/** userConfig into settings. Empty or missing protectedBranches means the built-in list. */
export function readSettings(options: PluginOptions): Settings {
  const raw = Array.isArray(options.protectedBranches) ? (options.protectedBranches as string[]) : []
  const listed = raw.map(s => String(s).trim()).filter(s => s !== '')
  return {
    minMinutes: num(options.minMinutes, 30, 1, 1440),
    staleDays: num(options.staleDays, 60, 1, 3650),
    protectedBranches: listed.length > 0 ? listed : DEFAULT_PROTECTED,
  }
}
