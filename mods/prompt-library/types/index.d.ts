/** One saved prompt. Plain JSON: it lives in $.store and in $.state. */
export type PromptItem = {
  /** Lowercase letters, digits and hyphens, 1 to 24 characters. */
  name: string
  /** The prompt text, at most 4000 characters. */
  text: string
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-library': {
      /** This project's saved prompts, in the order added; read by the moddeck side bar. */
      items: PromptItem[]
    }
  }
}
