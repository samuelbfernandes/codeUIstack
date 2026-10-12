import type { PluginOptions } from 'claude-code'

import { parseExtra, rulesFor } from './detect'
import type { Rule } from './detect'

export type Config = {
  /** The settings switch; the person's on/off word is kept separately in $.store. */
  enabled: boolean
  askOnPrompt: boolean
  rules: Rule[]
  /** What was wrong with `extraPatterns`, one line each; empty when all is well. */
  problems: string[]
}

/** Options from plugin.json userConfig; anything unusable falls back to the default. */
export function readConfig(options: PluginOptions): Config {
  const extra = parseExtra(options.extraPatterns)
  return {
    enabled: options.enabled !== false,
    askOnPrompt: options.askOnPrompt !== false,
    rules: rulesFor({ redactEmails: options.redactEmails === true, extra: extra.rules }),
    problems: extra.problems,
  }
}
