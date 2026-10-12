import { expect, test } from 'claude-code/testing'

import { drawDiagram } from '../hooks/render'

/** The drawing as one string. */
const draw = (source: string, columns: number): string => drawDiagram(source, columns).lines.join('\n')
/** A template literal written as a block: its first and last newline are not part of the art. */
const art = (block: string): string => block.slice(1, -1)

test("a class diagram is not drawn: a headline and the source in a box", () => {
  expect(draw("classDiagram\n  Animal <|-- Duck\n  Animal : +int age", 40)).toBe(art(`
Diagram · classDiagram is not drawn here

┌─────────────────────┐
│ classDiagram        │
│   Animal <|-- Duck  │
│   Animal : +int age │
└─────────────────────┘
`))
})

test("a gantt chart is not drawn", () => {
  expect(draw("gantt\n title Plan\n section A\n Task :a1, 2024-01-01, 3d", 40)).toBe(art(`
Diagram · gantt is not drawn here

┌───────────────────────────┐
│ gantt                     │
│  title Plan               │
│  section A                │
│  Task :a1, 2024-01-01, 3d │
└───────────────────────────┘
`))
})

test("an ER diagram is not drawn", () => {
  expect(draw("erDiagram\n  CUSTOMER ||--o{ ORDER : places", 40)).toBe(art(`
Diagram · erDiagram is not drawn here

┌──────────────────────────────────┐
│ erDiagram                        │
│   CUSTOMER ||--o{ ORDER : places │
└──────────────────────────────────┘
`))
})

test("a state diagram is not drawn and its headline wraps", () => {
  expect(draw("stateDiagram-v2\n  [*] --> Still", 40)).toBe(art(`
Diagram · stateDiagram-v2 is not drawn
here

┌─────────────────┐
│ stateDiagram-v2 │
│   [*] --> Still │
└─────────────────┘
`))
})

test("text that is not a diagram at all", () => {
  expect(draw("!!! not a diagram", 40)).toBe(art(`
Diagram · !!! is not drawn here

┌───────────────────┐
│ !!! not a diagram │
└───────────────────┘
`))
})

test("nothing to draw", () => {
  expect(draw("   \n\n", 40)).toBe(art(`
Diagram · nothing to draw
`))
})

test("a flowchart whose statement cannot be read shows its source", () => {
  expect(draw("flowchart TD\n  A --> B\n  this is not a statement", 40)).toBe(art(`
Diagram · could not be drawn

┌───────────────────────────┐
│ flowchart TD              │
│   A --> B                 │
│   this is not a statement │
└───────────────────────────┘
`))
})

test("a flowchart that is cut off in the middle of an arrow", () => {
  expect(draw("graph LR\nA-->", 40)).toBe(art(`
Diagram · could not be drawn

┌──────────┐
│ graph LR │
│ A-->     │
└──────────┘
`))
})

test("a unclosed bracket", () => {
  expect(draw("graph TD\nA[unclosed --> B", 40)).toBe(art(`
Diagram · could not be drawn

┌──────────────────┐
│ graph TD         │
│ A[unclosed --> B │
└──────────────────┘
`))
})

test("a sequence diagram with a line it cannot read", () => {
  expect(draw("sequenceDiagram\n  A->>B: ok\n  what is this", 40)).toBe(art(`
Diagram · could not be drawn

┌─────────────────┐
│ sequenceDiagram │
│   A->>B: ok     │
│   what is this  │
└─────────────────┘
`))
})

test("a pie with a negative value", () => {
  expect(draw("pie\n  \"a\" : -1", 40)).toBe(art(`
Diagram · could not be drawn

┌────────────┐
│ pie        │
│   "a" : -1 │
└────────────┘
`))
})

test("a pie whose values are all zero", () => {
  expect(draw("pie\n  \"a\" : 0\n  \"b\" : 0", 40)).toBe(art(`
Diagram · could not be drawn

┌───────────┐
│ pie       │
│   "a" : 0 │
│   "b" : 0 │
└───────────┘
`))
})

test("a diagram too wide for even the smallest boxes shows its source", () => {
  expect(draw("flowchart TD\n  A --> B\n  A --> C\n  A --> D\n  A --> E\n  A --> F", 14)).toBe(art(`
Diagram · too
wide for this
pane

┌────────────┐
│ flowchart  │
│ TD         │
│   A --> B  │
│   A --> C  │
│   A --> D  │
│   A --> E  │
│   A --> F  │
└────────────┘
`))
})
