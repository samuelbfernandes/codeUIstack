import { test, expect } from 'claude-code/testing'

import { spawnSubagent } from '../hooks/actions'

test('a started subagent is ok, with the model passed through', async () => {
  const seen: unknown[] = []
  const r = await spawnSubagent(async a => (seen.push(a), { model: 'opus', agentId: 'a1' }) as never, 'fix the bug', 'opus')
  expect(r).toEqual({ ok: true })
  expect(seen[0]).toMatchObject({ prompt: 'fix the bug', model: 'opus' })
})

test('a denied spawn says why, so the toast can show the engine\'s own reason', async () => {
  const r = await spawnSubagent(async () => ({ deny: 'agents are off here' }) as never, 'x', 'opus')
  expect(r).toEqual({ ok: false, why: 'agents are off here' })
})

test('a throwing spawn says why and never throws', async () => {
  const r = await spawnSubagent(async () => { throw new Error('session not bound') }, 'x', 'sonnet')
  expect(r).toEqual({ ok: false, why: 'session not bound' })
})

test('a "no verdict, issue the action again" refusal is retried once and then reported', async () => {
  let calls = 0
  const flaky = await spawnSubagent(async () => (++calls === 1 ? { deny: 'The auto mode classifier gave no verdict for Agent. Issue the action again once, as-is.' } : {}) as never, 'x', 'opus')
  expect(flaky).toEqual({ ok: true })
  expect(calls).toBe(2)
  calls = 0
  const stuck = await spawnSubagent(async () => (++calls, { deny: 'gave no verdict' }) as never, 'x', 'opus')
  expect(stuck.ok).toBe(false)
  expect(calls).toBe(2) // never a third try
})
