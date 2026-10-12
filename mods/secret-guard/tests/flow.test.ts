// The hooks end to end: tool results, the row the model reads, typed prompts, /secret-guard, switches, settings.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { HOLD_REASON } from '../hooks/report'
import { body, fake } from './fixtures'
import { SURFACES, answered, world } from './world'
import type { Surface } from './world'

const GH = fake.github()
const readRecord = (content: string) => ({ type: 'text', file: { filePath: '/work/.env', content, numLines: 3, startLine: 1, totalLines: 3 } })
const call = ($: Engine, tool: string, args: Record<string, unknown> = {}) => $.tool.call({ tool, ...args } as never) as Promise<Record<string, any>>
const typed = ($: Engine, text: string, origin: { kind: string; name?: string } = { kind: 'composer' }, extra: object = {}) =>
  $.prompt.submit({ text, wait: false, origin, ...extra } as never) as Promise<{ text?: string; drop?: string }>
/** The /secret-guard report text, which is multi-line: a headline, then detail lines. */
const slash = ($: Engine, args = '') =>
  $.command.run({ command: 'secret-guard', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
const report = async ($: Engine, args = '') => (await slash($, args)).text ?? ''
const start = ($: Engine, surface: Surface = 'terminal') => $.session.start({ cwd: '/work', surface, isInteractive: true })
const everything = (w: { logs: string[] }, ...more: unknown[]) => JSON.stringify([w.logs, more])

// ------------------------------------------------------------------------------------------ tool results

test('Read: the secret is replaced in the record, ref and text are dropped so core maps it again, one dim line says so', async ($, on) => {
  const w = world(on, { tools: { Read: () => answered(readRecord(`A=1\nGITHUB_TOKEN=${GH}\nDB_PASSWORD=Sup3rS3cretPass\n`)) } })
  const r = await call($, 'Read', { file_path: '/work/.env' })
  expect(r.result.file.content).toBe('A=1\nGITHUB_TOKEN=[secret:github-token]\nDB_PASSWORD=[secret:password]\n')
  expect(r.result.file.filePath).toBe('/work/.env')
  expect(r.result.file.numLines).toBe(3)
  expect(r.result.type).toBe('text')
  expect(r.ref).toBeUndefined()
  expect(r.text).toBeUndefined()
  expect(w.logs).toEqual(['Secret guard · hid 2 secrets from tool output'])
})

test('a clean result goes through exactly as core gave it, with its ref and text, and nothing is logged', async ($, on) => {
  const w = world(on, { tools: { Read: () => answered(readRecord('x <- rnorm(10)\nsha 3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f\n')) } })
  const r = await call($, 'Read')
  expect(r.ref).toBe(7)
  expect(r.text).toBe('what the model would read')
  expect(r.result.file.content).toContain('rnorm')
  expect(w.logs).toEqual([])
})

test('Bash stdout and stderr, Grep matches and WebFetch text are all scrubbed; a path in filenames is left alone', async ($, on) => {
  const w = world(on, {
    tools: {
      Bash: () => answered({ stdout: `export K=${fake.anthropic()}\n`, stderr: `warn: password: hunter2hunter2\n`, interrupted: false }),
      Grep: () => answered({ mode: 'content', numFiles: 1, filenames: ['/work/.env'], content: `.env:3:STRIPE=${fake.stripeLive()}`, numLines: 1 }),
      WebFetch: () => answered({ bytes: 9, code: 200, codeText: 'OK', result: `Authorization: Bearer ${body(40)}`, durationMs: 5, url: 'https://example.org/docs' }),
    },
  })
  const bash = await call($, 'Bash', { command: 'env' })
  expect(bash.result).toEqual({ stdout: 'export K=[secret:anthropic-key]\n', stderr: 'warn: password: [secret:password]\n', interrupted: false })
  const grep = await call($, 'Grep', { pattern: 'STRIPE' })
  expect(grep.result.content).toBe('.env:3:STRIPE=[secret:stripe-key]')
  expect(grep.result.filenames).toEqual(['/work/.env'])
  const fetched = await call($, 'WebFetch', { url: 'https://example.org/docs', prompt: 'x' })
  expect(fetched.result.result).toBe('Authorization: Bearer [secret:bearer-token]')
  expect(fetched.result.url).toBe('https://example.org/docs')
  expect(everything(w, bash, grep, fetched)).not.toContain(fake.anthropic())
})

test('an MCP tool result of any shape is scrubbed; the context beside a result is passed on as it came (the engine allows no rewrite of it)', async ($, on) => {
  world(on, {
    tools: {
      mcp__lab__notes: () => answered({ content: [{ type: 'text', text: `token: ${body(20)}` }, { type: 'image', data: body(50) }] }, { context: ['reminder one', 'plain'] }),
      mcp__lab__plain: () => answered(`just text with ${fake.awsKey()}`),
    },
  })
  const r = await call($, 'mcp__lab__notes')
  expect(r.result.content[0].text).toBe('token: [secret:token]')
  expect(r.result.content[1].data).toBe(body(50)) // media is never touched
  expect(r.context).toEqual(['reminder one', 'plain'])
  expect((await call($, 'mcp__lab__plain')).result).toBe('just text with [secret:aws-access-key]')
})

test('tools whose result is not text for the model (Glob, Edit) are left to the row-level net, not rewritten here', async ($, on) => {
  world(on, { tools: { Glob: () => answered({ filenames: [`/work/${GH}.txt`], numFiles: 1, durationMs: 1, truncated: false }) } })
  const r = await call($, 'Glob', { pattern: '*' })
  expect(r.ref).toBe(7)
  expect(r.result.filenames[0]).toContain(GH)
})

test('an errored result and a denial pass through untouched here (the row net handles the error text)', async ($, on) => {
  world(on, {
    tools: {
      Bash: () => ({ isError: true, result: `exit 1: ${GH}`, text: `exit 1: ${GH}`, ref: 3 }),
      Read: () => ({ deny: 'nope' }),
    },
  })
  const err = await call($, 'Bash', { command: 'cat .env; false' })
  expect(err.isError).toBe(true)
  expect(err.ref).toBe(3)
  expect(await call($, 'Read')).toEqual({ deny: 'nope' })
})

test('the note speaks once per turn: later redactions are silent until the next prompt, and it counts what was hidden', async ($, on) => {
  const w = world(on, { tools: { Bash: () => answered({ stdout: `k=${fake.github(1)} and ${fake.github(2)}`, stderr: '', interrupted: false }) } })
  await call($, 'Bash')
  await call($, 'Bash')
  expect(w.logs).toEqual(['Secret guard · hid 2 secrets from tool output'])
  await typed($, 'next question')
  await call($, 'Bash')
  expect(w.logs).toEqual(['Secret guard · hid 2 secrets from tool output', 'Secret guard · hid 2 secrets from tool output'])
  expect(await report($)).toBe('Secret guard · on · hid 6 secrets this session\nTool output: github-token 6\nType /secret-guard off to pause it.')
})

test('one secret reads as "1 secret"', async ($, on) => {
  const w = world(on, { tools: { Bash: () => answered({ stdout: `k=${GH}`, stderr: '', interrupted: false }) } })
  await call($, 'Bash')
  expect(w.logs).toEqual(['Secret guard · hid 1 secret from tool output'])
})

test('fail open: a log that is down never undoes the redaction', async ($, on) => {
  const w = world(on, { tools: { Bash: () => answered({ stdout: `k=${GH}`, stderr: '', interrupted: false }) } })
  w.failLog = true
  const r = await call($, 'Bash')
  expect(r.result.stdout).toBe('k=[secret:github-token]')
})

// ------------------------------------------------------------------------------------------ the row the model reads

const row = (content: unknown[]) => ({
  message: { type: 'user' as const, content: content as never },
  door: 'tool-result' as const,
  origin: { kind: 'tool' as const, tool: 'Bash' },
  uuid: 'row-1',
})

test('session.append net: a tool_result row is scrubbed whatever the tool, errors included; ids and media are kept', async ($, on) => {
  const w = world(on)
  const stored = await $.session.append(
    row([
      { type: 'tool_result', tool_use_id: 'toolu_1', is_error: true, content: `exit 1\nGITHUB_TOKEN=${GH}` },
      { type: 'tool_result', tool_use_id: 'toolu_2', content: [{ type: 'text', text: `password: hunter2hunter2` }, { type: 'image', source: { data: body(30) } }] },
      { type: 'text', text: `also ${fake.awsKey()}` },
    ]) as never,
  )
  const blocks = (stored as { message: { content: any[] } }).message.content
  expect(blocks[0]).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true, content: 'exit 1\nGITHUB_TOKEN=[secret:github-token]' })
  expect(blocks[1].content[0].text).toBe('password: [secret:password]')
  expect(blocks[1].content[1].source.data).toBe(body(30))
  expect(blocks[2].text).toBe('also [secret:aws-access-key]')
  expect(w.logs).toEqual(['Secret guard · hid 3 secrets from tool output'])
  expect(JSON.stringify(w.session.appended())).not.toContain(GH)
})

test('session.append net: only the tool-result door; a clean row is stored as it came; the model own text is not touched', async ($, on) => {
  const w = world(on)
  const clean = await $.session.append(row([{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'all good' }]) as never)
  expect((clean as { message: { content: unknown[] } }).message.content).toEqual([{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'all good' }])
  const said = await $.session.append({ message: { type: 'assistant', content: [{ type: 'text', text: `the model typed ${GH}` }] }, door: 'response', origin: { kind: 'model', model: 'm' }, uuid: 'resp-1' } as never)
  expect(JSON.stringify(said)).toContain(GH)
  expect(w.logs).toEqual([])
})

// ------------------------------------------------------------------------------------------ typed prompts

for (const surface of SURFACES) {
  test(`typed prompt on ${surface}: a clean prompt is never asked about`, async ($, on) => {
    const w = world(on, { surface })
    await start($, surface)
    const r = await typed($, 'please fit the model with lme4 and plot the BLUPs')
    expect(r.text).toBe('please fit the model with lme4 and plot the BLUPs')
    expect(w.asks).toEqual([])
  })

  test(`typed prompt on ${surface}: one question, kinds only; "Send redacted" sends the redacted text, attachments kept`, async ($, on) => {
    const w = world(on, { surface, answer: 'Send redacted' })
    await start($, surface)
    const text = `use GITHUB_TOKEN=${GH} and password: hunter2hunter2 to clone`
    const r = await typed($, text, { kind: 'composer' }, { attachments: [{ type: 'image' }] })
    expect(w.asks).toHaveLength(1)
    expect(w.asks[0]!.header).toBe('Secret guard')
    expect(w.asks[0]!.options).toEqual(['Send redacted', 'Send as typed', 'Hold it'])
    expect(w.asks[0]!.question).toBe('This prompt seems to contain 2 secrets (github-token, password). How should it be sent?')
    expect(w.asks[0]!.question).not.toContain(GH)
    expect(r.text).toBe('use GITHUB_TOKEN=[secret:github-token] and password: [secret:password] to clone')
    expect(w.submitted).toEqual([r.text])
    expect(w.submittedAttachments).toEqual([[{ type: 'image' }]])
    expect(JSON.stringify(w.logs)).not.toContain(GH)
  })

  test(`typed prompt on ${surface}: "Send as typed" sends exactly what was typed and is counted`, async ($, on) => {
    const w = world(on, { surface, answer: 'Send as typed' })
    await start($, surface)
    const text = `my token is ${GH}`
    const r = await typed($, text)
    expect(r.text).toBe(text)
    expect(w.submitted).toEqual([text])
    expect(await report($)).toBe('Secret guard · on · nothing hidden yet\nTyped prompts: sent as typed 1\nType /secret-guard off to pause it.')
  })

  test(`typed prompt on ${surface}: "Hold it" holds with one reason line and an echo with the secret hidden`, async ($, on) => {
    const w = world(on, { surface, answer: 'Hold it' })
    await start($, surface)
    const r = await typed($, `line one\n  indented ${GH}\nline three`)
    expect(r.drop).toBe(HOLD_REASON)
    expect(r.drop).toBe('secret-guard blocked your prompt · nothing was sent')
    expect(r.drop).not.toContain('\n')
    expect(w.submitted).toEqual([])
    expect(w.logs).toEqual(['Held text, secrets hidden:\nline one\n  indented [secret:github-token]\nline three'])
    expect(JSON.stringify(w.logs)).not.toContain(GH)
  })
}

for (const answer of ['REJECT', 'something else entirely'])
  test(`typed prompt: answer "${answer}" holds and counts the hold`, async ($, on) => {
    const w = world(on, { answer })
    await start($)
    expect((await typed($, `k=${GH}`)).drop).toBe(HOLD_REASON)
    expect(w.submitted).toEqual([])
    expect(await report($)).toBe('Secret guard · on · nothing hidden yet\nTyped prompts: held 1\nType /secret-guard off to pause it.')
  })

test('the held echo is capped and keeps the start of a long prompt', async ($, on) => {
  const w = world(on, { answer: 'Hold it' })
  await start($)
  await typed($, `${'word '.repeat(1000)}${GH}`)
  expect(w.logs[0]!.length).toBeLessThan(2100)
  expect(w.logs[0]).toMatch(/^Held text, secrets hidden:\nword word/)
  expect(w.logs[0]!.endsWith('…')).toBe(true)
})

test('only the person is asked: notifications, schedules, peers, plugins and the SDK pass untouched', async ($, on) => {
  const w = world(on, { answer: 'Hold it' })
  await start($)
  for (const origin of [{ kind: 'task-notification' }, { kind: 'scheduled-trigger' }, { kind: 'peer' }, { kind: 'plugin', name: 'other' }, { kind: 'sdk' }]) {
    const text = `from ${origin.kind}: ${GH}`
    expect((await typed($, text, origin)).text).toBe(text)
  }
  expect(w.asks).toEqual([])
  expect(w.submitted).toHaveLength(5)
})

test('the phone bridge is the person too', async ($, on) => {
  const w = world(on, { answer: 'Send redacted' })
  await start($)
  const r = await typed($, `k=${GH}`, { kind: 'bridge' })
  expect(w.asks).toHaveLength(1)
  expect(r.text).toBe('k=[secret:github-token]')
})

test('askOnPrompt=false: typed prompts are not checked at all', { options: { askOnPrompt: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  const text = `k=${GH}`
  expect((await typed($, text)).text).toBe(text)
  expect(w.asks).toEqual([])
})

// ------------------------------------------------------------------------------------------ /secret-guard, switches

test('session start registers /secret-guard', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.registered).toEqual(['secret-guard'])
})

test('/secret-guard reports counts by kind, never a secret', async ($, on) => {
  const w = world(on, {
    tools: { Bash: () => answered({ stdout: `a=${GH}\nb=${fake.awsKey()}\nDB_PASSWORD=Sup3rS3cretPass\nx=${fake.github(5)}`, stderr: '', interrupted: false }) },
  })
  await start($)
  await call($, 'Bash')
  const text = await report($)
  for (const secret of [GH, fake.github(5), fake.awsKey(), 'Sup3rS3cretPass']) expect(text + everything(w)).not.toContain(secret)
  expect(text).toBe('Secret guard · on · hid 4 secrets this session\nTool output: github-token 2 · aws-access-key 1 · password 1\nType /secret-guard off to pause it.')
  expect(w.submitted).toEqual([])
})

test('nothing hidden yet is said plainly', async ($, on) => {
  world(on)
  await start($)
  expect((await slash($)).text).toBe('Secret guard · on · nothing hidden yet\nType /secret-guard off to pause it.')
})

test('a bare typed word is not handled: it goes to the model unchanged and the switch is unchanged', async ($, on) => {
  const w = world(on)
  await start($)
  const texts = ['secret-guard', 'Secret-Guard.', 'secret-guard off', 'please run secret-guard off for me', 'secret-guard status']
  for (const text of texts) expect(await typed($, text), text).toEqual({ text })
  expect(w.submitted).toEqual(texts)
  expect(w.stored).toEqual([])
  expect(await report($)).toContain('Secret guard · on')
})

test('/secret-guard off and on: remembered in the store, tool output and typed prompts follow, the report says so', async ($, on) => {
  const w = world(on, { tools: { Bash: () => answered({ stdout: `k=${GH}`, stderr: '', interrupted: false }) } })
  await start($)
  expect(await report($, 'off')).toBe('Secret guard · off · nothing hidden yet\nType /secret-guard on to resume.')
  expect(w.stored).toEqual([['enabled', false]])
  expect((await call($, 'Bash')).result.stdout).toBe(`k=${GH}`)
  expect((await typed($, `k=${GH}`)).text).toBe(`k=${GH}`)
  expect(w.asks).toEqual([])
  expect(await report($, ' ON ')).toContain('Secret guard · on · nothing hidden yet')
  expect(w.stored).toEqual([['enabled', false], ['enabled', true]])
  expect((await call($, 'Bash')).result.stdout).toBe('k=[secret:github-token]')
  expect(await report($, 'maybe')).toBe('Secret guard · unknown option “maybe”\nUse /secret-guard, /secret-guard on or /secret-guard off.')
})

test('the off switch survives a new session: the store is read at session start', async ($, on) => {
  world(on, { store: { enabled: false }, tools: { Bash: () => answered({ stdout: `k=${GH}`, stderr: '', interrupted: false }) } })
  await start($)
  expect((await call($, 'Bash')).result.stdout).toBe(`k=${GH}`)
  expect((await slash($)).text).toBe('Secret guard · off · nothing hidden yet\nType /secret-guard on to resume.')
})

test('enabled=false in settings: nothing is hidden or asked, and /secret-guard says it is the setting', { options: { enabled: false } }, async ($, on) => {
  const w = world(on, { tools: { Bash: () => answered({ stdout: `k=${GH}`, stderr: '', interrupted: false }) } })
  await start($)
  expect((await call($, 'Bash')).result.stdout).toBe(`k=${GH}`)
  expect((await typed($, `k=${GH}`)).text).toBe(`k=${GH}`)
  expect(w.asks).toEqual([])
  expect(await report($, 'on')).toBe('Secret guard · off in settings · nothing hidden yet\nTurn it on in the plugin settings.')
  expect((await call($, 'Bash')).result.stdout).toBe(`k=${GH}`)
})

// ------------------------------------------------------------------------------------------ settings

test('redactEmails default: emails stay as they are', async ($, on) => {
  world(on, { tools: { Read: () => answered(readRecord('contact: jane@uni.example.edu')) } })
  expect((await call($, 'Read')).result.file.content).toBe('contact: jane@uni.example.edu')
})

test('redactEmails=true: emails become [secret:email]', { options: { redactEmails: true } }, async ($, on) => {
  world(on, { tools: { Read: () => answered(readRecord('contact: jane@uni.example.edu')) } })
  expect((await call($, 'Read')).result.file.content).toBe('contact: [secret:email]')
})

test('extraPatterns: custom kind, and a bad pattern is reported at session start and by /secret-guard, never thrown', { options: { extraPatterns: 'LAB-[0-9]{6};;(oops;;a*' } }, async ($, on) => {
  const w = world(on, { tools: { Read: () => answered(readRecord('sample LAB-123456 ok')) } })
  await start($)
  expect(w.logs).toHaveLength(2)
  expect(w.logs[0]).toMatch(/^Secret guard · extra pattern 2 is not a valid regular expression \(/)
  expect(w.logs[1]).toBe('Secret guard · extra pattern 3 matches empty text, ignored')
  expect((await call($, 'Read')).result.file.content).toBe('sample [secret:custom] ok')
  const text = await report($)
  expect(text).toContain('Secret guard · on · hid 1 secret this session')
  expect(text).toContain('Problem: extra pattern 3 matches empty text, ignored')
})
