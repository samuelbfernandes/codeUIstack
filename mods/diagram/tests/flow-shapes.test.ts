import { expect, test } from 'claude-code/testing'

import { drawDiagram } from '../hooks/render'

/** The drawing as one string. */
const draw = (source: string, columns: number): string => drawDiagram(source, columns).lines.join('\n')
/** A template literal written as a block: its first and last newline are not part of the art. */
const art = (block: string): string => block.slice(1, -1)

test("a top-down chain of rectangles", () => {
  expect(draw("flowchart TD\n  A[Start] --> B[Process]\n  B --> C[End]", 60)).toBe(art(`
 ┌───────┐
 │ Start │
 └───┬───┘
     │
     ▼
┌─────────┐
│ Process │
└────┬────┘
     │
     ▼
  ┌─────┐
  │ End │
  └─────┘
`))
})

test("rectangles, rounded boxes, diamonds and circles each have their own corners", () => {
  expect(draw("graph TD\n  A[Square] --> B(Rounded)\n  B --> C{Choice}\n  C --> D((Circle))", 60)).toBe(art(`
┌────────┐
│ Square │
└────┬───┘
     │
     ▼
╭─────────╮
│ Rounded │
╰────┬────╯
     │
     ▼
╱────────╲
< Choice >
╲────┬───╱
     │
     ▼
╭────────╮
│ Circle │
╰────────╯
`))
})

test("TB is the same as TD", () => {
  expect(draw("flowchart TB\n  A --> B", 60)).toBe(art(`
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

test("a left-to-right chain", () => {
  expect(draw("flowchart LR\n  A[Input] --> B[Model] --> C[Output]", 60)).toBe(art(`
┌───────┐  ┌───────┐  ┌────────┐
│ Input ├─►│ Model ├─►│ Output │
└───────┘  └───────┘  └────────┘
`))
})

test("a decision with labelled branches that meet again", () => {
  expect(draw("flowchart TD\n  A[Start] --> B{Is it ok?}\n  B -->|yes| C[Ship it]\n  B -->|no| D(Fix it)\n  C --> E[Done]\n  D --> E", 60)).toBe(art(`
        ┌───────┐
        │ Start │
        └───┬───┘
            │
            ▼
      ╱───────────╲
      < Is it ok? >
      ╲─────┬─────╱
            │
     ┌──────┴──────┐
     │ yes         │ no
     ▼             ▼
┌─────────┐   ╭────────╮
│ Ship it │   │ Fix it │
└────┬────┘   ╰────┬───╯
     │             │
     └──────┬──────┘
            ▼
        ┌──────┐
        │ Done │
        └──────┘
`))
})

test("left-to-right fan-out with labels, merging again", () => {
  expect(draw("flowchart LR\n  S((Start)) -->|fast path| A[Alpha]\n  S -->|slow path| B[Beta step]\n  A --> E[End]\n  B --> E", 70)).toBe(art(`
            fast path ┌───────┐
          ┌──────────►│ Alpha ├─────┐
╭───────╮ │           └───────┘     │ ┌─────┐
│ Start ├─┤                         ├►│ End │
╰───────╯ │ slow path ┌───────────┐ │ └─────┘
          └──────────►│ Beta step ├─┘
                      └───────────┘
`))
})

test("a root fanning out to three that merge", () => {
  expect(draw("flowchart TD\n  R[Root] --> A[Alpha]\n  R --> B[Beta]\n  R --> C[Gamma]\n  A --> M[Merge]\n  B --> M\n  C --> M", 60)).toBe(art(`
            ┌──────┐
            │ Root │
            └───┬──┘
                │
    ┌───────────┼──────────┐
    ▼           ▼          ▼
┌───────┐   ┌──────┐   ┌───────┐
│ Alpha │   │ Beta │   │ Gamma │
└───┬───┘   └───┬──┘   └───┬───┘
    │           │          │
    └───────────┼──────────┘
                ▼
            ┌───────┐
            │ Merge │
            └───────┘
`))
})

test("a node and its children share one stem", () => {
  expect(draw("flowchart TD\n  A --> B\n  A --> C\n  A --> D", 60)).toBe(art(`
        ┌───┐
        │ A │
        └─┬─┘
          │
  ┌───────┼───────┐
  ▼       ▼       ▼
┌───┐   ┌───┐   ┌───┐
│ B │   │ C │   │ D │
└───┘   └───┘   └───┘
`))
})
