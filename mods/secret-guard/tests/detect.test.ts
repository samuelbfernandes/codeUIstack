// Every pattern: what it hides, what it keeps, and the look-alikes that must pass untouched.
import { expect, test } from 'claude-code/testing'

import { BUILTIN_RULES, EMAIL_RULE, isPlaceholder, parseExtra, rulesFor } from '../hooks/detect'
import type { Rule } from '../hooks/detect'
import { redact } from '../hooks/detect'
import { body, fake } from './fixtures'

const RULES: readonly Rule[] = BUILTIN_RULES
const run = (text: string, rules: readonly Rule[] = RULES) => redact(text, rules)
const kinds = (text: string) => Object.keys(run(text).hits).sort()

/** The text is hidden: the value is gone, the placeholder of `kind` is there. */
function hides(text: string, value: string, kind: string, rules: readonly Rule[] = RULES) {
  const out = run(text, rules)
  expect(out.text).not.toContain(value)
  expect(out.text).toContain(`[secret:${kind}]`)
  expect(out.hits[kind]).toBeGreaterThanOrEqual(1)
}

/** The text passes through untouched. */
const keeps = (text: string) => expect(run(text)).toEqual({ text, hits: {} })

// ------------------------------------------------------------------------------------------ private keys

test('PEM private key: the whole block goes, the text around it stays', () => {
  const pem = fake.pem()
  const out = run(`before\n${pem}\nafter`)
  expect(out.text).toBe('before\n[secret:private-key]\nafter')
  expect(out.hits).toEqual({ 'private-key': 1 })
})

test('PEM private key: OPENSSH, EC, PGP and plain PKCS8 labels', () => {
  for (const label of ['OPENSSH PRIVATE KEY', 'EC PRIVATE KEY', 'PRIVATE KEY', 'ENCRYPTED PRIVATE KEY', 'PGP PRIVATE KEY BLOCK']) {
    const block = fake.pem(label, 2)
    expect(run(`k:\n${block}\n`).text).toBe('k:\n[secret:private-key]\n')
  }
})

test('PEM private key: escaped inside JSON (service-account files) and with CRLF', () => {
  const json = `{"private_key": "-----BEGIN PRIVATE KEY-----\\n${body(64)}\\n${body(64, 9)}\\n-----END PRIVATE KEY-----\\n"}`
  const out = run(json)
  expect(out.text).not.toContain(body(64))
  expect(out.hits['private-key']).toBe(1)
  expect(run(fake.pem().replace(/\n/g, '\r\n')).text).toBe('[secret:private-key]')
})

test('PEM private key: a block whose END line was cut off by a truncated read still goes', () => {
  const cut = fake.pem().split('\n').slice(0, 3).join('\n')
  const out = run(`${cut}\n`)
  expect(out.text).not.toContain(body(64))
  expect(out.hits['private-key']).toBe(1)
})

test('PEM: public keys, certificates and a header mentioned in code or docs are not private keys', () => {
  keeps(fake.pem('PUBLIC KEY'))
  keeps(fake.pem('CERTIFICATE'))
  keeps('if "-----BEGIN RSA PRIVATE KEY-----" in text: warn()')
  keeps('grep -r "BEGIN PRIVATE KEY" .')
})

// ------------------------------------------------------------------------------------------ AWS

test('AWS access key id', () => {
  hides(`key id ${fake.awsKey()} here`, fake.awsKey(), 'aws-access-key')
  hides(`ASIA${body(16).toUpperCase()}`, 'ASIA', 'aws-access-key')
})

test('AWS pair: id and secret on one line (csv, shell, JSON), the secret is its own kind', () => {
  const secret = fake.awsSecret()
  for (const line of [`${fake.awsKey()},${secret}`, `${fake.awsKey()} ${secret}`, `"${fake.awsKey()}": "${secret}"`, `${fake.awsKey()}:${secret}`]) {
    const out = run(line)
    expect(out.text).not.toContain(secret)
    expect(out.hits).toEqual({ 'aws-secret-key': 1, 'aws-access-key': 1 })
  }
})

test('AWS secret by name: ini, env, JSON and camel-case spellings; the name stays', () => {
  const secret = fake.awsSecret()
  for (const line of [`aws_secret_access_key = ${secret}`, `AWS_SECRET_ACCESS_KEY="${secret}"`, `"SecretAccessKey": "${secret}"`, `export AWS_SECRET_ACCESS_KEY=${secret}`]) {
    const out = run(line)
    expect(out.text).not.toContain(secret)
    expect(out.hits['aws-secret-key']).toBe(1)
  }
  expect(run(`aws_secret_access_key = ${secret}`).text).toBe('aws_secret_access_key = [secret:aws-secret-key]')
})

test('AWS: look-alikes stay (short id, lower-case, a sha after a key id, a 40-character string with no name)', () => {
  keeps('AKIA is the prefix of an access key id')
  keeps(`AKIA${body(10).toUpperCase()}`)
  keeps(`akia${body(16).toLowerCase()}`)
  keeps(`${fake.awsKey().replace('AKIA', 'AKIB')}`)
  expect(kinds(`${fake.awsKey()} ${'a1b2c3d4e5'.repeat(4)}`)).toEqual(['aws-access-key']) // lower-case hex is a hash, not a secret
  keeps(`sha: ${body(40, 3)}`)
  keeps(`arn:aws:iam::123456789012:user/${body(12)}`)
})

// ------------------------------------------------------------------------------------------ vendor tokens

test('GitHub tokens: ghp_, gho_, github_pat_', () => {
  hides(`GITHUB_TOKEN=${fake.github()}`, fake.github(), 'github-token')
  hides(`token ${fake.githubOauth()}`, fake.githubOauth(), 'github-token')
  hides(`use ${fake.githubFine()}.`, fake.githubFine(), 'github-token')
  expect(run(`export GITHUB_TOKEN=${fake.github()}`).text).toBe('export GITHUB_TOKEN=[secret:github-token]')
})

test('GitHub: the prefix alone, a short value and a word that merely contains it are not tokens', () => {
  keeps('ghp_ tokens start with ghp_')
  keeps('ghp_abc123')
  keeps(`ghx_${body(36)}`)
  keeps(`my_ghp_${body(10)}`.replace('my_', 'my.')) // a name that happens to contain ghp_ but is short
})

test('GitLab, npm, Hugging Face and Google keys', () => {
  hides(`glab ${fake.gitlab()}`, fake.gitlab(), 'gitlab-token')
  hides(`//registry.npmjs.org/:_authToken=${fake.npm()}`, fake.npm(), 'npm-token')
  hides(`HF_TOKEN=${fake.hf()}`, fake.hf(), 'huggingface-token')
  hides(`key=${fake.google()}&x=1`, fake.google(), 'google-api-key')
})

test('Anthropic and OpenAI keys', () => {
  hides(`ANTHROPIC_API_KEY=${fake.anthropic()}`, fake.anthropic(), 'anthropic-key')
  hides(`OPENAI_API_KEY=${fake.openaiProject()}`, fake.openaiProject(), 'openai-key')
  hides(`key: ${fake.openaiLegacy()}`, fake.openaiLegacy(), 'openai-key')
  expect(kinds(fake.anthropic())).toEqual(['anthropic-key']) // not also an OpenAI key
})

test('OpenAI look-alikes: sk-learn, task-style words and short or digit-less strings stay', () => {
  keeps('pip install sk-learn-pipeline-with-transformers-and-more')
  keeps('see the sk-learn docs')
  keeps(`desk-${body(40)}`)
  keeps(`sk-${'abcdefghij'.repeat(5)}`) // 50 letters, no digit: a word, not a key
  keeps('sk-short123')
})

test('Slack tokens and webhooks', () => {
  hides(`SLACK_BOT_TOKEN=${fake.slack()}`, fake.slack(), 'slack-token')
  hides(`curl -X POST ${fake.slackWebhook()}`, fake.slackWebhook(), 'slack-webhook')
  keeps('https://hooks.slack.com/services/')
  keeps('xoxb- is the bot token prefix')
})

test('Stripe secret, restricted and webhook keys; the publishable key is public and stays', () => {
  hides(`STRIPE=${fake.stripeLive()}`, fake.stripeLive(), 'stripe-key')
  hides(`rk ${fake.stripeTest()}`, fake.stripeTest(), 'stripe-key')
  hides(`whsec ${fake.stripeHook()}`, fake.stripeHook(), 'stripe-key')
  keeps(`publishable ${fake.stripePublishable()}`)
})

// ------------------------------------------------------------------------------------------ JWT, Authorization, URLs

test('JWT: three dot-separated base64url parts starting eyJ', () => {
  hides(`session=${fake.jwt()};`, fake.jwt(), 'jwt')
  hides(`{"id_token":"${fake.jwt()}"}`, fake.jwt(), 'jwt')
})

test('JWT look-alikes: two parts, version strings and file names stay', () => {
  keeps(`eyJ${body(12)}.${body(12)}`)
  keeps('eyJ is how base64 JSON starts, e.g. eyJhbGciOi')
  keeps('library.min.v1.2.3.js and archive.tar.gz')
})

test('Authorization header: Bearer, Basic and Token; the header name stays', () => {
  const token = `${body(30)}.${body(10)}-${body(8)}`
  hides(`Authorization: Bearer ${token}`, token, 'bearer-token')
  hides(`-H "authorization: bearer ${token}"`, token, 'bearer-token')
  hides(`Authorization: Basic ${body(24)}==`, body(24), 'auth-header')
  hides(`"Authorization": "Token ${token}"`, token, 'auth-header')
  expect(run(`Authorization: Bearer ${token}`).text).toBe('Authorization: Bearer [secret:bearer-token]')
})

test('Authorization look-alikes: variables, placeholders, short values and prose stay', () => {
  keeps('Authorization: Bearer $GITHUB_TOKEN')
  keeps('Authorization: Bearer ${TOKEN}')
  keeps('Authorization: Bearer <your-token-here>')
  keeps('Authorization: Bearer YOUR_ACCESS_TOKEN_HERE')
  keeps('Authorization: Bearer abc123')
  keeps('the Authorization header carries a Bearer token')
})

test('password inside a URL: only the password goes', () => {
  const out = run('DATABASE_URL=postgres://analyst:Tr0ub4dor-3xyz@db.example.org:5432/genomes')
  expect(out.text).toBe('DATABASE_URL=postgres://analyst:[secret:url-password]@db.example.org:5432/genomes')
  hides('git clone https://me:hunter2pass@github.com/lab/repo.git', 'hunter2pass', 'url-password')
})

test('URL look-alikes: no password, variables, ports and ssh remotes stay', () => {
  keeps('https://github.com/lab/repo.git')
  keeps('ssh://git@github.com:22/lab/repo.git')
  keeps('git@github.com:lab/repo.git')
  keeps('http://localhost:8080/path')
  keeps('postgres://user:${DB_PASSWORD}@host/db')
  keeps('postgres://user:$DB_PASSWORD@host/db')
  keeps('postgres://user:<password>@host/db')
  keeps('https://host:8080/path@x')
})

// ------------------------------------------------------------------------------------------ password = ... lines

test('assignments in .env, YAML, JSON, Python and shell: the name stays, the value is hidden', () => {
  const cases: [string, string, string][] = [
    ['API_KEY=abcd1234efgh5678', 'abcd1234efgh5678', 'api-key'],
    ['DB_PASSWORD=Sup3rS3cretPass', 'Sup3rS3cretPass', 'password'],
    ['password: hunter2hunter2', 'hunter2hunter2', 'password'],
    ['  token: "9f8e7d6c5b4a3d2e"', '9f8e7d6c5b4a3d2e', 'token'],
    ['"client_secret": "wJalrXUtnFEMI-K7MDENG"', 'wJalrXUtnFEMI-K7MDENG', 'secret'],
    ["SECRET_KEY = 'django-insecure-9x8y7z6w5v'", 'django-insecure-9x8y7z6w5v', 'secret'],
    ['accessToken: "q1w2e3r4t5y6u7i8"', 'q1w2e3r4t5y6u7i8', 'token'],
    ['export MY_PASSWORD="pa55w0rd!!x"', 'pa55w0rd!!x', 'password'],
    ['mysql --user=root --password=Zx9Cv8Bn7Mm6', 'Zx9Cv8Bn7Mm6', 'password'],
    ['passphrase := "correct-horse-9-battery"', 'correct-horse-9-battery', 'password'],
    ["'password' => 'abc12345xyz'", 'abc12345xyz', 'password'],
    ['{password: abc12345xyz}', 'abc12345xyz', 'password'],
    ['private_key = "k3y-m4t3r14l-0123"', 'k3y-m4t3r14l-0123', 'private-key'],
  ]
  for (const [text, value, kind] of cases) hides(text, value, kind)
  expect(run('password: hunter2hunter2').text).toBe('password: [secret:password]')
  expect(run('"token": "9f8e7d6c5b4a3d2e",').text).toBe('"token": "[secret:token]",')
})

test('assignments in R: = and <- with a literal are hidden, `password <- NULL` and environment lookups are not', () => {
  hides('Sys.setenv(MY_TOKEN = "a1b2c3d4e5f6g7h8")', 'a1b2c3d4e5f6g7h8', 'token')
  hides('password <- "hunter2hunter2"', 'hunter2hunter2', 'password')
  hides('con <- dbConnect(RPostgres::Postgres(), password = "Zx9Cv8Bn7Mm6")', 'Zx9Cv8Bn7Mm6', 'password')
  keeps('password <- NULL')
  keeps('password = NULL')
  keeps('password <- Sys.getenv("DB_PASSWORD")')
  keeps('token <- readline("Token: ")')
  keeps('api_key <- keyring::key_get("openai")')
  keeps('password <- ""')
  keeps('secret <- FALSE')
})

test('assignment look-alikes in code: types, references, paths, counters and plain words stay', () => {
  for (const line of [
    'password: str',
    'password: str = ""',
    'token: Optional[str] = None',
    'def login(username, password):',
    'max_tokens: 4096',
    'token_count = 123456789',
    'tokenizer = AutoTokenizer.from_pretrained(name)',
    'password: ${DB_PASSWORD}',
    'password = $DB_PASSWORD',
    'password: <your password>',
    'password=changeme',
    'API_KEY=your-api-key-here',
    'API_KEY=YOUR_API_KEY_HERE_PLEASE',
    'secret: true',
    'token: process.env.GITHUB_TOKEN',
    'password = os.environ["DB_PASSWORD"]',
    'password = os.getenv("DB_PASSWORD", default)',
    'token: tokenizer.json',
    'secret: /run/secrets/db_password',
    'password_file: /etc/app/password.txt',
    'token = "secret"',
    'password: "enter your password"',
    'password: "required"',
    'token: ${{ secrets.GITHUB_TOKEN }}',
    'secretary: abcdefghijkl1234',
    'keyboard: abcdefghijkl1234',
    'passwords: abcdefghijkl1234',
    'auth: abcdefghijkl1234',
    'if (password == input) stop()',
    'The password is stored in a vault.',
    'Reset your password: click the link in the email',
    'token: refresh_token_value',
    'secret_santa: yes',
    'private_key: PKCS7PrivateKeyTypes,',
    'password: URLPatternComponentResult;',
    'cancellationToken: HostCancellationToken;',
    'const browserToken = this.config.browser.launchOptions?.channel ?? other;',
    'const progressToken = request.params._meta?.progressToken;',
    'const openingParenToken = firstTokenAfterArrow;',
    'var mapToken = mapToken2;',
    '__pyx_v_token = __pyx_t_2;',
    'const UNEXPECTED_TOKEN = /^Unexpected token/i',
    "'encryption_file_password': 'encryptionFilePassword'",
    '_token = "(%s)|(%s)|(%s)" % (a, b, c)',
    ':param token: REQUIRED.  The token that the client wants.',
    'token = my_token_value_2024',
    'password: SecretStr = Field(...)',
  ])
    keeps(line)
})

test('assignment value rules: 7 characters is too short, 8 is hidden, quotes and trailing comments are kept', () => {
  keeps('password: abc1234')
  hides('password: abc12345', 'abc12345', 'password')
  expect(run('password: abc12345xyz # the lab account').text).toBe('password: [secret:password] # the lab account')
  expect(run('password = "abc12345xyz"').text).toBe('password = "[secret:password]"')
})

test('no key name, no hit: git SHAs, hex hashes, base64 data and sample IDs pass untouched', () => {
  keeps('commit 3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f')
  keeps('sha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  keeps('md5sum: d41d8cd98f00b204e9800998ecf8427e')
  keeps(`data:image/png;base64,${body(300)}==`)
  keeps(`BLOB=${body(200)}`)
  keeps('sample_id: NA12878-WGS-0042 plate P07_B03')
  keeps('GENOME_BUILD=GRCh38.p14')
  keeps('x <- rnorm(1000); fit <- lm(y ~ x)')
  keeps('0123456789abcdef0123456789abcdef01234567')
})

// ------------------------------------------------------------------------------------------ emails, extras, helpers

test('emails: off by default, hidden when asked; git remotes are not emails', () => {
  const text = 'Contact jane.doe@uni.example.edu or see git@github.com:lab/repo.git; sample a@b is not one.'
  keeps(text)
  const on = redact(text, rulesFor({ redactEmails: true, extra: [] }))
  expect(on.text).toBe('Contact [secret:email] or see git@github.com:lab/repo.git; sample a@b is not one.')
  expect(on.hits).toEqual({ email: 1 })
  expect(EMAIL_RULE.kind).toBe('email')
})

test('extra patterns: one per ;; or line, /re/flags keeps its flags, kind is custom', () => {
  const extra = parseExtra('LAB-[0-9]{6};;/internal-[a-z]+/i\nproject-x-[0-9a-f]{8}')
  expect(extra.problems).toEqual([])
  expect(extra.rules).toHaveLength(3)
  const out = redact('ids LAB-123456 and Internal-Alpha and project-x-0a1b2c3d', rulesFor({ redactEmails: false, extra: extra.rules }))
  expect(out.text).toBe('ids [secret:custom] and [secret:custom] and [secret:custom]')
  expect(out.hits).toEqual({ custom: 3 })
})

test('extra patterns: a bad regex, bad flags and a pattern that matches nothing are reported, not thrown', () => {
  const extra = parseExtra('(unclosed;;ok-[0-9]+;;/x/zz;;a*;;')
  expect(extra.rules).toHaveLength(1)
  expect(extra.problems).toHaveLength(3)
  expect(extra.problems[0]).toContain('extra pattern 1')
  expect(extra.problems[0]).toContain('not a valid regular expression')
  expect(extra.problems[1]).toContain('extra pattern 3')
  expect(extra.problems[2]).toContain('extra pattern 4 matches empty text')
  expect(parseExtra('').problems).toEqual([])
  expect(parseExtra(undefined).rules).toEqual([])
  expect(parseExtra(42).rules).toEqual([])
})

test('the placeholder never carries the value, a second pass changes nothing, and counts add up', () => {
  const text = [`GITHUB_TOKEN=${fake.github()}`, `password: hunter2hunter2`, fake.pem(), `Authorization: Bearer ${body(32)}`].join('\n')
  const once = run(text)
  expect(once.hits).toEqual({ 'github-token': 1, password: 1, 'private-key': 1, 'bearer-token': 1 })
  for (const value of [fake.github(), 'hunter2hunter2', body(64), body(32)]) expect(once.text).not.toContain(value)
  expect(run(once.text)).toEqual({ text: once.text, hits: {} })
})

test('isPlaceholder: stand-ins yes, real-looking values no', () => {
  for (const v of ['xxxxxxxx', '********', 'YOUR_KEY_HERE', '${TOKEN}', '$TOKEN', '%TOKEN%', '<token>', 'changeme', 'password', 'redacted', 'example-key-1234'])
    expect(isPlaceholder(v)).toBe(true)
  for (const v of ['Tr0ub4dor-3xyz', 'a1b2c3d4e5f6', body(30)]) expect(isPlaceholder(v)).toBe(false)
})

test('text shorter than 8 characters and empty text are returned as they are', () => {
  expect(run('')).toEqual({ text: '', hits: {} })
  expect(run('ghp_abc')).toEqual({ text: 'ghp_abc', hits: {} })
})

test('speed: a megabyte of base64 on one line, and of ordinary prose, is scanned in well under a second each', () => {
  const blob = body(1_000_000)
  const prose = 'The quick brown fox jumps over the lazy dog, token counts and password policy notes. '.repeat(12_000)
  for (const text of [blob, prose, `${blob}=`.repeat(1)]) {
    const t0 = Date.now()
    const out = run(text)
    expect(Date.now() - t0).toBeLessThan(1500)
    expect(out.hits).toEqual({})
  }
})
