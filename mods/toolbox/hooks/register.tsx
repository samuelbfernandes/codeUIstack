// toolbox: a side bar with the toolkit's mods and skills. Switches (green on, red off) flip at once by running the
// mod's own command; the skin dropdown switches at once through /skin; every other item is put in the prompt box
// (`$.prompt.fill`) for the person to read and send. Nothing here spends tokens or sends a prompt by itself.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { SKILLS, SKINS, SWITCHES, TOOLS, priced } from './catalog'
import type { Fill, Switch } from './catalog'
import { dropWith } from './reply'
import { plainWord } from './words'

type Dollar = EngineInterface

const PANE = 'toolbox'
const TITLE = 'Toolbox'
const COLUMNS = 40
const HINT = 'Side panel · use /tui fullscreen'
const FAILED = 'Toolbox · could not open'
/** Typed alone, these toggle the side bar like `/toolbox`. */
const PLAIN_WORDS = new Set(['toolbox', 'tools'])
const PANE_SURFACES = new Set(['terminal', 'desktop'])

const autoOpen = atom({ plugin: 'toolbox', key: 'autoOpen' } as const, 'new')

function defer($: Dollar, work: () => Promise<void>): void {
  $.clock.after(1, () => {
    work().catch(() => undefined)
  })
}

// The other mods' state this side bar reads. The engine wants each reference written out here, so the list of what a
// module reads can be checked; a mod that is not installed (or a read that is refused) reads as "cannot see".
const ASIDE_OFF = { plugin: 'aside', key: 'isOff' } as const
const SUGGEST_OFF = { plugin: 'suggest-model', key: 'isOff' } as const
const REFLECT_OFF = { plugin: 'reflect', key: 'isOff' } as const
const SECRET_ON = { plugin: 'secret-guard', key: 'isOn' } as const
const SKIN = { plugin: 'tool-skins', key: 'theme' } as const

async function valueOf(read: Promise<unknown>): Promise<unknown> {
  try {
    return ((await read) as { value?: unknown } | undefined)?.value
  } catch {
    return undefined
  }
}

async function seen($: Dollar): Promise<Record<Switch['id'] | 'skin', unknown>> {
  return {
    aside: await valueOf($.state.get(ASIDE_OFF as never)),
    suggest: await valueOf($.state.get(SUGGEST_OFF as never)),
    reflect: await valueOf($.state.get(REFLECT_OFF as never)),
    'secret-guard': await valueOf($.state.get(SECRET_ON as never)),
    skin: await valueOf($.state.get(SKIN as never)),
  }
}

const firstLine = (text: string | undefined): string => (text ?? '').split('\n')[0]?.trim() ?? ''

/** A switch click: run the mod's own `on` / `off` at once; its reply becomes a toast. */
async function flip($: Dollar, s: Switch, isOn: boolean): Promise<void> {
  try {
    const out = (await $.command.run({ command: s.command, args: isOn ? 'off' : 'on' })) as { text?: string } | undefined
    $.ui.toast(firstLine(out?.text) || `${s.label} · ${isOn ? 'off' : 'on'}`)
  } catch {
    $.ui.toast(`Toolbox · could not switch ${s.label}`)
  }
}

/** Any other click: the text goes in the prompt box; nothing is sent. */
async function fill($: Dollar, item: Fill): Promise<void> {
  try {
    const out = (await $.prompt.fill({ text: item.text } as never)) as { isFilled?: boolean } | undefined
    if (out?.isFilled === false) $.ui.toast(`Toolbox · type it yourself: ${item.text.trim()}`)
  } catch {
    $.ui.toast(`Toolbox · type it yourself: ${item.text.trim()}`)
  }
}

async function chooseSkin($: Dollar, name: string): Promise<void> {
  try {
    const out = (await $.command.run({ command: 'skin', args: name })) as { text?: string } | undefined
    $.ui.toast(firstLine(out?.text) || `Skin · ${name}`)
  } catch {
    $.ui.toast('Toolbox · could not switch the skin')
  }
}

async function isPaneOpen($: Dollar): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === PANE)
}

async function toggle($: Dollar): Promise<string> {
  await update($, autoOpen, () => 'done') // the person has taken over: never open it for them after this
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    return 'Toolbox · closed'
  }
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
  return opened.isPlaced ? 'Toolbox · open' : 'Toolbox · waiting for room\nTry /tui fullscreen, or a wider window.'
}

/** Once per session, from a timer: open where there is room; whether it docked is settled by its first drawing. */
async function autoOpenPane($: Dollar): Promise<void> {
  if ((await read($, autoOpen)) !== 'new') return
  await update($, autoOpen, () => 'done')
  if (await isPaneOpen($)) return
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
  if (opened.isPlaced) await update($, autoOpen, () => 'checking')
  else await $.ui.close({ id: PANE })
}

async function settleAutoOpen($: Dollar, placement: 'dock' | 'inline'): Promise<void> {
  if ((await read($, autoOpen)) !== 'checking') return
  await update($, autoOpen, () => 'done')
  if (placement !== 'dock') await $.ui.close({ id: PANE })
}

export const register: Register = (on, options) => {
  const isAutoOpen = options.autoOpen !== false

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'toolbox', description: 'Show or hide the toolbox side bar (typing toolbox does the same)' })
    } catch {
      // the plain word still works
    }
    if (isAutoOpen && e.isInteractive && e.surface !== null && PANE_SURFACES.has(e.surface)) defer($, () => autoOpenPane($))
    return next(e)
  })

  on('command.run', { command: 'toolbox' }, async $ => ({ text: await toggle($) })).catch(() => ({ text: FAILED }))

  on('prompt.submit', async ($, e, next) => {
    const word = plainWord(e)
    if (word === undefined || !PLAIN_WORDS.has(word)) return next(e)
    return dropWith(note => $.ui.log(note), await toggle($).catch(() => FAILED))
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Select, Text } = $.ui.resolve(e)
    if ((await read($, autoOpen)) === 'checking') defer($, () => settleAutoOpen($, e.props.placement))
    const isInline = e.props.placement === 'inline' || e.viewport?.isFullscreen === false
    if (e.surface === 'terminal' && isInline) return <Text dimColor>{HINT}</Text>

    // Switches: only the ones whose state this side bar can read; the pill is the button.
    const values = await seen($)
    const switches = []
    for (const s of SWITCHES) {
      const isOn = s.isOn(values[s.id])
      if (isOn === undefined) continue
      const bg = isOn ? 'success' : 'error'
      switches.push(
        <Box key={`pill:${s.id}`} backgroundColor={bg} paddingX={1}>
          <Button key={`switch:${s.id}`} plain onPress={() => flip($, s, isOn)}>
            <Text bold color="inverseText" backgroundColor={bg}>
              {`${priced(s.label, s.costs)} ${isOn ? 'on' : 'off'}`}
            </Text>
          </Button>
        </Box>,
      )
    }

    const theme = values.skin
    const item = (f: Fill, prefix: string) => (
      <Button key={`${prefix}:${f.id}`} plain onPress={() => fill($, f)}>
        {priced(f.label, f.costs)}
      </Button>
    )

    return (
      <Box flexDirection="column" gap={1}>
        {switches.length > 0 && (
          <Box flexDirection="column">
            <Text bold>Switches</Text>
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {switches}
            </Box>
          </Box>
        )}
        {typeof theme === 'string' && (
          <Select
            key="skin"
            label="Skin "
            value={SKINS.includes(theme) ? theme : SKINS[0]}
            options={SKINS.map(name => ({ value: name }))}
            onSelect={(name: string) => chooseSkin($, name)}
          />
        )}
        <Box flexDirection="column">
          <Text bold>Tools</Text>
          <Text dimColor>Click to put it in the prompt box</Text>
          {TOOLS.map(t => item(t, 'tool'))}
        </Box>
        <Box flexDirection="column">
          <Text bold>Skills</Text>
          {SKILLS.map(s => item(s, 'skill'))}
        </Box>
        <Text dimColor>$ = spends model tokens</Text>
      </Box>
    )
  })
}
