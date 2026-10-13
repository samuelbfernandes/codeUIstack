import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { analyse, contrast, parseColor, ratioText, splitArgs, toHsl } from '../hooks/lib'

function world(on: On, o: { surfaces?: string[]; placed?: boolean } = {}) {
  const w = { registered: [] as string[], opened: [] as string[] }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => (w.registered.push(e.name), { value: { command: e.name } as never }))
  on('session.surfaces', () => ({ value: (o.surfaces ?? ['terminal']) as never }))
  on('ui.open', (_$, e) => (w.opened.push(e.id), { value: o.placed === false ? { isPlaced: false as const, reason: 'none' } : { isPlaced: true as const } }))
  return w
}

const start = ($: Engine) => $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
const slash = async ($: Engine, args = '') =>
  ((await $.command.run({ command: 'color-lab', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })) as { text?: string }).text ?? ''
const PANE_PROPS = { title: 'Colour', isFocused: false, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const mount = ($: Engine, surface: 'terminal' | 'desktop' | 'mobile' | 'vscode') =>
  $.ui.mount({ plugin: 'color-lab', surface, component: 'Pane', requestId: 'color-lab', props: PANE_PROPS, viewport: { columns: 140, rows: 40, isFullscreen: true } } as never)

test('parses #rgb, #rrggbb and rgb(), and refuses the rest', () => {
  expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 })
  expect(parseColor('#1A2b3C')).toEqual({ r: 26, g: 43, b: 60 })
  expect(parseColor('rgb( 10 ,20, 30 )')).toEqual({ r: 10, g: 20, b: 30 })
  expect(parseColor('rgb(256,0,0)')).toBeUndefined()
  expect(parseColor('red')).toBeUndefined()
  expect(parseColor('#ffff')).toBeUndefined()
  expect(splitArgs('rgb(1, 2, 3) #fff')).toEqual(['rgb(1, 2, 3)', '#fff'])
})

test('WCAG ratios match known pairs; display rounds down', () => {
  expect(ratioText(contrast(parseColor('#000')!, parseColor('#fff')!))).toBe('21.00')
  expect(ratioText(contrast(parseColor('#777')!, parseColor('#fff')!))).toBe('4.47')
  expect(ratioText(contrast(parseColor('#767676')!, parseColor('#fff')!))).toBe('4.54')
  expect(ratioText(4.499999)).toBe('4.49')
  expect(toHsl(parseColor('#ff0000')!)).toEqual({ h: 0, s: 100, l: 50 })
  expect(toHsl(parseColor('#808080')!)).toEqual({ h: 0, s: 0, l: 50 })
})

test('a failing pair gets the nearest passing shade; a passing pair gets none', () => {
  const grey = analyse(parseColor('#777777')!, parseColor('#ffffff')!)
  expect(grey.checks.map(c => c.isPass)).toEqual([false, true, false, false])
  expect(grey.fix?.hex).toBe('#767676')
  expect(grey.fix?.direction).toBe('darker')
  const onDark = analyse(parseColor('#555555')!, parseColor('#000000')!)
  expect(onDark.fix?.direction).toBe('lighter')
  expect(contrast(parseColor(onDark.fix!.hex)!, parseColor('#000')!)).toBeGreaterThanOrEqual(4.5)
  expect(analyse(parseColor('#000')!, parseColor('#fff')!).fix).toBeNull()
})

test('the command registers, defaults the background to white and opens the pane', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.registered).toEqual(['color-lab'])
  expect(await slash($, '#777')).toBe('color-lab · #777777 on #ffffff: 4.47:1 · AA normal text fails · try #767676')
  expect(w.opened).toEqual(['color-lab'])
})

test('a bad colour or no argument gives the usage line and opens nothing', async ($, on) => {
  const w = world(on)
  await start($)
  expect(await slash($, '')).toContain('Use /color-lab')
  expect(await slash($, 'banana')).toContain('“banana” is not a colour')
  expect(await slash($, '#fff #000 #111')).toContain('Use /color-lab')
  expect(w.opened).toEqual([])
})

test('where no surface draws panes, the whole answer is text', async ($, on) => {
  const w = world(on, { surfaces: [] })
  await start($)
  const text = await slash($, 'rgb(0,0,0) #fff')
  expect(text).toContain('contrast 21.00:1')
  expect(text).toContain('pass  AAA normal text')
  expect(text).toContain('hsl(0, 0%, 100%)')
  expect(w.opened).toEqual([])
})

for (const surface of ['terminal', 'desktop', 'mobile', 'vscode'] as const) {
  test(`the pane draws swatches, the ratio and the checks (${surface})`, async ($, on) => {
    world(on)
    await start($)
    await slash($, '#777 #fff')
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: 'Contrast 4.47:1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /✗ fail AA normal text/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /✓ pass AA large text/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /#767676 \(4\.54:1\)/ })).toBeDefined()
    const swatches = (await ui.findAll({ type: 'Text' })).filter(t => t.props.backgroundColor === '#777777')
    expect(swatches.length).toBeGreaterThan(0)
    await ui.unmount()
  })
}
