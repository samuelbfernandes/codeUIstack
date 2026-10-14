export type Usage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type AgentStatus = 'running' | 'finished' | 'failed'

/** One subagent as this mod tracks it. Plain JSON: it lives in $.state. */
export type AgentRow = {
  id: string
  label: string
  type: string
  model: string
  status: AgentStatus
  /** First time this mod saw the agent (ms since epoch). */
  startedAt: number
  /** When its last turn ended; null while it runs. */
  endedAt: number | null
  /** Time spent in turns that already ended. */
  busyMs: number
  /** Start of the turn running now; null between turns. */
  since: number | null
  /** Tokens of the turns that ended. */
  done: Usage
  /** Tokens of the turn running now, summed over its steps. */
  cur: Usage
  curTurn: string
  /** Input-side tokens of the latest request: the context in use. */
  fill: number | null
  steps: number
  /** The agent that spawned this one; absent for one the main loop started (and in 0.3.0 rows kept over a hot reload). */
  parentId?: string
  /** Tool calls the agent's own loop made (counted from tool.call events that carry its agentId). */
  tools?: number
  /** The last time the engine reported anything from this agent (a request, a tool call, its spawn): the stall clock. */
  lastAt?: number
  /** True once a toast has said this running helper looks stalled, so it is said once. */
  stallNoted?: boolean
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

/** One entry of Claude's own task list (TodoWrite or TaskCreate/TaskUpdate). */
export type TaskItem = {
  id: string
  subject: string
  status: TaskStatus
}

declare module 'claude-code' {
  interface PluginState {
    'progress': {
      agents: AgentRow[]
      /** The main loop's task list as its task tools last reported it. */
      tasks: TaskItem[]
      /** null until read from $.store. */
      isHidden: boolean | null
      /** Bumped by the once-a-second timer so drawings refresh while agents run. */
      tick: number
    }
  }
}
