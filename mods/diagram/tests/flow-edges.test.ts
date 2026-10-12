import { expect, test } from 'claude-code/testing'

import { drawDiagram } from '../hooks/render'

/** The drawing as one string. */
const draw = (source: string, columns: number): string => drawDiagram(source, columns).lines.join('\n')
/** A template literal written as a block: its first and last newline are not part of the art. */
const art = (block: string): string => block.slice(1, -1)

test("dotted, thick and open edges keep their line style and heads", () => {
  expect(draw("flowchart TD\n  A --> B\n  B -.-> C\n  C ==> D\n  D --- E\n  E <--> F", 60)).toBe(art(`
┌───┐
│ A │
└─┬─┘
  │
  ▼
┌───┐
│ B │
└─┬─┘
  ┆
  ▼
┌───┐
│ C │
└─┬─┘
  ┃
  ▼
┌───┐
│ D │
└─┬─┘
  │
  │
┌───┐
│ E │
└─┬─┘
  ▲
  ▼
┌───┐
│ F │
└───┘
`))
})

test("each labelled edge of a fan-out carries its own style", () => {
  expect(draw("flowchart TD\n  A -->|solid| B\n  A -.->|dotted| C\n  A ==>|thick| D\n  A --- E", 60)).toBe(art(`
                    ┌───┐
                    │ A │
                    └─┬─┘
                      ┃
  ┌────────────┬──────┻━━━━━━┳────────────┐
  │ solid      ┆ dotted      ┃ thick      │
  ▼            ▼             ▼            │
┌───┐        ┌───┐         ┌───┐        ┌───┐
│ B │        │ C │         │ D │        │ E │
└───┘        └───┘         └───┘        └───┘
`))
})

test("the older spelling with the text inside the arrow", () => {
  expect(draw("flowchart TD\n  A -- yes --> B\n  A -. maybe .-> C\n  A == sure ==> D", 60)).toBe(art(`
            ┌───┐
            │ A │
            └─┬─┘
              ┃
  ┌──────────┬┻━━━━━━━━━━━┓
  │ yes      ┆ maybe      ┃ sure
  ▼          ▼            ▼
┌───┐      ┌───┐        ┌───┐
│ B │      │ C │        │ D │
└───┘      └───┘        └───┘
`))
})

test("an edge that skips a rank goes around the box in between and keeps its label", () => {
  expect(draw("flowchart TD\n  A --> B --> C\n  A -->|skip| C", 60)).toBe(art(`
   ┌───┐
   │ A │
   └─┬─┘
     │
  ┌──┴─┐
  │    │ skip
  ▼    │
┌───┐  │
│ B │  │
└─┬─┘  │
  │    │
  └──┬─┘
     ▼
   ┌───┐
   │ C │
   └───┘
`))
})

test("A & B --> C joins both to C", () => {
  expect(draw("flowchart TD\n  A & B --> C", 60)).toBe(art(`
┌───┐   ┌───┐
│ A │   │ B │
└─┬─┘   └─┬─┘
  │       │
  └───┬───┘
      ▼
    ┌───┐
    │ C │
    └───┘
`))
})

test("chains and semicolons on one line", () => {
  expect(draw("flowchart LR\n  A[One] --> B[Two] --> C[Three]; D --> C", 60)).toBe(art(`
┌─────┐
│ One ├─┐ ┌─────┐
└─────┘ └►│ Two ├─┐
          └─────┘ │ ┌───────┐
┌───┐             ├►│ Three │
│ D ├─────────────┘ └───────┘
└───┘
`))
})

test("a cycle is listed under the drawing, not drawn as an upward line", () => {
  expect(draw("flowchart TD\n  A[Plan] --> B[Build]\n  B --> C[Test]\n  C -->|fail| B\n  C --> D[Ship]\n  D --> A\n  D --> D", 60)).toBe(art(`
┌──────┐
│ Plan │
└───┬──┘
    │
    ▼
┌───────┐
│ Build │
└───┬───┘
    │
    ▼
┌──────┐
│ Test │
└───┬──┘
    │
    ▼
┌──────┐
│ Ship │
└──────┘

↺ Test → Build · fail
↺ Ship → Plan
↺ Ship → Ship
`))
})

test("two nodes pointing at each other", () => {
  expect(draw("flowchart LR\n  A --> B\n  B --> A", 60)).toBe(art(`
┌───┐  ┌───┐
│ A ├─►│ B │
└───┘  └───┘

↺ B → A
`))
})

test("labels of edges that merge into one node sit by their own source", () => {
  expect(draw("flowchart TD\n A -->|one| C\n B -->|two| C\n D -->|three| C\n E -->|four| C", 80)).toBe(art(`
┌───┐      ┌───┐      ┌───┐        ┌───┐
│ A │      │ B │      │ D │        │ E │
└─┬─┘      └─┬─┘      └─┬─┘        └─┬─┘
  │ one      │ two      │ three      │ four
  └──────────┴──────┬───┴────────────┘
                    │
                    ▼
                  ┌───┐
                  │ C │
                  └───┘
`))
})

test("labels of parallel edges stack beside the shared line", () => {
  expect(draw("flowchart TD\n A -->|a| B\n A -->|b| B", 80)).toBe(art(`
┌───┐
│ A │
└─┬─┘
  │
  │ b
  │ a
  ▼
┌───┐
│ B │
└───┘
`))
})

test("a label with no room is listed under the drawing instead", () => {
  expect(draw("flowchart LR\n A -->|a| D\n B -->|b| D\n C -->|c| D", 80)).toBe(art(`
┌───┐
│ A ├─┐
└───┘ │
      │
┌───┐ │ a ┌───┐
│ B ├─┼──►│ D │
└───┘ │ b └───┘
      │
┌───┐ │
│ C ├─┘
└───┘

C → D · c
`))
})
