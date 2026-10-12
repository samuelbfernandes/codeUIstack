// moddeck: a side bar with the toolkit's mods and skills, one boxed row each. A switch (green on, red off) flips at once by
// running the mod's own command; the skin dropdown switches at once through /skin; a row runs its command at once when
// that is harmless, or puts it in the prompt box (`$.prompt.fill`) when it needs your text or changes something.
// Nothing here spends tokens or sends a prompt by itself.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { SKILLS, SKINS, TOOLS, priced, splitCommand } from './catalog'
import type { Action, Tool } from './catalog'

type Dollar = EngineInterface

const PANE = 'moddeck'
const TITLE = 'Moddeck'
const COLUMNS = 40
const HINT = 'Side panel · use /tui fullscreen'
const FAILED = 'Moddeck · could not open'
const PANE_SURFACES = new Set(['terminal', 'desktop'])

const autoOpen = atom({ plugin: 'moddeck', key: 'autoOpen' } as const, 'new')
/** First skill shown in the skills window: the list scrolls here, a few rows at a time, when there are many. */
const skillTop = atom({ plugin: 'moddeck', key: 'skillTop' } as const, 0)
const DEFAULT_SKILL_ROWS = 4

function defer($: Dollar, work: () => Promise<void>): void {
  $.clock.after(1, () => {
    work().catch(() => undefined)
  })
}

// The other mods' state this side bar reads. The engine wants each reference written out here, so the list of what a
// module reads can be checked; a mod that is not installed (or a read that is refused) reads as "cannot see".
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

const firstLine = (text: string | undefined): string => (text ?? '').split('\n')[0]?.trim() ?? ''

/** Show a command's reply: its first line as a toast, the whole text in the transcript. */
function show($: Dollar, text: string | undefined, fallback: string): void {
  const body = (text ?? '').trim()
  $.ui.toast(firstLine(body) || fallback)
  if (body.includes('\n')) $.ui.log(body)
}

/** A switch click: run the mod's own `on` / `off` at once. */
async function flip($: Dollar, s: Tool, isOn: boolean): Promise<void> {
  try {
    const out = (await $.command.run({ command: s.command ?? s.id, args: isOn ? 'off' : 'on' })) as { text?: string } | undefined
    show($, out?.text, `${s.label} · ${isOn ? 'off' : 'on'}`)
  } catch {
    $.ui.toast(`Moddeck · could not switch ${s.label}`)
  }
}

/** Run the command now, or (when it needs your text or changes something) put it in the prompt box; nothing is sent. */
async function act($: Dollar, action: Action): Promise<void> {
  const typed = action.text.trim()
  try {
    if (action.run) {
      const { command, args } = splitCommand(action.text)
      const out = (await $.command.run({ command, args })) as { text?: string } | undefined
      show($, out?.text, `Moddeck · ${typed}`)
      return
    }
    const out = (await $.prompt.fill({ text: action.text } as never)) as { isFilled?: boolean } | undefined
    if (out?.isFilled === false) $.ui.toast(`Moddeck · type it yourself: ${typed}`)
  } catch {
    $.ui.toast(action.run ? `Moddeck · could not run ${typed}` : `Moddeck · type it yourself: ${typed}`)
  }
}

async function chooseSkin($: Dollar, name: string): Promise<void> {
  try {
    const out = (await $.command.run({ command: 'skin', args: name })) as { text?: string } | undefined
    $.ui.toast(firstLine(out?.text) || `Skin · ${name}`)
  } catch {
    $.ui.toast('Moddeck · could not switch the skin')
  }
}

async function isPaneOpen($: Dollar): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === PANE)
}

async function toggle($: Dollar): Promise<string> {
  await update($, autoOpen, () => 'done') // the person has taken over: never open it for them after this
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    return 'Moddeck · closed'
  }
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
  return opened.isPlaced ? 'Moddeck · open' : 'Moddeck · waiting for room\nTry /tui fullscreen, or a wider window.'
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
  const rows = typeof options.skillRows === 'number' && options.skillRows >= 1 ? Math.floor(options.skillRows) : DEFAULT_SKILL_ROWS

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'moddeck', description: 'Show or hide the moddeck side bar' })
    } catch {
      // the side bar can still be opened another way
    }
    if (isAutoOpen && e.isInteractive && e.surface !== null && PANE_SURFACES.has(e.surface)) defer($, () => autoOpenPane($))
    return next(e)
  })

  on('command.run', { command: 'moddeck' }, async $ => ({ text: await toggle($) })).catch(() => ({ text: FAILED }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Select, Text } = $.ui.resolve(e)
    if ((await read($, autoOpen)) === 'checking') defer($, () => settleAutoOpen($, e.props.placement))
    const isInline = e.props.placement === 'inline' || e.viewport?.isFullscreen === false
    if (e.surface === 'terminal' && isInline) return <Text dimColor>{HINT}</Text>

    // Switches: only the ones whose state this side bar can read; the pill is the button.
    // Each switch reads its own mod's state; a mod that is not installed (or not readable) is simply not drawn.
    const flag = (v: unknown, isOff: boolean): boolean | undefined => (typeof v === 'boolean' ? (isOff ? !v : v) : undefined)
    const ons: Record<string, boolean | undefined> = {
      suggest: flag(await valueOf($.state.get(SUGGEST_OFF as never)), true),
      reflect: flag(await valueOf($.state.get(REFLECT_OFF as never)), true),
      'secret-guard': flag(await valueOf($.state.get(SECRET_ON as never)), false),
    }
    const skin = await valueOf($.state.get(SKIN as never))

    // Every row is a box with a round border, one per row.
    const row = (key: string, child: unknown, color?: string) => (
      <Box key={key} borderStyle="round" borderColor={color} paddingX={1}>
        {child as never}
      </Box>
    )
    const button = (key: string, label: string, action: Action, costs?: boolean) => (
      <Button key={key} plain onPress={() => act($, action)}>
        {priced(label, costs)}
      </Button>
    )
    // Options sit right under their row, indented. Two or more, never one: a lone task is the row itself.
    const optionsOf = (t: Tool) =>
      (t.options ?? []).length > 0 && (
        <Box key={`options:${t.id}`} flexDirection="column" paddingLeft={4}>
          {(t.options ?? []).map(o => button(`option:${t.id}:${o.text}`, o.label, o, o.costs))}
        </Box>
      )

    const tools = TOOLS.flatMap(t => {
      if (t.isSkin) {
        // tool-skins keeps its theme in state only once one has been picked, so an unset one reads as the default.
        const theme = typeof skin === 'string' && SKINS.includes(skin) ? skin : SKINS[0]!
        return [
          row(
            'row:skin',
            <Select key="skin" label="Skin " value={theme} options={SKINS.map(name => ({ value: name }))} onSelect={(name: string) => chooseSkin($, name)} />,
          ),
        ]
      }
      if (t.isSwitch) {
        const isOn = ons[t.id]
        if (isOn === undefined) return [] // not installed, or not readable: not drawn
        const bg = isOn ? 'success' : 'error'
        return [
          <Box key={`row:${t.id}`} borderStyle="round" borderColor={bg} backgroundColor={bg} paddingX={1}>
            <Button key={`switch:${t.id}`} plain onPress={() => flip($, t, isOn)}>
              <Text bold color="inverseText" backgroundColor={bg}>
                {`${priced(t.label, t.costs)} · ${isOn ? 'on' : 'off'}`}
              </Text>
            </Button>
          </Box>,
          ...(isOn ? [optionsOf(t)] : []), // the options show only while the switch is green
        ]
      }
      if (t.click !== undefined) return [row(`row:${t.id}`, button(`tool:${t.id}`, t.label, t.click, t.costs)), optionsOf(t)]
      return [row(`row:${t.id}`, <Text dimColor>{`${t.label} · ${t.note ?? 'runs by itself'}`}</Text>)]
    })

    // The skills list has its own scroll: `rows` rows at a time, with ▲ / ▼ buttons, only when there are more.
    const many = SKILLS.length > rows
    const top = Math.max(0, Math.min(await read($, skillTop), SKILLS.length - rows))
    const scrollTo = (to: number) => update($, skillTop, () => Math.max(0, Math.min(to, SKILLS.length - rows)))
    const skills = SKILLS.slice(many ? top : 0, many ? top + rows : undefined).map(k =>
      row(`row:skill:${k.id}`, button(`skill:${k.id}`, k.label, { text: k.text, run: false })),
    )
    const scroller = many && (
      <Box key="skills:scroll" gap={2}>
        <Button key="skills:up" plain onPress={() => scrollTo(top - 1)}>
          <Text dimColor={top === 0}>▲ up</Text>
        </Button>
        <Text dimColor>{`${top + 1}–${Math.min(top + rows, SKILLS.length)} of ${SKILLS.length}`}</Text>
        <Button key="skills:down" plain onPress={() => scrollTo(top + 1)}>
          <Text dimColor={top + rows >= SKILLS.length}>▼ down</Text>
        </Button>
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>Tools</Text>
          <Text dimColor>Green or red: click to switch. Others: click to run, or to put it in the prompt box when it needs your text</Text>
          {tools}
        </Box>
        <Text dimColor>{'─'.repeat(Math.max(8, Math.min(e.props.bodyColumns - 2, 60)))}</Text>
        <Box flexDirection="column">
          <Text bold>Skills</Text>
          {scroller}
          {skills}
        </Box>
        <Text dimColor>$ = spends model tokens</Text>
      </Box>
    )
  })
}
