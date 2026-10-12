/** A grid of characters with line segments that join into box-drawing corners and crossings. */

export type LineStyle = 'solid' | 'dotted' | 'thick'

const UP = 1
const RIGHT = 2
const DOWN = 4
const LEFT = 8

// Indexed by the OR of the four directions a cell's line leaves in.
const SOLID = [' ', '│', '─', '└', '│', '│', '┌', '├', '─', '┘', '─', '┴', '┐', '┤', '┬', '┼']
const THICK = [' ', '┃', '━', '┗', '┃', '┃', '┏', '┣', '━', '┛', '━', '┻', '┓', '┫', '┳', '╋']
const RANK: Record<LineStyle, number> = { dotted: 0, solid: 1, thick: 2 }

function glyph(mask: number, style: LineStyle): string {
  if (style === 'thick') return THICK[mask] ?? ' '
  if (style === 'dotted') {
    if (mask === UP || mask === DOWN || mask === (UP | DOWN)) return '┆'
    if (mask === LEFT || mask === RIGHT || mask === (LEFT | RIGHT)) return '┄'
  }

  return SOLID[mask] ?? ' '
}

export class Canvas {
  readonly width: number
  readonly height: number
  private readonly chars: (string | undefined)[][]
  private readonly masks: number[][]
  private readonly styles: LineStyle[][]

  constructor(width: number, height: number) {
    this.width = Math.max(0, Math.floor(width))
    this.height = Math.max(0, Math.floor(height))
    this.chars = Array.from({ length: this.height }, () => new Array<string | undefined>(this.width).fill(undefined))
    this.masks = Array.from({ length: this.height }, () => new Array<number>(this.width).fill(0))
    this.styles = Array.from({ length: this.height }, () => new Array<LineStyle>(this.width).fill('dotted'))
  }

  private inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  /** Writes one character that wins over any line passing through the cell. Out-of-range writes are ignored. */
  put(x: number, y: number, ch: string): void {
    if (this.inside(x, y)) (this.chars[y] as (string | undefined)[])[x] = ch
  }

  /** Writes a text left to right from (x, y). */
  text(x: number, y: number, text: string): void {
    for (let i = 0; i < text.length; i++) this.put(x + i, y, text.charAt(i))
  }

  private addLine(x: number, y: number, bits: number, style: LineStyle): void {
    if (!this.inside(x, y)) return
    const maskRow = this.masks[y] as number[]
    const styleRow = this.styles[y] as LineStyle[]
    if (maskRow[x] === 0 || RANK[style] >= RANK[styleRow[x] as LineStyle]) styleRow[x] = style
    maskRow[x] = (maskRow[x] as number) | bits
  }

  /** A horizontal line from x1 to x2 (either order), ends included; it joins lines that meet it. */
  hline(x1: number, x2: number, y: number, style: LineStyle = 'solid'): void {
    const lo = Math.min(x1, x2)
    const hi = Math.max(x1, x2)
    for (let x = lo; x <= hi; x++) this.addLine(x, y, (x > lo ? LEFT : 0) | (x < hi ? RIGHT : 0), style)
  }

  /** A vertical line from y1 to y2 (either order), ends included. */
  vline(x: number, y1: number, y2: number, style: LineStyle = 'solid'): void {
    const lo = Math.min(y1, y2)
    const hi = Math.max(y1, y2)
    for (let y = lo; y <= hi; y++) this.addLine(x, y, (y > lo ? UP : 0) | (y < hi ? DOWN : 0), style)
  }

  /** True when nothing is drawn in the cells x .. x+length-1 of row y (and they are on the canvas). */
  isFree(x: number, y: number, length: number): boolean {
    for (let i = 0; i < length; i++) {
      if (!this.inside(x + i, y)) return false
      if ((this.chars[y] as (string | undefined)[])[x + i] !== undefined || (this.masks[y] as number[])[x + i] !== 0) return false
    }

    return true
  }

  /** A box with its own border characters; `corners` is top-left, top-right, bottom-right, bottom-left. */
  box(x: number, y: number, w: number, h: number, corners: readonly [string, string, string, string]): void {
    const [tl, tr, br, bl] = corners
    for (let i = 1; i < w - 1; i++) {
      this.put(x + i, y, '─')
      this.put(x + i, y + h - 1, '─')
    }
    for (let j = 1; j < h - 1; j++) {
      this.put(x, y + j, '│')
      this.put(x + w - 1, y + j, '│')
    }
    this.put(x, y, tl)
    this.put(x + w - 1, y, tr)
    this.put(x + w - 1, y + h - 1, br)
    this.put(x, y + h - 1, bl)
  }

  /** The rows as strings, trailing blanks and trailing empty rows removed. */
  toLines(): string[] {
    const rows: string[] = []
    for (let y = 0; y < this.height; y++) {
      let row = ''
      for (let x = 0; x < this.width; x++) {
        const ch = (this.chars[y] as (string | undefined)[])[x]
        const mask = (this.masks[y] as number[])[x] as number
        row += ch ?? (mask === 0 ? ' ' : glyph(mask, (this.styles[y] as LineStyle[])[x] as LineStyle))
      }
      rows.push(row.replace(/\s+$/, ''))
    }
    while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop()

    return rows
  }
}
