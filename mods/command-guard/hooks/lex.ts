// A small POSIX-shell lexer: just enough to find the simple commands in a Bash
// tool call. It never evaluates anything. Quotes are removed, `$(...)`, backticks
// and `<(...)` bodies are captured as `subs` (classified recursively), and anything
// that expands at run time (`$VAR`, `${..}`, `{a,b}`, `$(..)`) marks the word `dynamic`.

export type Word = {
  text: string
  glob: boolean // an unquoted * ? or [..] is in it
  dynamic: boolean // its value is only known at run time
  tilde: boolean // starts with an unquoted ~
  subs: string[] // command substitutions found inside it
}

export type Tok =
  | { t: 'word'; w: Word }
  | { t: 'op'; op: ';' | '&&' | '||' | '|' | '&' | '(' | ')' }
  | { t: 'redir'; op: string; fd?: string; body?: string }

const blank = (): Word => ({ text: '', glob: false, dynamic: false, tilde: false, subs: [] })
const NAME = /[A-Za-z0-9_]/
// Sticky regexes: tested in place, so a long command is not re-sliced at every bracket.
const BRACKET = /\[[^\s\]]+\]/y
const BRACE = /\{[^\s{}]*(,|\.\.)[^\s{}]*\}/y
const REDIR = /(&>>|&>|>>|>\||>&|<<<|<<-|<<|<&|<>|>|<)/y
const at = (re: RegExp, s: string, i: number) => ((re.lastIndex = i), re.exec(s))

// Index of the `close` char matching an already-opened `open`, quote aware; -1 if none.
function matchClose(src: string, from: number, open: string, close: string): number {
  let depth = 1
  for (let i = from; i < src.length; i++) {
    const c = src[i]
    if (c === '\\') i++
    else if (c === "'") {
      const j = src.indexOf("'", i + 1)
      if (j < 0) return -1
      i = j
    } else if (c === '"') {
      let j = i + 1
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1
      if (j >= src.length) return -1
      i = j
    } else if (c === close) {
      if (open === close || --depth === 0) return i
    } else if (c === open) depth++
  }
  return -1
}

type Pending = { tok: Extract<Tok, { t: 'redir' }>; delim: string; strip: boolean }

export function lex(src: string): Tok[] {
  const toks: Tok[] = []
  const heredocs: Pending[] = []
  let cur: Word | undefined
  let expectDelim: { tok: Extract<Tok, { t: 'redir' }>; strip: boolean } | undefined
  let i = 0

  const word = () => (cur ??= blank())
  const flush = () => {
    if (!cur) return
    toks.push({ t: 'word', w: cur })
    if (expectDelim) heredocs.push({ ...expectDelim, delim: cur.text })
    expectDelim = undefined
    cur = undefined
  }
  const op = (o: Extract<Tok, { t: 'op' }>['op']) => {
    flush()
    toks.push({ t: 'op', op: o })
  }
  // `$(..)`, backticks, `<(..)`: the body is kept for recursive classification.
  const capture = (open: string, close: string, openAt: number, rawFrom: number): number => {
    const end = matchClose(src, openAt + 1, open, close)
    const stop = end < 0 ? src.length : end
    const w = word()
    w.subs.push(src.slice(openAt + 1, stop))
    w.dynamic = true
    w.text += src.slice(rawFrom, stop + 1)
    return stop
  }
  const readBodies = () => {
    for (const h of heredocs.splice(0)) {
      const lines: string[] = []
      while (i < src.length) {
        const nl = src.indexOf('\n', i)
        const line = src.slice(i, nl < 0 ? src.length : nl)
        i = nl < 0 ? src.length : nl + 1
        if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break
        lines.push(line)
      }
      h.tok.body = lines.join('\n')
    }
  }
  // A `$` outside single quotes. `quoted` = inside double quotes.
  const dollar = (quoted: boolean) => {
    const n = src[i + 1]
    if (n === '(') i = capture('(', ')', i + 1, i)
    else if (n === '{') {
      const end = matchClose(src, i + 2, '{', '}')
      const stop = end < 0 ? src.length - 1 : end
      const w = word()
      w.text += src.slice(i, stop + 1)
      w.dynamic = true
      i = stop
    } else if (n === "'" && !quoted) {
      const end = src.indexOf("'", i + 2)
      word().text += src.slice(i + 2, end < 0 ? src.length : end)
      i = end < 0 ? src.length : end
    } else if (n !== undefined && (NAME.test(n) || '@*#?!$-'.includes(n))) {
      let j = i + 1
      if (NAME.test(n)) while (j + 1 < src.length && NAME.test(src[j + 1]!)) j++
      const w = word()
      w.text += src.slice(i, j + 1)
      w.dynamic = true
      i = j
    } else word().text += '$'
  }

  while (i < src.length) {
    const c = src[i]!
    if (c === ' ' || c === '\t' || c === '\r') flush()
    else if (c === '\n') {
      op(';')
      i++
      readBodies()
      continue
    } else if (c === '#' && !cur) {
      while (i < src.length && src[i] !== '\n') i++
      continue
    } else if (c === '\\') {
      if (src[i + 1] === '\n') i++
      else {
        word().text += src[i + 1] ?? ''
        i++
      }
    } else if (c === "'") {
      const end = src.indexOf("'", i + 1)
      word().text += src.slice(i + 1, end < 0 ? src.length : end)
      i = end < 0 ? src.length : end
    } else if (c === '"') {
      word()
      i++
      while (i < src.length && src[i] !== '"') {
        const d = src[i]!
        if (d === '\\' && '$"`\\\n'.includes(src[i + 1] ?? 'x')) {
          if (src[i + 1] !== '\n') word().text += src[i + 1]
          i++
        } else if (d === '$') dollar(true)
        else if (d === '`') i = capture('`', '`', i, i)
        else word().text += d
        i++
      }
    } else if (c === '`') i = capture('`', '`', i, i)
    else if (c === '$') dollar(false)
    else if ((c === '<' || c === '>') && src[i + 1] === '(') i = capture('(', ')', i + 1, i)
    else if (c === '<' || c === '>' || (c === '&' && src[i + 1] === '>')) {
      const fd = cur && /^\d+$/.test(cur.text) ? cur.text : undefined
      if (fd !== undefined) cur = undefined
      flush()
      const m = at(REDIR, src, i)!
      const tok: Extract<Tok, { t: 'redir' }> = { t: 'redir', op: m[1]!, ...(fd ? { fd } : {}) }
      toks.push(tok)
      if (tok.op === '<<' || tok.op === '<<-') expectDelim = { tok, strip: tok.op === '<<-' }
      i += m[1]!.length - 1
    } else if (c === ';') op(';')
    else if (c === '&') {
      if (src[i + 1] === '&') (op('&&'), i++)
      else op('&')
    } else if (c === '|') {
      if (src[i + 1] === '|') (op('||'), i++)
      else {
        op('|')
        if (src[i + 1] === '&') i++
      }
    } else if (c === '(' || c === ')') op(c)
    else {
      const w = word()
      if (c === '*' || c === '?') w.glob = true
      else if (c === '[' && at(BRACKET, src, i)) w.glob = true
      else if (c === '{' && at(BRACE, src, i)) w.dynamic = true
      else if (c === '~' && w.text === '') w.tilde = true
      w.text += c
    }
    i++
  }
  flush()
  return toks
}
