import { atom, read, update } from 'claude-code'
import type { Hook, PluginOptions, Register } from 'claude-code'

import type { Scope } from '../types'
import { looksLikeCorrection } from './prefilter'
import { SYSTEM, appendRule, buildPrompt, parseReply, vetRule } from './rule'
import { dropWith } from './reply'
import { plainWord } from './words'

type Dollar = Parameters<Hook<'prompt.submit'>>[0]

const proposal = atom({ plugin: 'reflect', key: 'proposal' } as const, null)
const isEditing = atom({ plugin: 'reflect', key: 'isEditing' } as const, false)
const seq = atom({ plugin: 'reflect', key: 'seq' } as const, 0)
/** Mirror of the persisted on/off switch (`$.store` 'off'), so a side bar can show it and redraw when it flips. */
const isOff = atom({ plugin: 'reflect', key: 'isOff' } as const, false)

const DEFAULT_MODEL = 'haiku'
const PROJECT_FILE = './CLAUDE.md'
const GLOBAL_FILE = '~/.claude/CLAUDE.md'

// Prompts that are not the person's own words are never analysed.
const NOT_THE_PERSON = new Set([
  'plugin', 'task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay',
  'channel', 'coordinator', 'observer', 'observer-activity', 'auto-continuation', 'slack-ping',
])

// ------------------------------------------------------------ options & state

const modelOf = (options: PluginOptions): string => {
  const m = options.model
  return typeof m === 'string' && m.trim() !== '' ? m.trim() : DEFAULT_MODEL
}

/** `enabled` from userConfig wins; `/reflect off` is a persistent second switch. */
async function isOn($: Dollar, options: PluginOptions): Promise<boolean> {
  if (options.enabled === false) return false
  try {
    return (await $.store.get('off')) !== true
  } catch {
    return true
  }
}

async function hide($: Dollar): Promise<void> {
  if ((await read($, proposal)) !== null) await update($, proposal, () => null)
  if (await read($, isEditing)) await update($, isEditing, () => false)
}

// ------------------------------------------------------------------ analysis

async function lastAssistantText($: Dollar): Promise<string | undefined> {
  try {
    const rows = await $.session.messages()
    if (!Array.isArray(rows)) return undefined
    return rows.findLast(m => m.role === 'assistant' && m.text.trim() !== '')?.text
  } catch {
    return undefined
  }
}

async function hasSurface($: Dollar): Promise<boolean> {
  try {
    return (await $.session.surfaces()).length > 0 // none in a plain `claude -p` run: no band to draw
  } catch {
    return true
  }
}

/** The one small-model call. Runs from a timer, never inside the prompt's dispatch. */
async function analyse($: Dollar, n: number, text: string, last: string | undefined, model: string): Promise<void> {
  try {
    const r = await $.model.complete({
      model,
      system: SYSTEM,
      prompt: buildPrompt(text, last),
      maxTokens: 300,
      effort: 'low',
      timeoutMs: 20_000,
    })
    if (!r.isAnswered) return
    const reply = parseReply(r.text)
    if (reply === null) return
    if ((await read($, seq)) !== n) return // a newer prompt was submitted meanwhile: stale, drop
    await update($, proposal, () => reply)
  } catch {
    // fail open: no proposal, nothing else changes
  }
}

/** Pre-filters, then hands the model call to a timer so the turn never waits for it. */
async function onSubmit($: Dollar, e: { text: string; origin: { kind: string } }, options: PluginOptions): Promise<void> {
  const n = await update($, seq, v => v + 1) // invalidates replies still in flight
  await hide($)
  if (!(await isOn($, options))) return
  if (NOT_THE_PERSON.has(e.origin.kind) || !looksLikeCorrection(e.text)) return
  if (!(await hasSurface($))) return
  const last = options.includeLastReply === false ? undefined : await lastAssistantText($)
  const model = modelOf(options)
  $.clock.after(0, () => analyse($, n, e.text, last, model))
}

// ---------------------------------------------------------------------- save

async function locate($: Dollar, scope: Scope): Promise<{ path: string; label: string } | null> {
  if (scope === 'project') {
    const cwd = (await $.session.cwd()).replace(/\/+$/, '')
    return { path: `${cwd}/CLAUDE.md`, label: PROJECT_FILE }
  }
  const home = await $.env.get('HOME')
  return home ? { path: `${home.replace(/\/+$/, '')}/.claude/CLAUDE.md`, label: GLOBAL_FILE } : null
}

/** Appends the rule to the scope's CLAUDE.md and says so in a toast. Never throws. */
async function saveRule($: Dollar, raw: string, scope: Scope): Promise<void> {
  let label = scope === 'project' ? PROJECT_FILE : GLOBAL_FILE
  try {
    const rule = vetRule(raw)
    if (rule === null) return $.ui.toast('Reflect · not saved (empty rule or AI attribution)')
    const target = await locate($, scope)
    if (target === null) return $.ui.toast('Reflect · not saved (home folder not found)')
    label = target.label
    // A file that exists but cannot be read must not be overwritten: the read throws to the catch.
    const existing = (await $.fs.exists(target.path)) ? await $.fs.read(target.path) : null
    const out = appendRule(existing, rule)
    if (out.status === 'duplicate') return $.ui.toast(`Already in ${label}`)
    await $.fs.write(target.path, out.text)
    $.ui.toast(`✓ Saved to ${label}`)
  } catch {
    $.ui.toast(`Reflect · could not save to ${label}`)
  }
}

// ------------------------------------------------------------------ command

/** What `/reflect` and its plain words say: a headline, then at most three short lines. */
async function runCommand($: Dollar, args: string, options: PluginOptions): Promise<string> {
  const arg = args.trim().toLowerCase()
  if (arg === 'off') {
    await $.store.set('off', true)
    await update($, isOff, () => true)
    await hide($)
    return 'Reflect · off\nNothing is sent to a model.'
  }
  if (arg === 'on' && options.enabled === false) {
    return 'Reflect · off\nTurned off in the plugin settings (/config).'
  }
  if (arg === 'on') {
    await $.store.delete('off')
    await update($, isOff, () => false)
  }
  const on = await isOn($, options)
  const pending = await read($, proposal)
  const lines = [
    `Reflect · ${on ? 'on' : 'off'}`,
    on ? `Corrections are checked with ${modelOf(options)}.` : 'Nothing is sent to a model.',
    pending === null ? 'No rule waiting.' : `Waiting · “${pending.rule}”`,
  ]
  if (arg !== '' && arg !== 'on' && arg !== 'status') lines[1] = 'Use on, off or status.'
  return lines.join('\n')
}

// ------------------------------------------------------------------ plain words

const COMMAND_FAILED = 'Reflect · that did not work\nNothing changed.'
const PLAIN_ARGS: Record<string, string> = { 'reflect status': 'status', 'reflect off': 'off', 'reflect on': 'on' }

/** The `/reflect` argument a typed plain word stands for, or undefined for any other prompt. */
const plainArgs = (word: string | undefined): string | undefined => (word === undefined ? undefined : PLAIN_ARGS[word])

// ------------------------------------------------------------------ register

/** What the hooks below this one drew in the band. Only one tree can fill the band, so a mod that draws returns its row with this under it (never instead of it), and the other mods' rows stay visible. */
async function drawnBelow<E>(next: (e: E) => unknown, e: E): Promise<object | undefined> {
  try {
    const tree = await next(e)
    return tree !== null && typeof tree === 'object' ? tree : undefined
  } catch {
    return undefined
  }
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    try {
      const stored = (await $.store.get('off')) === true // the switch outlives the session
      await update($, isOff, () => stored)
    } catch {
      // the mirror then says on, as the default does
    }
    try {
      await $.command.register({
        name: 'reflect',
        description: 'Turn corrections into saved rules: on, off or status (typing reflect status does the same)',
        argumentHint: 'on|off|status',
      })
    } catch {
      // no command, the mod still works
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'reflect' }, async ($, e) => ({ text: await runCommand($, e.args, options) })).catch(
    () => ({ text: COMMAND_FAILED }),
  )

  // Fail OPEN: whatever goes wrong here, the prompt is submitted exactly as typed.
  // The one exception is deliberate: the exact plain words `reflect status|on|off` run the /reflect command and are
  // dropped (they never reach a model, nor the correction analysis below); if that command throws, the word is still
  // dropped with the short failure notice, since sending it on would only cost a model request for a command.
  // Every other prompt is never rewritten, dropped or delayed; the model call runs from a timer.
  on('prompt.submit', async ($, e, next) => {
    const args = plainArgs(plainWord(e))
    if (args !== undefined) return dropWith({ log: text => $.ui.log(text) }, await runCommand($, args, options).catch(() => COMMAND_FAILED))
    try {
      await onSubmit($, e, options)
    } catch {
      // ignore: reflect is a convenience
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const offer = await read($, proposal)
    if (offer === null || e.props.hasSurvey) return next(e)
    // The band is raised on these two surfaces only; narrowing gives `Input` its type.
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)

    const editing = await read($, isEditing)
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const other: Scope = offer.scope === 'project' ? 'global' : 'project'
    const nameOf = (scope: Scope) => (scope === 'project' ? PROJECT_FILE : GLOBAL_FILE)

    const decide = async (scope: Scope | null, text?: string) => {
      const current = await read($, proposal)
      if (current === null) return
      await hide($) // consume first: a second press cannot save twice
      if (scope !== null) await saveRule($, text ?? current.rule, scope)
    }

    const target = nameOf(editing ? 'project' : offer.scope) // an edited rule is saved to the project

    const row = (
      <Box key="reflect-row" flexDirection="column">
        <Text dimColor>{`● Reflect · ${target}`}</Text>
        <Text>{`“${offer.rule}”`}</Text>
        {editing ? (
          <Box gap={1}>
            <Input
              key="edit"
              label="Rule "
              value={offer.rule}
              submitLabel="Save"
              autoFocus
              onSubmit={value => decide('project', value)}
            />
            <Button key="cancel" label="Cancel" onPress={() => update($, isEditing, () => false)} />
          </Box>
        ) : (
          <Box gap={1} flexWrap="wrap">
            <Button key="save" variant="primary" hotkey="s" label="Save" onPress={() => decide(offer.scope)} />
            <Button key="other" hotkey="g" label={other === 'global' ? 'Global' : 'Project'} onPress={() => decide(other)} />
            <Button key="edit" hotkey="e" label="Edit" onPress={() => update($, isEditing, () => true)} />
            <Button key="skip" hotkey="k" label="Skip" onPress={() => decide(null)} />
          </Box>
        )}
      </Box>
    )
    const below = await drawnBelow(next, e)
    return below === undefined ? row : <Box key="reflect-band" flexDirection="column">{row}{below as never}</Box>
  }).catch(($, e, next) => next(e)) // fail open: the engine draws its own (empty) band
}
