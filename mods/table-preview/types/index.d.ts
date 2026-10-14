/** One column: its header, a simple type, and the share of empty (or NA) cells. */
export type CsvTableColumn = { name: string; type: 'number' | 'text' | 'empty'; emptyPct: number }

/** What `/table-preview <path>` read from one file. */
export type CsvTableReport = {
  /** The path as typed. */
  path: string
  /** The file name alone. */
  name: string
  sizeBytes: number
  /** 'comma', 'semicolon' or 'tab'. */
  delimiter: string
  /** Data rows, the header not counted. The whole file is read, so this is exact. */
  rowCount: number
  /** The columns with their types, at most 60 listed. */
  columns: CsvTableColumn[]
  columnCount: number
  /** The first rows as an aligned plain-text table, bounded. */
  preview: string
  previewRows: number
  /** True when the preview leaves columns out or was cut to fit. */
  isCut: boolean
  /** Problems seen while parsing (an unclosed quote, ragged rows). */
  warnings: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'table-preview': {
      /** The last file read, or null before the first `/table-preview`. */
      report: CsvTableReport | null
    }
  }
}
