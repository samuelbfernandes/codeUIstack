// The predictor: a pure function from prompt text to a tier. It is a HEURISTIC (keyword
// weights plus a few size signals), not a measured router. No model call, no I/O.

export type Tier = 'light' | 'standard' | 'deep' | 'review'

export type Prediction = {
  tier: Tier
  /** Points behind the chosen tier (for review/light/deep the winning side, for standard its own). */
  score: number
  /** 0.3 to 0.97; how decisively the winner beat the other tiers. Not a probability. */
  confidence: number
  /** Short human labels of what matched, strongest first. */
  reasons: string[]
}

type Side = 'light' | 'standard' | 'deep' | 'review'
type Rule = {
  re: RegExp
  side: Side
  pts: number
  label: string
  /** The rule is off when this also matches (for example `translate` before a code word). */
  unless?: RegExp
}

const CODE_WORDS = String.raw`(?:code|function|script|package|module|class|[rR]|rust|python|julia|c\+\+|typescript|javascript)`

const RULES: Rule[] = [
  // ---- light: trivial edits and lookups
  { re: /\b(typos?|misspell\w*|spelling)\b/i, side: 'light', pts: 3, label: 'typo or spelling' },
  { re: /\brename\b/i, side: 'light', pts: 3, label: 'rename' },
  { re: /\b(re-?format|prettify|reindent|fix (the )?(indent\w*|whitespace|formatting))\b/i, side: 'light', pts: 3, label: 'formatting' },
  { re: /\b(add|write|insert) (a |an |some )?(short |brief )?(code )?(comments?|docstrings?|roxygen)\b/i, side: 'light', pts: 3, label: 'add a comment' },
  { re: /\b(change|set|bump|update) (the )?(constant|default|version|port|timeout|threshold|seed|color|colour|label|title)\b/i, side: 'light', pts: 3, label: 'change a constant' },
  { re: /\b(git (status|log|diff --stat|branch)|list (the |all )?(files|folders|directories)|which files|ls\b)/i, side: 'light', pts: 3, label: 'list or git status' },
  { re: /\bcommit message\b/i, side: 'light', pts: 3, label: 'commit message' },
  { re: /\b(explain|what does) (this|that|the) (one )?(line|regex|snippet|command|flag|error message|warning)\b/i, side: 'light', pts: 3, label: 'explain one line' },
  { re: new RegExp(String.raw`\btranslat\w+\b(?!.{0,40}\b${CODE_WORDS}\b)`, 'i'), side: 'light', pts: 3, label: 'translate text' },
  { re: /\b(boilerplate|scaffold(ing)?|skeleton|stub out|template for)\b/i, side: 'light', pts: 2, label: 'boilerplate' },
  { re: /\b(remove|delete|drop) (the )?(unused|dead|commented[- ]out|duplicate) \w+/i, side: 'light', pts: 3, label: 'remove unused code' },
  { re: /\b(quick(ly)?|tiny|trivial|tl;?dr|briefly|in one sentence)\b/i, side: 'light', pts: 1, label: 'asked to be quick' },
  { re: /\bone-?liner\b/i, side: 'light', pts: 2, label: 'one-liner' },
  { re: /\bjust\b/i, side: 'light', pts: 1, label: '"just"' },
  { re: /\b(what|which) (flag|option|argument|function|package|command|version|key) (does|do|is|should|am i|are we)\b/i, side: 'light', pts: 2, label: 'simple lookup' },
  { re: /\b(show|print|display|cat) (me )?(the )?(contents? of|first \d+ lines|head of)\b/i, side: 'light', pts: 2, label: 'show a file' },
  { re: /\b(add|remove|fix) (a |an |the )?(missing )?(import|library\(\w+\)|use statement|trailing (comma|whitespace|newline))/i, side: 'light', pts: 3, label: 'tiny edit' },
  { re: /\b(sort|alphabeti[sz]e|capitali[sz]e|lowercase|uppercase) (the |these |this )?\w+/i, side: 'light', pts: 1, label: 'simple edit' },

  // ---- standard: ordinary implementation
  { re: /\b(write|add|create|extend|update|fix) (a |an |the |some |more |new )?(unit |regression |integration )?(tests?|test cases?|testthat|pytest|specs?)\b/i, side: 'standard', pts: 3, label: 'write tests' },
  { re: /\b(testthat|pytest|cargo test|devtools::test|jest|vitest|expect_\w+)\b/i, side: 'standard', pts: 2, label: 'test framework' },
  { re: /\b(implement|write|add|create|build) (a |an |the |new )?(small |simple |helper |utility )?(function|method|endpoint|command|class|module|feature|option|flag|argument|parameter|wrapper|cli|script)\b/i, side: 'standard', pts: 3, label: 'implement a function' },
  { re: /\b(fix|debug|patch|resolve)\b.{0,40}\b(bug|error|failure|failing test|crash|exception|warning|issue)\b/i, side: 'standard', pts: 2, label: 'fix a bug' },
  { re: /\b(refactor|clean up|simplify|extract|deduplicate|inline)\b/i, side: 'standard', pts: 2, label: 'small refactor' },
  { re: /\b(ggplot2?|dplyr|tidyverse|data\.?frame|tibble|pandas|cargo|clippy|tokio|serde|lme4|sommer|asreml|rrBLUP)\b/i, side: 'standard', pts: 1, label: 'library task' },
  { re: /\b(plot|figure|table|summari[sz]e|parse|read|load|export|import) (the |a |this |these )?\w+/i, side: 'standard', pts: 1, label: 'data handling' },

  // ---- deep: proofs, design, hard debugging, method choice
  { re: /\b(derive|derivation|prove|proof|theorem|lemma|corollary|closed[- ]form|show that|analytic(al)? (solution|expression))\b/i, side: 'deep', pts: 4, label: 'proof or derivation' },
  { re: /\b(design|architect(ure)?|re-?architect)\b.{0,50}\b(algorithm|system|architecture|schema|api|pipeline|framework|data model|module structure)\b/i, side: 'deep', pts: 4, label: 'design work' },
  { re: /\b(system design|architecture|trade-?offs?|design decision)\b/i, side: 'deep', pts: 2, label: 'architecture or trade-offs' },
  { re: /\b(refactor|migrate|port|rewrite|restructure)\b.{0,60}\b(across|throughout|entire|whole|all (the )?(modules|files|packages|crates)|codebase|repo(sitory)?)\b/i, side: 'deep', pts: 4, label: 'cross-file refactor' },
  { re: /\b(across|spanning) (all|many|several|multiple|every) (the )?(files|modules|packages|crates|scripts)\b/i, side: 'deep', pts: 3, label: 'many files' },
  { re: /\b(port|rewrite|translate|convert)\b.{0,40}\b(to|into|in) (rust|c\+\+|julia)\b/i, side: 'deep', pts: 3, label: 'port to another language' },
  { re: /\b(race conditions?|deadlock\w*|data race|memory leak|segfault|use-after-free|heisenbug|non-?determinis\w*|flaky|borrow checker|lifetimes?)\b/i, side: 'deep', pts: 4, label: 'hard debugging' },
  { re: /\b(only sometimes|intermittent\w*|occasionally|randomly|only (when|on|after)\b|can'?t (reproduce|repro)|works on my machine)\b/i, side: 'deep', pts: 3, label: 'intermittent behaviour' },
  { re: /\bwhy (does|do|is|are|would)\b.{0,80}\bonly\b/i, side: 'deep', pts: 3, label: '"why ... only"' },
  { re: /\b(numerical(ly)? (stab\w+|precision|instab\w+|error)|ill-?conditioned|singular (matrix|information)|catastrophic cancellation|cholesky|eigen(value|vector|decomposition)?s?|convergence)\b/i, side: 'deep', pts: 3, label: 'numerical method' },
  { re: /\b(which|what) (statistical |estimation |modelling |modeling )?(method|test|model|estimator|approach|prior|link)\b.{0,60}\b(should|best|appropriate|use|choose)\b/i, side: 'deep', pts: 3, label: 'method choice' },
  { re: /\b(REML|BLUPs?|BLUE|variance components?|heritability|genomic (prediction|selection|relationship)|GBLUP|mixed models?|likelihood|posterior|MCMC|gibbs|bayesian|identifiab\w+|asymptotic\w*|unbiased(ness)?|multiple testing|false discovery|bootstrap)\b/i, side: 'deep', pts: 2, label: 'statistical theory' },
  { re: /\b(kinship|relationship matrix|GWAS|genome-?wide association|linkage disequilibrium|population structure|epistasis|QTL|breeding values?|selection index)\b/i, side: 'deep', pts: 2, label: 'quantitative genetics' },
  { re: /\b(experimental design|alpha[- ]lattice|incomplete block|split[- ]plot|augmented design|power analysis|sample size calculation|spatial (model|correlation))\b/i, side: 'deep', pts: 2, label: 'experimental design' },
  { re: /\b(simulat(e|es|ed|ion|ions|ing)|monte carlo|stochastic)\b/i, side: 'deep', pts: 2, label: 'simulation' },
  { re: /\b(change|switch|replace|swap|modify|rewrite|redo)\b.{0,30}\b(the )?(estimator|likelihood|prior|variance (model|structure)|link function|statistical method|statistical model|mixed model|model specification|test statistic)\b/i, side: 'deep', pts: 3, label: 'statistical method change' },
  { re: /\b(unsafe|send\s*\+\s*sync|interior mutability|trait objects?|proc[- ]macro|macro_rules|ffi)\b/i, side: 'deep', pts: 3, label: 'advanced Rust' },
  { re: /\b(non-?standard evaluation|tidy ?eval|rlang|Rcpp|RcppArmadillo|S4 (class|method)|R6)\b/i, side: 'deep', pts: 2, label: 'advanced R' },
  { re: /\b(security|threat model|vulnerabilit\w+|exploit|injection|xss|csrf|cve-\d+)\b/i, side: 'deep', pts: 3, label: 'security' },
  { re: /\bsecurity (review|audit)\b/i, side: 'deep', pts: 2, label: 'security review' },
  { re: /\b(time complexity|big-?o|O\([nN\w ^*+log]+\)|invariants?|correctness|formally|amortized)\b/i, side: 'deep', pts: 3, label: 'complexity or correctness' },
  { re: /\bimplement\b.{0,40}\b(algorithm|solver|sampler|optimi[sz]er|scheduler|parser|compiler|allocator|estimator)\b/i, side: 'deep', pts: 3, label: 'implement an algorithm' },
  { re: /\b(think (hard|carefully|deeply|step by step)|ultrathink|take your time|be (very )?(careful|thorough|rigorous))\b/i, side: 'deep', pts: 3, label: 'asked to think hard' },
  { re: /\b(thoroughly|rigorous(ly)?|in depth|in-depth|exhaustive(ly)?|carefully)\b/i, side: 'deep', pts: 1, label: 'asked to be careful' },

  // ---- review: review, second opinion, audit, falsify
  { re: /\b(second opinion|falsif\w+|try to (break|refute|disprove)|devil'?s advocate|red[- ]team)\b/i, side: 'review', pts: 7, label: 'second opinion or falsify' },
  { re: /\bcheck (my|our|the|this) (derivation|proof|math|algebra|calculations?|reasoning|argument|results?|statistics|analysis)\b/i, side: 'review', pts: 7, label: 'check a derivation' },
  { re: /\breview (my|our|the|this|these) (diff|pr|pull request|code|changes|patch|commit|branch|implementation|derivation|proof|analysis|manuscript|draft)\b/i, side: 'review', pts: 4, label: 'review request' },
  { re: /\b(review|check|verify|validate)\b.{0,40}\b(REML|BLUPs?|mixed model|likelihood|estimator|statistical method|GWAS|kinship|variance components?|simulation|power analysis)\b/i, side: 'review', pts: 4, label: 'review of method code' },
  { re: /\b(code review|peer review|audit)\b/i, side: 'review', pts: 3, label: 'review or audit', unless: /\bsecurity (review|audit)\b/i },
  { re: /\b(sanity[- ]check|double[- ]check|cross-?check|verify (that|my|the|this))\b/i, side: 'review', pts: 1, label: 'verify' },
]

const PATH_RE = /(?:^|[\s"'`(\[])@?((?:[\w.-]+[/\\])*[\w.-]+\.(?:R|r|Rmd|qmd|rs|py|ts|tsx|js|jsx|mjs|json|toml|md|csv|tsv|txt|yml|yaml|c|cc|cpp|h|hpp|go|java|sh|ps1|tex|bib|sql|ipynb|lock|cfg|ini))\b/g
const MENTION_RE = /(?:^|\s)@([\w./\\-]+)/g

/** Distinct file paths and @mentions named in the text. */
export function namedFiles(text: string): string[] {
  const found = new Set<string>()
  for (const m of text.matchAll(PATH_RE)) if (m[1]) found.add(m[1].toLowerCase())
  for (const m of text.matchAll(MENTION_RE)) if (m[1]) found.add(m[1].toLowerCase())
  return [...found]
}

const PRIOR_CONTEXT =
  /\b(it|this|that|these|those|above|below|earlier|previous(ly)?|before|same|again)\b|\bthe (file|code|function|error|bug|test|script|plot|result|output)s? we\b|\bas (we )?(discussed|said|mentioned)\b|\bwe (just |already )?(did|discussed|wrote|made|ran|saw)\b|\byou (just )?(said|wrote|made|ran|suggested)\b/i

/** Pronouns and phrases that point back at the conversation (the prompt is not self-contained). */
export const refsPriorContext = (text: string): boolean => PRIOR_CONTEXT.test(text)

export const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length

const clamp = (n: number, lo: number, hi: number): number => Math.round(Math.min(hi, Math.max(lo, n)) * 100) / 100

type Tally = Record<Side, number>
type Hit = { label: string; side: Side; pts: number }

function runRules(text: string): { tally: Tally; hits: Hit[] } {
  const tally: Tally = { light: 0, standard: 0, deep: 0, review: 0 }
  const hits: Hit[] = []
  for (const rule of RULES) {
    if (!rule.re.test(text) || (rule.unless && rule.unless.test(text))) continue
    tally[rule.side] += rule.pts
    hits.push({ label: rule.label, side: rule.side, pts: rule.pts })
  }
  return { tally, hits }
}

/** Size and shape signals: file count, length, code blocks, question marks. */
function runShape(text: string, words: number, tally: Tally, hits: Hit[]): void {
  const add = (side: Side, pts: number, label: string) => {
    tally[side] += pts
    hits.push({ label, side, pts })
  }
  const files = namedFiles(text).length
  if (files >= 5) add('deep', 4, `names ${files} files`)
  else if (files >= 3) add('deep', 2, `names ${files} files`)
  else if (files >= 1) add('standard', 1, files === 1 ? 'names one file' : 'names two files')

  if (words >= 500) add('deep', 3, `very long prompt (${words} words)`)
  else if (words >= 250) add('deep', 2, `long prompt (${words} words)`)
  else if (words >= 120) add('deep', 1, `longish prompt (${words} words)`)

  const blocks = Math.floor((text.match(/```/g) ?? []).length / 2)
  if (blocks >= 3) add('deep', 1, `${blocks} code blocks`)
  else if (blocks >= 1) add('standard', 1, 'has a code block')

  const questions = (text.match(/\?/g) ?? []).length
  if (questions >= 3) add('deep', 1, `${questions} questions`)
  // A short, plain question with nothing technical attached is a lookup, unless it leans on the conversation.
  if (questions === 1 && words <= 14 && files === 0 && blocks === 0 && tally.deep === 0 && tally.review === 0 && !refsPriorContext(text))
    add('light', 2, 'short question')
}

/** Lowercase tier words for the dialog and the status line. */
export const TIER_WORD: Record<Tier, string> = { light: 'LIGHT', standard: 'STANDARD', deep: 'DEEP', review: 'REVIEW' }

/**
 * Predicts the tier of a prompt. Rules in short:
 *  - review wins when its points are at least 3 and at least the deep points;
 *  - deep needs 3+ points and a lead of 1 over standard and light;
 *  - light needs 2+ points and a lead of 1 over standard and deep;
 *  - anything else is standard.
 * Confidence is 0.5 + 0.1 x the lead (capped 0.97) for the three decided tiers, so a lead of 1 is 0.6,
 * 2 is 0.7 and 3 is 0.8.
 */
export function predict(text: string): Prediction {
  const words = wordCount(text)
  const { tally, hits } = runRules(text)
  runShape(text, words, tally, hits)
  const std = Math.min(tally.standard, 5) // many weak standard words must not outvote one clear signal

  const reasonsFor = (side: Side): string[] =>
    [...new Set(hits.filter(h => h.side === side).sort((a, b) => b.pts - a.pts).map(h => h.label))]

  if (tally.review >= 3 && tally.review >= tally.deep) {
    return { tier: 'review', score: tally.review, confidence: clamp(0.4 + 0.1 * tally.review, 0.5, 0.97), reasons: reasonsFor('review') }
  }
  const deepLead = tally.deep - Math.max(tally.light, std)
  if (tally.deep >= 3 && deepLead >= 1) {
    return { tier: 'deep', score: tally.deep, confidence: clamp(0.5 + 0.1 * deepLead, 0.5, 0.97), reasons: reasonsFor('deep') }
  }
  const lightLead = tally.light - Math.max(tally.deep, std)
  if (tally.light >= 2 && lightLead >= 1) {
    return { tier: 'light', score: tally.light, confidence: clamp(0.5 + 0.1 * lightLead, 0.5, 0.97), reasons: reasonsFor('light') }
  }
  const strongest = Math.max(tally.light, tally.deep)
  const reasons = reasonsFor('standard')
  return {
    tier: 'standard',
    score: std,
    confidence: clamp(0.55 + 0.08 * std - 0.12 * strongest, 0.3, 0.95),
    reasons: reasons.length > 0 ? reasons : ['no strong signal'],
  }
}

/** True when a prompt matches a rule strong enough to be judged even though it is short. */
export function isStrong(p: Prediction): boolean {
  return p.tier !== 'standard' && p.score >= 4
}
