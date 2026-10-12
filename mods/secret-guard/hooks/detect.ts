// The patterns and the redaction itself: plain functions over strings, no engine, no state.
//
// DESIGN: conservative on purpose. A false positive costs the model a little context; a pattern that fires on
// every long hex string or base64 blob would make the mod useless for scientists. So most rules need a distinctive
// prefix (ghp_, AKIA, sk-ant-, eyJ...), and the generic `password = ...` rule needs a sensitive KEY NAME right before
// the operator, a value of at least 8 characters, and a value that does not look like a placeholder, a code
// expression or a plain word. Bare hashes, git SHAs and base64 data have no key name and no prefix, so they pass.
// Every rule that scans long runs of characters is anchored with a look-behind so a 100 kB base64 line is linear.

export type Hits = Record<string, number>

/** What a rule's `accept` sees of one match. */
export type Candidate = { whole: string; val: string; pre: string; key: string }

export type Rule = {
  /** The kind shown in the placeholder `[secret:<kind>]`; a function when it depends on the match. */
  kind: string | ((c: Candidate) => string)
  /** Global. Named groups `pre`, `val`, `post`: only `val` is replaced; without them the whole match is. */
  re: RegExp
  /** A cheap test that must pass on the text before the (costlier) regex runs. */
  gate?: RegExp
  /** Return false to leave this match alone (placeholders, code, plain words). */
  accept?: (c: Candidate) => boolean
}

export type Redacted = { text: string; hits: Hits }

const MIN_SCAN = 8 // nothing shorter can hold a secret

/** Runs every rule over the text in order; `hits` counts what was replaced, by kind. */
export function redact(text: string, rules: readonly Rule[]): Redacted {
  const hits: Hits = {}
  if (text.length < MIN_SCAN) return { text, hits }
  let out = text
  for (const rule of rules) out = apply(out, rule, hits)
  return { text: out, hits }
}

function apply(text: string, rule: Rule, hits: Hits): string {
  if (rule.gate !== undefined && !rule.gate.test(text)) return text
  return text.replace(rule.re, (...args: unknown[]) => {
    const whole = String(args[0])
    const last = args[args.length - 1]
    const groups = (typeof last === 'object' && last !== null ? last : {}) as Record<string, string | undefined>
    const c: Candidate = { whole, val: groups.val ?? whole, pre: groups.pre ?? '', key: groups.key ?? '' }
    if (rule.accept !== undefined && !rule.accept(c)) return whole
    const kind = typeof rule.kind === 'string' ? rule.kind : rule.kind(c)
    hits[kind] = (hits[kind] ?? 0) + 1
    return `${groups.pre ?? ''}[secret:${kind}]${groups.post ?? ''}`
  })
}

export const countOf = (hits: Hits): number => Object.values(hits).reduce((a, b) => a + b, 0)

export function mergeHits(into: Hits, from: Hits): void {
  for (const [kind, n] of Object.entries(from)) into[kind] = (into[kind] ?? 0) + n
}

// ---------------------------------------------------------------------------------------------- value checks

const PLACEHOLDER_WORDS = new Set([
  'password', 'passwd', 'secret', 'token', 'null', 'none', 'nil', 'undefined', 'true', 'false', 'required',
  'optional', 'string', 'hidden', 'redacted', 'empty', 'unset', 'default', 'changeme', 'ignored', 'masked',
])
const PLACEHOLDER_PARTS = ['example', 'your', 'placeholder', 'changeme', 'change-me', 'change_me', 'redacted', 'xxxx', 'dummy', 'sample', 'todo', 'fixme', 'insert', 'replace']

/** Obvious stand-ins: `<token>`, `${TOKEN}`, `$TOKEN`, `%TOKEN%`, `xxxxxxxx`, `YOUR_KEY_HERE`, `********`. */
export function isPlaceholder(value: string): boolean {
  const v = value.toLowerCase()
  if (/^[x*.#_-]+$/.test(v)) return true
  if (/^[$%<{]|[%>}]$|\$\{|\$\(|\{\{/.test(v)) return true
  if (v.startsWith('[secret:')) return true
  if (PLACEHOLDER_WORDS.has(v)) return true
  return PLACEHOLDER_PARTS.some(p => v.includes(p))
}

/** Code and plain words that sit after a sensitive key name without being a secret. */
function looksLikeCode(value: string): boolean {
  if (/^[A-Za-z_$][\w$]*(?:[?!]?\.[A-Za-z_$][\w$]*)+$/.test(value)) return true // process.env.TOKEN, args.password, opts?.apiKey
  if (/^(?:[A-Z]{2,}[0-9]?)?(?:[A-Z][a-z]{2,}[0-9]?){2,}$/.test(value)) return true // a type name: HostCancellationToken
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(value)) return true // snake_case_name
  if (/%[sdifr(]|\{[\w.]*\}/.test(value)) return true // a format string
  if (/^(?:\.{1,2}|~)?\/[\w.-]+\//.test(value) || /^[A-Za-z]:[\\/]/.test(value)) return true // a file path
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return true // a URL (user:password@ is its own rule)
  if (/^(?:env|vault|ref|file|secrets?):/i.test(value)) return true
  return /^[A-Za-z_-]+$/.test(value) // letters only: an identifier or a word (a real secret nearly always has a digit)
}

function acceptAssigned(c: Candidate): boolean {
  const value = c.val.replace(/[.:!?]+$/, '') // "REQUIRED." in a docstring
  return !isPlaceholder(value) && !looksLikeCode(value)
}

/** `password`, `token`, `api-key`... from the key name that preceded the value. */
function kindOfKey(c: Candidate): string {
  const k = c.key.toLowerCase()
  if (k.includes('pass')) return 'password'
  if (/api[_-]?key/.test(k)) return 'api-key'
  if (/access[_-]?key/.test(k)) return 'access-key'
  if (/private[_-]?key/.test(k)) return 'private-key'
  if (k.includes('token')) return 'token'
  if (k.includes('secret')) return 'secret'
  return 'credential'
}

// ---------------------------------------------------------------------------------------------- the rules

const NOT_ALNUM_BEFORE = '(?<![A-Za-z0-9])'

/** Keys whose value is a secret: the key must END in one of these right before the operator. */
const SENSITIVE_KEY = '(?:password|passwd|passphrase|secret(?:[_-]?key)?|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credentials?)'
/** `=`, `:`, `:=`, `=>` and R's `<-`. */
const OPERATOR = String.raw`[ \t]*(?:=>|:=|<{1,2}-|[:=])[ \t]*`
const KEY_HEAD = String.raw`(?<![A-Za-z0-9_.-])(?<pre>["']?(?<key>[A-Za-z0-9_.-]*?${SENSITIVE_KEY})["']?${OPERATOR}`
/**
 * What may not appear in an unquoted value: whitespace, quotes, brackets, `$`, `\`, pipes, `^ * ?` (regular
 * expressions and optional chaining). A password with these is quoted in any file a shell reads. `;` is not a
 * terminator either, so a line like `const token = otherName;` in code is left alone.
 */
const BARE_STOP = String.raw`\s"'#,;(){}\[\]<>$\\\x60|&^*?`
const BARE_VALUE = String.raw`(?<val>[^${BARE_STOP}=:][^${BARE_STOP}]{7,})(?=[\s#,)}\]]|$)`
const GATE_ASSIGNED = /pass|secret|token|key|credential/i

export const BUILTIN_RULES: readonly Rule[] = [
  // PEM private keys, whole block; then one whose END line was cut off (a truncated read) with its base64 body.
  {
    kind: 'private-key',
    re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g,
    gate: /PRIVATE KEY/,
  },
  {
    kind: 'private-key',
    re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----(?:[ \t]*(?:\r?\n|\\n)[ \t]*[A-Za-z0-9+/=]{16,}[ \t]*)+/g,
    gate: /PRIVATE KEY/,
  },
  // AWS: an access key id with the 40-character secret beside it, then the id alone, then `secret_access_key = ...`.
  {
    kind: 'aws-secret-key',
    re: new RegExp(String.raw`(?<pre>${NOT_ALNUM_BEFORE}(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}["']?[ \t]*[,;:\s][ \t]*["']?)(?<val>[A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])`, 'g'),
    gate: /AKIA|ASIA|ABIA|ACCA/,
    accept: c => /[a-z]/.test(c.val) && /[A-Z]/.test(c.val), // not a 40-character hex hash
  },
  { kind: 'aws-access-key', re: new RegExp(String.raw`${NOT_ALNUM_BEFORE}(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}(?![A-Za-z0-9])`, 'g'), gate: /AKIA|ASIA|ABIA|ACCA/ },
  {
    kind: 'aws-secret-key',
    re: /(?<pre>secret[_-]?access[_-]?key["']?[ \t]*[:=][ \t]*["']?)(?<val>[A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/gi,
    gate: /secret/i,
  },
  {
    kind: 'github-token',
    re: new RegExp(String.raw`${NOT_ALNUM_BEFORE}(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})(?![A-Za-z0-9_])`, 'g'),
    gate: /gh[pousr]_|github_pat_/,
  },
  { kind: 'gitlab-token', re: new RegExp(String.raw`${NOT_ALNUM_BEFORE}glpat-[A-Za-z0-9_-]{20,}`, 'g'), gate: /glpat-/ },
  { kind: 'anthropic-key', re: new RegExp(String.raw`${NOT_ALNUM_BEFORE}sk-ant-[A-Za-z0-9_-]{20,}`, 'g'), gate: /sk-ant-/ },
  {
    // `sk-proj-...` style, or the older `sk-` + 32 or more letters and digits that include a digit (so `sk-learn` stays).
    kind: 'openai-key',
    re: new RegExp(String.raw`${NOT_ALNUM_BEFORE}sk-(?:(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}|(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{32,})(?![A-Za-z0-9_-])`, 'g'),
    gate: /sk-/,
  },
  {
    kind: 'slack-token',
    re: new RegExp(String.raw`${NOT_ALNUM_BEFORE}(?:xox[abeprs]-[A-Za-z0-9-]{10,}|xapp-\d-[A-Za-z0-9]+-\d+-[A-Za-z0-9]{10,})`, 'g'),
    gate: /xox|xapp-/,
  },
  { kind: 'slack-webhook', re: /https:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9/_-]{20,}/g, gate: /hooks\.slack\.com/ },
  {
    kind: 'stripe-key',
    re: new RegExp(String.raw`${NOT_ALNUM_BEFORE}(?:(?:sk|rk)_(?:live|test)|whsec)_[A-Za-z0-9]{16,}`, 'g'),
    gate: /sk_|rk_|whsec_/,
  },
  { kind: 'huggingface-token', re: new RegExp(String.raw`${NOT_ALNUM_BEFORE}hf_[A-Za-z0-9]{34,}(?![A-Za-z0-9])`, 'g'), gate: /hf_/ },
  { kind: 'npm-token', re: new RegExp(String.raw`${NOT_ALNUM_BEFORE}npm_[A-Za-z0-9]{36}(?![A-Za-z0-9])`, 'g'), gate: /npm_/ },
  { kind: 'google-api-key', re: /(?<![A-Za-z0-9_-])AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g, gate: /AIza/ },
  {
    kind: 'jwt',
    re: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{10,}/g,
    gate: /eyJ/,
  },
  {
    // Authorization: Bearer <token> (also Basic and Token); the header name stays so the line still reads.
    kind: c => (/bearer/i.test(c.pre) ? 'bearer-token' : 'auth-header'),
    re: /(?<pre>\bauthorization["']?[ \t]*[:=][ \t]*["']?(?:bearer|basic|token)[ \t]+)(?<val>[A-Za-z0-9._~+/=_-]{16,})/gi,
    gate: /authorization/i,
    accept: c => !isPlaceholder(c.val),
  },
  {
    // scheme://user:password@host: only the password goes.
    kind: 'url-password',
    re: /(?<pre>(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]{1,15}:\/\/[^\s:/@"'<>\x60]{1,100}:)(?<val>[^\s@/"'<>\x60]{3,200})(?<post>@)/g,
    gate: /:\/\//,
    accept: c => !isPlaceholder(c.val),
  },
  {
    // password = "...", "api_key": "...", TOKEN: '...'; the key name stays, the quoted value goes.
    kind: kindOfKey,
    re: new RegExp(String.raw`${KEY_HEAD}(?<q>["']))(?<val>[^"'\s\\]{8,})(?<post>\k<q>)`, 'gi'),
    gate: GATE_ASSIGNED,
    accept: acceptAssigned,
  },
  {
    // PASSWORD=..., token: ... (.env, YAML, R's `<-`); the value must be one 8+ character word, not code.
    kind: kindOfKey,
    re: new RegExp(`${KEY_HEAD})${BARE_VALUE}`, 'gi'),
    gate: GATE_ASSIGNED,
    accept: acceptAssigned,
  },
]

/** Off unless the person turns it on: sample IDs and cluster accounts often look like emails. */
export const EMAIL_RULE: Rule = {
  kind: 'email',
  re: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/g,
  gate: /@/,
  accept: c => !c.whole.toLowerCase().startsWith('git@'), // git@github.com is a remote, not a person
}

// ---------------------------------------------------------------------------------------------- the person's own patterns

export type Extra = { rules: Rule[]; problems: string[] }

/** `a;;b` or one per line. `/re/i` keeps its flags; anything else is the bare source. A bad one is reported, never thrown. */
export function parseExtra(source: unknown): Extra {
  const rules: Rule[] = []
  const problems: string[] = []
  if (typeof source !== 'string') return { rules, problems }
  const items = source.split(/;;|\r?\n/).map(s => s.trim()).filter(s => s !== '')
  items.forEach((item, i) => {
    const slashed = /^\/(.+)\/([a-z]*)$/s.exec(item)
    const label = `extra pattern ${i + 1}`
    try {
      const re = new RegExp(slashed ? slashed[1]! : item, [...new Set(`${slashed?.[2] ?? ''}g`)].join(''))
      if (re.test('')) problems.push(`${label} matches empty text, ignored`)
      else rules.push({ kind: 'custom', re })
    } catch (error) {
      problems.push(`${label} is not a valid regular expression (${firstLine(error)}), ignored`)
    }
  })
  return { rules, problems }
}

const firstLine = (error: unknown): string => String(error instanceof Error ? error.message : error).split('\n')[0]!.slice(0, 80)

/** The rule set for a configuration: built-ins, emails if asked, then the person's own. */
export function rulesFor(o: { redactEmails: boolean; extra: readonly Rule[] }): Rule[] {
  return [...BUILTIN_RULES, ...(o.redactEmails ? [EMAIL_RULE] : []), ...o.extra]
}
