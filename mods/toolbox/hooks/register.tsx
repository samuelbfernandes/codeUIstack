// toolbox: a side bar with the toolkit's mods and skills. Switches (green on, red off) flip at once by running the
// mod's own command; the skin dropdown switches at once through /skin; every other item is put in the prompt box
// (`$.prompt.fill`) for the person to read and send. Nothing here spends tokens or sends a prompt by itself.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { SKILLS, SKINS, TOOLS, priced } from './catalog'
import type { Fill, SwitchId, Tool } from './catalog'
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

async function seen($: Dollar): Promise<Record<SwitchId | 'skin', unknown>> {
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
async function flip($: Dollar, s: Tool, isOn: boolean): Promise<void> {
  try {
    const out = (await $.command.run({ command: s.command ?? s.id, args: isOn ? 'off' : 'on' })) as { text?: string } | undefined
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
    const readers: Record<SwitchId, (v: unknown) => boolean | undefined> = {
      aside: v => (typeof v === 'boolean' ? !v : undefined),
      suggest: v => (typeof v === 'boolean' ? !v : undefined),
      reflect: v => (typeof v === 'boolean' ? !v : undefined),
      'secret-guard': v => (typeof v === 'boolean' ? v : undefined),
    }

    // Every row is a box with a round border, one per row. A switch is green (on) or red (off).
    const row = (key: string, child: unknown, color?: string) => (
      <Box key={key} borderStyle="round" borderColor={color} paddingX={1}>
        {child as never}
      </Box>
    )
    const fillButton = (key: string, label: string, f: Fill | { text: string }, costs?: boolean) => (
      <Button key={key} plain onPress={() => fill($, { label, text: f.text, costs })}>
        {priced(label, costs)}
      </Button>
    )

    const tools = TOOLS.map(t => {
      if (t.isSkin) {
        // tool-skins keeps its theme in state only once one has been picked, so an unset one reads as the default.
        const theme = typeof values.skin === 'string' && SKINS.includes(values.skin) ? values.skin : SKINS[0]!
        return row(
          'row:skin',
          <Select key="skin" label="Skin " value={theme} options={SKINS.map(name => ({ value: name }))} onSelect={(name: string) => chooseSkin($, name)} />,
        )
      }
      if (t.switchId !== undefined) {
        const isOn = readers[t.switchId](values[t.switchId])
        if (isOn !== undefined) {
          const bg = isOn ? 'success' : 'error'
          return (
            <Box key={`row:${t.id}`} borderStyle="round" borderColor={bg} backgroundColor={bg} paddingX={1}>
              <Button key={`switch:${t.id}`} plain onPress={() => flip($, t, isOn)}>
                <Text bold color="inverseText" backgroundColor={bg}>
                  {`${priced(t.label, t.costs)} · ${isOn ? 'on' : 'off'}`}
                </Text>
              </Button>
            </Box>
          )
        }
      }
      if (t.fill !== undefined) return row(`row:${t.id}`, fillButton(`tool:${t.id}`, t.label, { text: t.fill }, t.costs))
      return row(`row:${t.id}`, <Text dimColor>{`${t.label} · ${t.note ?? 'runs by itself'}`}</Text>)
    })

    const skills = SKILLS.map(k => row(`row:skill:${k.id}`, fillButton(`skill:${k.id}`, k.label, k)))

    // Options sit below the tools, indented under the mod they belong to.
    const options = TOOLS.filter(t => (t.options ?? []).length > 0).map(t => (
      <Box key={`options:${t.id}`} flexDirection="column">
        <Text dimColor>{t.label}</Text>
        <Box flexDirection="column" paddingLeft={2}>
          {(t.options ?? []).map(o => fillButton(`option:${t.id}:${o.text}`, o.label, o, o.costs))}
        </Box>
      </Box>
    ))

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>Tools</Text>
          <Text dimColor>Green or red: click to switch. Others: click to put it in the prompt box</Text>
          {tools}
        </Box>
        <Box flexDirection="column">
          <Text bold>Skills</Text>
          {skills}
        </Box>
        <Box flexDirection="column">
          <Text bold>Options</Text>
          {options}
        </Box>
        <Text dimColor>$ = spends model tokens</Text>
      </Box>
    )
  })
}
