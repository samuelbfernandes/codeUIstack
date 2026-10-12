// The colour tokens of each theme. Hex values, which both the terminal and the
// desktop surface accept for any `Color` prop. Palettes are the published ones
// (Tokyo Night by folke, Dracula, Catppuccin Mocha, Gruvbox dark, Nord,
// Solarized dark); `noir` is this mod's own greyscale with muted status hues.

export type Palette = {
  /** Primary text. */
  fg: string
  /** Dim text: argument summaries, timings, hints. */
  muted: string
  /** Card frames. */
  border: string
  /** The theme's signature colour (agents, headings). */
  accent: string
  blue: string
  green: string
  yellow: string
  red: string
  magenta: string
  cyan: string
}

export const THEMES = {
  noir: {
    fg: '#e6e6e6', muted: '#7a7a7a', border: '#3d3d3d', accent: '#ffffff',
    blue: '#c4c4c4', green: '#9bc29b', yellow: '#d6c58a', red: '#c98080',
    magenta: '#b0b0b0', cyan: '#d0d0d0',
  },
  'tokyo-night': {
    fg: '#c0caf5', muted: '#565f89', border: '#3b4261', accent: '#7aa2f7',
    blue: '#7aa2f7', green: '#9ece6a', yellow: '#e0af68', red: '#f7768e',
    magenta: '#bb9af7', cyan: '#7dcfff',
  },
  dracula: {
    fg: '#f8f8f2', muted: '#6272a4', border: '#44475a', accent: '#bd93f9',
    blue: '#bd93f9', green: '#50fa7b', yellow: '#f1fa8c', red: '#ff5555',
    magenta: '#ff79c6', cyan: '#8be9fd',
  },
  catppuccin: {
    fg: '#cdd6f4', muted: '#7f849c', border: '#45475a', accent: '#cba6f7',
    blue: '#89b4fa', green: '#a6e3a1', yellow: '#f9e2af', red: '#f38ba8',
    magenta: '#cba6f7', cyan: '#94e2d5',
  },
  gruvbox: {
    fg: '#ebdbb2', muted: '#928374', border: '#504945', accent: '#fabd2f',
    blue: '#83a598', green: '#b8bb26', yellow: '#fabd2f', red: '#fb4934',
    magenta: '#d3869b', cyan: '#8ec07c',
  },
  nord: {
    fg: '#d8dee9', muted: '#616e88', border: '#434c5e', accent: '#88c0d0',
    blue: '#81a1c1', green: '#a3be8c', yellow: '#ebcb8b', red: '#bf616a',
    magenta: '#b48ead', cyan: '#8fbcbb',
  },
  'solarized-dark': {
    fg: '#839496', muted: '#586e75', border: '#073642', accent: '#268bd2',
    blue: '#268bd2', green: '#859900', yellow: '#b58900', red: '#dc322f',
    magenta: '#d33682', cyan: '#2aa198',
  },
} as const satisfies Record<string, Palette>

export type ThemeName = keyof typeof THEMES

export const THEME_NAMES = Object.keys(THEMES) as ThemeName[]
export const DEFAULT_THEME: ThemeName = 'noir'

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && Object.hasOwn(THEMES, value)
}

/** The palette for a stored or typed name; an unknown name falls back to the default. */
export function paletteOf(name: unknown): Palette {
  return THEMES[isThemeName(name) ? name : DEFAULT_THEME]
}

/**
 * Resolves what a person typed to a theme: exact after folding case and
 * punctuation (`Tokyo_Night`, `tokyonight`), else a unique prefix (`sol`).
 */
export function matchTheme(input: string): ThemeName | undefined {
  const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const wanted = fold(input)
  if (wanted === '') return undefined

  const exact = THEME_NAMES.find(n => fold(n) === wanted)
  if (exact) return exact

  const byPrefix = THEME_NAMES.filter(n => fold(n).startsWith(wanted))
  return byPrefix.length === 1 ? byPrefix[0] : undefined
}

/** The name as a person reads it: `tokyo-night` is Tokyo Night. */
export function titleOf(name: ThemeName): string {
  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
