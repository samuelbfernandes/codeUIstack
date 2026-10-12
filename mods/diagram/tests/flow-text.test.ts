import { expect, test } from 'claude-code/testing'

import { drawDiagram } from '../hooks/render'

/** The drawing as one string. */
const draw = (source: string, columns: number): string => drawDiagram(source, columns).lines.join('\n')
/** A template literal written as a block: its first and last newline are not part of the art. */
const art = (block: string): string => block.slice(1, -1)

test("long node text wraps inside its box", () => {
  expect(draw("flowchart TD\n  A[This is a long node text that has to wrap] --> B[Short]", 24)).toBe(art(`
┌────────────────────┐
│   This is a long   │
│ node text that has │
│      to wrap       │
└──────────┬─────────┘
           │
           ▼
       ┌───────┐
       │ Short │
       └───────┘
`))
})

test("line-break tags and quotes in node text", () => {
  expect(draw("flowchart TD\n  A[Line one<br/>Line two] --> B[\"Quoted [text]\"]", 60)).toBe(art(`
  ┌──────────┐
  │ Line one │
  │ Line two │
  └─────┬────┘
        │
        ▼
┌───────────────┐
│ Quoted [text] │
└───────────────┘
`))
})

test("subgraphs are drawn flat and say so", () => {
  expect(draw("flowchart TD\n  subgraph one\n    A --> B\n  end\n  B --> C", 60)).toBe(art(`
┌───┐
│ A │
└─┬─┘
  │
  ▼
┌───┐
│ B │
└─┬─┘
  │
  ▼
┌───┐
│ C │
└───┘

Subgraphs are drawn flat
`))
})

test("BT is drawn top-down and says so", () => {
  expect(draw("flowchart BT\n  A --> B", 60)).toBe(art(`
┌───┐
│ A │
└─┬─┘
  │
  ▼
┌───┐
│ B │
└───┘

BT is drawn as TD
`))
})

test("a left-to-right chart too wide for the pane is drawn top-down", () => {
  expect(draw("graph LR\n A[One] --> B[Two] --> C[Three] --> D[Four] --> E[Five]", 40)).toBe(art(`
 ┌─────┐
 │ One │
 └──┬──┘
    │
    ▼
 ┌─────┐
 │ Two │
 └──┬──┘
    │
    ▼
┌───────┐
│ Three │
└───┬───┘
    │
    ▼
┌──────┐
│ Four │
└───┬──┘
    │
    ▼
┌──────┐
│ Five │
└──────┘

Drawn top to bottom to fit
`))
})

test("comments, styling lines and statements after the header are understood", () => {
  expect(draw("%% a comment\nflowchart TD ; A --> B %% trailing\n  classDef x fill:#f00\n  class A x\n  style B fill:#0f0", 60)).toBe(art(`
┌───┐
│ A │
└─┬─┘
  │
  ▼
┌───┐
│ B │
└───┘
`))
})

test("front matter before the header is skipped", () => {
  expect(draw("---\ntitle: Hi\n---\n%% note\nflowchart LR\n  A --> B", 40)).toBe(art(`
┌───┐  ┌───┐
│ A ├─►│ B │
└───┘  └───┘
`))
})

test("a wide chart narrows its boxes until it fits", () => {
  expect(draw("flowchart TD\n  R[Root] --> A[Alpha beta]\n  R --> B[Gamma delta]\n  R --> C[Epsilon zeta]", 36)).toBe(art(`
            ┌──────┐
            │ Root │
            └───┬──┘
                │
    ┌───────────┼────────────┐
    ▼           ▼            ▼
┌───────┐   ┌───────┐   ┌─────────┐
│ Alpha │   │ Gamma │   │ Epsilon │
│ beta  │   │ delta │   │  zeta   │
└───────┘   └───────┘   └─────────┘
`))
})
