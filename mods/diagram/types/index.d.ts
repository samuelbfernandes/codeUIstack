declare module 'claude-code' {
  interface PluginState {
    diagram: {
      /** The text of the last mermaid code block in a final answer (cut at 20,000 characters), or null. */
      last: string | null
    }
  }
}
