/** One colour in the three spellings contrast-check shows. */
export type ColorLabColor = { hex: string; rgb: string; hsl: string }

/** One WCAG 2.x level: the ratio it needs and whether the pair reaches it. */
export type ColorLabCheck = { name: string; need: number; isPass: boolean }

/** The answer to `/contrast-check <fg> [bg]`. */
export type ColorLabReport = {
  fg: ColorLabColor
  bg: ColorLabColor
  /** The contrast ratio, unrounded. */
  ratio: number
  /** The ratio to two decimals, rounded down. */
  ratioText: string
  checks: ColorLabCheck[]
  /** The nearest lighter or darker shade of fg that passes AA normal text; null when fg already passes. */
  fix: (ColorLabColor & { direction: 'lighter' | 'darker'; ratioText: string }) | null
}

declare module 'claude-code' {
  interface PluginState {
    'contrast-check': {
      /** The last answer, or null before the first `/contrast-check`. */
      report: ColorLabReport | null
    }
  }
}
