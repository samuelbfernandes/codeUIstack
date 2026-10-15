// Which finished Bash commands are worth a look at the branches. A small quote-aware splitter, not a
// shell: it only needs to find `git merge`, `gh pr merge` and friends inside `a && b; c | d`.
export type Trigger = 'merge' | 'other'

/** Split on `&&`, `||`, `;`, `|`, `&` and newlines outside quotes, then on spaces; quotes are removed. */
export function segments(command: string): string[][] {
  const out: string[][] = [[]]
  let token = ''
  let hasToken = false
  let quote: '"' | "'" | '' = ''
  const endToken = () => {
    if (hasToken) out[out.length - 1]!.push(token)
    token = ''
    hasToken = false
  }
  const endSegment = () => {
    endToken()
    if (out[out.length - 1]!.length > 0) out.push([])
  }
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = ''
      else token += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      hasToken = true
    } else if (ch === ' ' || ch === '\t' || ch === '\r') endToken()
    else if (ch === ';' || ch === '|' || ch === '&' || ch === '\n') endSegment()
    else {
      token += ch
      hasToken = true
    }
  }
  endSegment()
  return out.filter(s => s.length > 0)
}

const WRAPPERS = new Set(['sudo', 'command', 'time', 'env', 'nohup'])
const base = (p: string) => (p.split(/[\\/]/).pop() ?? p).replace(/\.exe$/i, '')

/** The program and its arguments, skipping `VAR=value` prefixes and wrappers like `sudo`. */
function program(seg: string[]): { name: string; args: string[] } | undefined {
  let i = 0
  while (i < seg.length && (/^[A-Za-z_]\w*=/.test(seg[i]!) || WRAPPERS.has(seg[i]!))) i++
  const name = seg[i]
  return name === undefined ? undefined : { name: base(name), args: seg.slice(i + 1) }
}

const GIT_OPTS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])

function gitSub(args: string[]): { sub: string; rest: string[] } | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (GIT_OPTS_WITH_VALUE.has(a)) i++
    else if (!a.startsWith('-')) return { sub: a, rest: args.slice(i + 1) }
  }
  return undefined
}

const NOT_A_BRANCH_SWITCH = new Set(['-b', '-B', '-c', '-C', '--orphan', '--', '.', '-p', '--patch', '-f', '--force', '--detach', '-d'])

function classifyGit(args: string[]): Trigger | undefined {
  const g = gitSub(args)
  if (!g) return undefined
  const { sub, rest } = g
  const has = (...flags: string[]) => rest.some(a => flags.includes(a))
  switch (sub) {
    case 'merge':
      return has('--abort', '--quit') ? undefined : 'merge'
    case 'pull':
    case 'push': // a push to the default branch, or a pull / fetch that brings a merge in, is how a branch usually finishes
    case 'fetch':
      return 'merge'
    case 'checkout':
    case 'switch': {
      const positional = rest.filter(a => a === '-' || !a.startsWith('-')) // a lone '-' is "the previous branch"
      return positional.length > 0 && !rest.some(a => NOT_A_BRANCH_SWITCH.has(a)) ? 'other' : undefined
    }
    case 'remote':
      return rest[0] === 'prune' || (rest[0] === 'update' && has('-p', '--prune')) ? 'other' : undefined
    default:
      return undefined
  }
}

/** `merge` for a merge, a merged PR, a pull, a push or a fetch (always worth a look, never rate-limited), `other` for the quieter triggers, else undefined. */
export function triggerOf(command: string): Trigger | undefined {
  let found: Trigger | undefined
  for (const seg of segments(command)) {
    const p = program(seg)
    if (!p) continue
    let t: Trigger | undefined
    if (p.name === 'git') t = classifyGit(p.args)
    else if (p.name === 'gh') {
      const words = p.args.filter(a => !a.startsWith('-'))
      const at = words.indexOf('pr') // `gh -R owner/repo pr merge` has a repo word first
      t = at >= 0 && words[at + 1] === 'merge' ? 'merge' : undefined
    }
    if (t === 'merge') return 'merge'
    found = found ?? t
  }
  return found
}

/** Did this command run `gh` (any subcommand)? Only the fact is kept: it tells the mod the person uses gh here. */
export function usesGh(command: string): boolean {
  return segments(command).some(seg => program(seg)?.name === 'gh')
}
