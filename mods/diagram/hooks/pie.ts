import { padEnd, truncate, widest } from './text'

/** `pie` as horizontal bars: label, a bar, the share in percent (and the value when `showData` is given). */

export type Pie = { title: string; showData: boolean; slices: { label: string; value: number }[] }

const SLICE = /^"?([^"]*?)"?\s*:\s*(-?\d+(?:\.\d+)?)\s*$/

/** Parses the header line and the lines after it. Throws on anything it cannot read. */
export function parsePie(headerLine: string, body: readonly string[]): Pie {
  const head = /^pie\b\s*(showData\b)?\s*(?:title\s+(.*))?$/i.exec(headerLine.trim())
  const pie: Pie = { title: (head?.[2] ?? '').trim(), showData: head?.[1] !== undefined, slices: [] }
  for (const raw of body) {
    const line = raw.replace(/%%.*$/, '').trim()
    if (line === '') continue
    const title = /^title\s+(.*)$/i.exec(line)
    if (title !== null) pie.title = (title[1] ?? '').trim()
    else if (/^showData$/i.test(line)) pie.showData = true
    else {
      const m = SLICE.exec(line)
      if (m === null) throw new Error(`cannot read "${line.slice(0, 20)}"`)
      const value = Number(m[2])
      if (!Number.isFinite(value) || value < 0) throw new Error('negative value')
      pie.slices.push({ label: (m[1] ?? '').trim(), value })
    }
  }
  if (pie.slices.length === 0) throw new Error('no slices')
  if (pie.slices.every(slice => slice.value === 0)) throw new Error('all zero')

  return pie
}

const PARTIAL = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
const MIN_BAR = 6

/** A bar `width` cells wide with `fraction` of it filled, to an eighth of a cell, on a light track. */
export function bar(fraction: number, width: number): string {
  const eighths = Math.round(Math.min(1, Math.max(0, fraction)) * width * 8)
  const full = Math.floor(eighths / 8)
  const part = PARTIAL[eighths % 8] ?? ''

  return '█'.repeat(full) + part + '░'.repeat(Math.max(0, width - full - (part === '' ? 0 : 1)))
}

const number = (value: number): string => (Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100))

export function drawPie(pie: Pie, columns: number): string[] {
  const total = pie.slices.reduce((sum, slice) => sum + slice.value, 0)
  const percents = pie.slices.map(slice => `${((slice.value / total) * 100).toFixed(1)}%`)
  const percentWidth = widest(percents)
  const allValues = pie.slices.map(slice => number(slice.value))
  // The values go first when the pane is too narrow for them; the labels are cut before the share is.
  const isValueShown = pie.showData && columns >= widest(allValues) + percentWidth + 14
  const values = isValueShown ? allValues : []
  const valueWidth = widest(values)
  const extra = isValueShown ? valueWidth + 2 : 0
  const labelCap = Math.max(1, Math.min(24, Math.floor(columns * 0.35), columns - percentWidth - extra - 2))
  const labels = pie.slices.map(slice => truncate(slice.label.replace(/\s+/g, ' '), labelCap))
  const labelWidth = widest(labels)
  const barWidth = columns - labelWidth - percentWidth - extra - 4
  const rows = pie.slices.map((slice, i) => {
    const share = (percents[i] as string).padStart(percentWidth)
    const value = isValueShown ? `  ${(values[i] as string).padStart(valueWidth)}` : ''
    const drawing = barWidth >= MIN_BAR ? `  ${bar(slice.value / total, barWidth)}` : ''

    return truncate(`${padEnd(labels[i] as string, labelWidth)}${drawing}  ${share}${value}`, columns)
  })

  return [...(pie.title === '' ? [] : [truncate(pie.title, columns), '']), ...rows]
}
