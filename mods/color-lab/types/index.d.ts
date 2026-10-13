/** One colour in the three spellings color-lab shows. */
export type ColorLabColor = { hex: string; rgb: string; hsl: string }

/** One WCAG 2.x level: the ratio it needs and whether the pair reaches it. */
export type ColorLabCheck = { name: string; need: number; isPass: boolean }

/** The answer to `/color-lab <fg> [bg]`. */
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
    'color-lab': {
      /** The last answer, or null before the first `/color-lab`. */
      report: ColorLabReport | null
    }
  }
}
