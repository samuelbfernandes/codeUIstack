// color-lab: pure colour arithmetic (no engine access). WCAG 2.x contrast, as in
// https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio and #dfn-relative-luminance.
import type { ColorLabColor, ColorLabReport } from '../types'

export type Rgb = { r: number; g: number; b: number }

const hex2 = (n: number): string => n.toString(16).padStart(2, '0')

export const toHex = ({ r, g, b }: Rgb): string => `#${hex2(r)}${hex2(g)}${hex2(b)}`

/** Reads #rgb, #rrggbb or rgb(r, g, b) (0-255 each); undefined for anything else. */
export function parseColor(raw: string): Rgb | undefined {
  const text = raw.trim().toLowerCase()
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text)
  if (m) return { r: parseInt(m[1]! + m[1]!, 16), g: parseInt(m[2]! + m[2]!, 16), b: parseInt(m[3]! + m[3]!, 16) }
  m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(text)
  if (m) return { r: parseInt(m[1]!, 16), g: parseInt(m[2]!, 16), b: parseInt(m[3]!, 16) }
  m = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(text)
  if (m) {
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (r <= 255 && g <= 255 && b <= 255) return { r, g, b }
  }

  return undefined
}

/** Splits the command's arguments into colour words; `rgb( 1, 2, 3 )` stays one word whatever its spaces. */
export function splitArgs(args: string): string[] {
  return args.match(/rgb\s*\([^)]*\)|\S+/gi)?.map(word => word.replace(/^rgb\s*\(/i, 'rgb(')) ?? []
}

/** Hue in degrees (0-360), saturation and lightness as 0-1, not rounded. */
export function hslOf({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255]
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === rr) h = 60 * (((gg - bb) / d) % 6)
    else if (max === gg) h = 60 * ((bb - rr) / d + 2)
    else h = 60 * ((rr - gg) / d + 4)
  }
  if (h < 0) h += 360

  return { h, s, l }
}

/** Hue in degrees, saturation and lightness in percent, rounded. */
export function toHsl(rgb: Rgb): { h: number; s: number; l: number } {
  const { h, s, l } = hslOf(rgb)

  return { h: Math.round(h) % 360, s: Math.round(s * 100), l: Math.round(l * 100) }
}

/** HSL (h degrees, s and l as 0-1) back to rounded RGB. */
export function fromHsl(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  const to = (v: number) => Math.min(255, Math.max(0, Math.round((v + m) * 255)))

  return { r: to(r), g: to(g), b: to(b) }
}

/** WCAG relative luminance (sRGB). */
export function luminance({ r, g, b }: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255

    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }

  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]

  return (hi + 0.05) / (lo + 0.05)
}

/** Two decimals, rounded down, so a ratio shown as 4.50 always passes 4.5. */
export const ratioText = (ratio: number): string => (Math.floor(ratio * 100 + 1e-9) / 100).toFixed(2)

/**
 * The nearest shade of `fg` (same hue and saturation, lightness moved in 0.5 % steps) that reaches `target` against
 * `bg`, trying lighter and darker and keeping the smaller change. Undefined when neither direction reaches it.
 */
export function nearestPassing(fg: Rgb, bg: Rgb, target: number): { rgb: Rgb; direction: 'lighter' | 'darker' } | undefined {
  const { h, s, l } = hslOf(fg)
  const find = (step: number): { rgb: Rgb; dist: number } | undefined => {
    for (let k = 1; k <= 200; k++) {
      const next = l + (step * k) / 200
      if (next < 0 || next > 1) break
      const rgb = fromHsl(h, s, next)
      if (contrast(rgb, bg) >= target) return { rgb, dist: k }
    }
    const edge = fromHsl(h, s, step > 0 ? 1 : 0)

    return contrast(edge, bg) >= target ? { rgb: edge, dist: 201 } : undefined
  }
  const up = find(1)
  const down = find(-1)
  if (up === undefined && down === undefined) return undefined
  if (down === undefined || (up !== undefined && up.dist <= down.dist)) return { rgb: up!.rgb, direction: 'lighter' }

  return { rgb: down.rgb, direction: 'darker' }
}

export function describe(rgb: Rgb): ColorLabColor {
  const { h, s, l } = toHsl(rgb)

  return { hex: toHex(rgb), rgb: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`, hsl: `hsl(${h}, ${s}%, ${l}%)` }
}

/** The whole answer for `fg` on `bg`. */
export function analyse(fg: Rgb, bg: Rgb): ColorLabReport {
  const ratio = contrast(fg, bg)
  const fix = ratio < 4.5 ? nearestPassing(fg, bg, 4.5) : undefined

  return {
    fg: describe(fg),
    bg: describe(bg),
    ratio,
    ratioText: ratioText(ratio),
    checks: [
      { name: 'AA normal text', need: 4.5, isPass: ratio >= 4.5 },
      { name: 'AA large text', need: 3, isPass: ratio >= 3 },
      { name: 'AAA normal text', need: 7, isPass: ratio >= 7 },
      { name: 'AAA large text', need: 4.5, isPass: ratio >= 4.5 },
    ],
    fix: fix === undefined ? null : { ...describe(fix.rgb), direction: fix.direction, ratioText: ratioText(contrast(fix.rgb, bg)) },
  }
}

/** The answer as plain text (for the transcript where no pane is drawn). */
export function reportText(r: ColorLabReport): string {
  const lines = [
    `color-lab · ${r.fg.hex} on ${r.bg.hex}: contrast ${r.ratioText}:1`,
    `  text        ${r.fg.hex}  ${r.fg.rgb}  ${r.fg.hsl}`,
    `  background  ${r.bg.hex}  ${r.bg.rgb}  ${r.bg.hsl}`,
    ...r.checks.map(c => `  ${c.isPass ? 'pass' : 'fail'}  ${c.name} (needs ${c.need}:1)`),
  ]
  if (r.fix !== null) lines.push(`  nearest ${r.fix.direction} shade that passes AA normal: ${r.fix.hex} (${r.fix.ratioText}:1)`)

  return lines.join('\n')
}
