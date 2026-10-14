// Which prompt-cache lifetime the main conversation gets, by Claude Code's documented order. Adapted from
// davila7/claude-code-templates, mods/observability/prompt-cache-control (MIT): decideTtl and accountOf.

export type Ttl = '5m' | '1h'
export type Account = 'subscription' | 'credits' | 'other'
export type CacheEnv = { force5m?: string; ttlVar?: string; enable1h?: string }
export type TtlChoice = { minutes: number; source: string }

const isOn = (v: string | undefined): boolean => v === '1' || v?.toLowerCase() === 'true'
const asTtl = (v: unknown): Ttl | undefined => (v === '5m' || v === '1h' ? v : undefined)
const minutesOf = (t: Ttl): number => (t === '1h' ? 60 : 5)

/**
 * First match wins: the cacheTtlMinutes option (any value above 0 pins it), FORCE_PROMPT_CACHING_5M,
 * CLAUDE_CODE_PROMPT_CACHE_TTL, the promptCacheTtl setting, ENABLE_PROMPT_CACHING_1H, then the account: one hour on a
 * Claude subscription within its plan usage, five minutes on usage credits, an API key or a cloud provider.
 */
export function decideTtl(pinnedMinutes: number, env: CacheEnv, setting?: unknown, account?: Account): TtlChoice {
  if (pinnedMinutes > 0) return { minutes: pinnedMinutes, source: 'the cacheTtlMinutes setting' }
  if (isOn(env.force5m)) return { minutes: 5, source: 'FORCE_PROMPT_CACHING_5M' }
  const fromVar = asTtl(env.ttlVar)
  if (fromVar) return { minutes: minutesOf(fromVar), source: 'CLAUDE_CODE_PROMPT_CACHE_TTL' }
  const fromSetting = asTtl(setting)
  if (fromSetting) return { minutes: minutesOf(fromSetting), source: 'the promptCacheTtl setting' }
  if (isOn(env.enable1h)) return { minutes: 60, source: 'ENABLE_PROMPT_CACHING_1H' }
  if (account === 'subscription') return { minutes: 60, source: 'subscription' }
  if (account === 'credits') return { minutes: 5, source: 'usage credits' }
  return { minutes: 5, source: 'API key or unknown account' }
}

/** A five-hour or seven-day window means a subscription; a full one means usage credits; none says nothing. */
export function accountOf(windows: readonly { kind: string; percentUsed: number }[]): Account {
  const plan = windows.filter(w => w.kind === 'five_hour' || w.kind === 'seven_day')
  if (plan.length === 0) return 'other'
  return plan.some(w => w.percentUsed >= 100) ? 'credits' : 'subscription'
}
