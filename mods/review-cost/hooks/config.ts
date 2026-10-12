import type { PluginOptions } from 'claude-code'

import { GREEN_MAX_DEFAULT, RED_MIN_DEFAULT } from './estimate'
import type { Thresholds } from './estimate'
import type { Prices } from './format'

export type Config = {
  thresholds: Thresholds
  askAlways: boolean
  prices: Prices
  coloredBanner: boolean
}

const positive = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback)
const nonNegative = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

/** Options from plugin.json userConfig; anything unusable falls back to the default. */
export function readConfig(options: PluginOptions): Config {
  const greenMax = positive(options.greenMaxTokens, GREEN_MAX_DEFAULT)
  const redMin = Math.max(greenMax + 1, positive(options.redMinTokens, RED_MIN_DEFAULT)) // red always above green
  return {
    thresholds: { greenMax, redMin },
    askAlways: options.askWhen === 'always',
    prices: { inputUsdPerMTok: nonNegative(options.inputUsdPerMTok), outputUsdPerMTok: nonNegative(options.outputUsdPerMTok) },
    coloredBanner: options.coloredBanner !== false,
  }
}
