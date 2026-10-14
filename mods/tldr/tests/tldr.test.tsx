import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { MARK, addMarks, markText, parseDigest } from '../hooks/lib'

const REPLY = [
  'I renamed the eight mods and ran every test.',
  'You need to restart the app before the new names load.',
  'Most of the work was mechanical: folders, manifests and docs.',
  'The ledger history of usage-meter starts fresh, because it was stored under the old name.',
  '```',
  'You need to restart the app before the new names load.',
  '```',
  ...Array.from({ length: 20 }, (_, i) => `Detail line ${i} about the change, kept long enough to pass the threshold.`),
].join('\n')
const ANSWER = JSON.stringify({
  summary: 'Eight mods renamed; tests pass.',
  needs: ['Restart the app'],
  next: ['Merge the PR'],
  mustRead: ['You need to restart the app before the new names load.', 'A sentence that is not in the reply at all.'],
})

function world(on: On) {
  const w = { calls: 0, filled: [] as string[], drawn: [] as string[], clock: mock.clock(on) }
  mock.store(on)
  on('model.complete', () => (w.calls++, { value: { isAnswered: true, text: '```json\n' + ANSWER + '\n```', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as never }))
  on('command.register', () => ({ value: undefined as never }))
  on('turn.complete', () => ({ text: '' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  // The engine's own drawing beneath: a reply is drawn as its text (rewritten or not); nothing else above the prompt.
  on('ui.render', ($$, e) => {
    if (e.component === 'AssistantMessage') w.drawn.push((e.props as { text: string }).text)
    const { Text } = $$.ui.resolve(e)
    return <Text>engine default</Text>
  })
  return w
}
const cmd = ($: Engine, args: string) => $.command.run({ command: 'tldr', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as never).then(r => r.text ?? '')
const reply = ($: Engine, answer = REPLY) => $.turn.complete({ answer, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} }
const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

test('parseDigest reads fenced JSON and keeps only must-read sentences that are in the reply word for word', () => {
  const d = parseDigest('```json\n' + ANSWER + '\n```', REPLY)!
  expect(d.summary).toBe('Eight mods renamed; tests pass.')
  expect(d.mustRead).toEqual(['You need to restart the app before the new names load.'])
  expect(parseDigest('not json', REPLY)).toBeUndefined()
  expect(parseDigest('{"summary": ""}', REPLY)).toBeUndefined()
})

test('markText bolds and flags each must-read sentence, but never inside code', () => {
  const out = markText(REPLY, ['You need to restart the app before the new names load.'])!
  expect(out).toContain(`**${MARK} You need to restart the app before the new names load.**`)
  expect(out.split(MARK).length - 1).toBe(1) // the copy inside the code fence is left exact
  expect(markText('nothing here', ['You need to restart'])).toBeUndefined()
  expect(markText(out, ['You need to restart the app before the new names load.'])).toBeUndefined() // already marked
  expect(addMarks(['a', 'b'], ['b', 'c'])).toEqual(['b', 'c', 'a'])
})

test('off by default: a long reply makes no model call', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true } as never)
  await reply($)
  await w.clock.advance(5)
  expect(w.calls).toBe(0)
})

test('on: a long reply gets one call, a box above the prompt and ⚑ on the must-read sentence in the reply', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true } as never)
  expect(await cmd($, 'on')).toContain('tldr · on')
  await reply($, 'short reply')
  await w.clock.advance(5)
  expect(w.calls).toBe(0) // under 800 characters: left alone
  await reply($)
  await w.clock.advance(5)
  expect(w.calls).toBe(1)
  const band = await $.ui.mount({ plugin: 'tldr', surface: 'terminal', component: 'AbovePrompt', props: BAND } as never)
  const shown = await texts(band)
  expect(shown).toContain('Eight mods renamed; tests pass.')
  expect(shown).toContain('⚑ Needs you')
  expect(shown).toContain('Restart the app')
  await $.ui.mount({ plugin: 'tldr', surface: 'terminal', component: 'AssistantMessage', props: { text: REPLY, isFirstOfReply: true } } as never)
  expect(w.drawn.at(-1)).toContain(`**${MARK} You need to restart the app before the new names load.**`) // the engine draws the marked text
  await band.press({ key: 'tldr:close' })
  expect(await texts(band)).not.toContain('Eight mods renamed')
  expect(await cmd($, 'off')).toBe('tldr · off')
})
