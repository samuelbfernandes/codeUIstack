import { expect, test } from 'claude-code/testing'

import { drawDiagram } from '../hooks/render'

/** The drawing as one string. */
const draw = (source: string, columns: number): string => drawDiagram(source, columns).lines.join('\n')
/** A template literal written as a block: its first and last newline are not part of the art. */
const art = (block: string): string => block.slice(1, -1)

test("two participants and a reply", () => {
  expect(draw("sequenceDiagram\n  Alice->>Bob: Hello Bob\n  Bob-->>Alice: Hi Alice", 60)).toBe(art(`
┌───────┐     ┌─────┐
│ Alice │     │ Bob │
└───┬───┘     └──┬──┘
    ┆            ┆
    ┆ Hello Bob  ┆
    ├───────────►┤
    ┆            ┆
    ┆ Hi Alice   ┆
    ├◄┄┄┄┄┄┄┄┄┄┄┄┤
    ┆            ┆
`))
})

test("declared participants keep their order and aliases", () => {
  expect(draw("sequenceDiagram\n  actor U as User\n  participant S as Server\n  participant D as Database\n  U->>S: GET /items\n  S->>D: SELECT *\n  D-->>S: rows\n  S-->>U: 200 OK", 70)).toBe(art(`
┌──────┐     ┌────────┐  ┌──────────┐
│ User │     │ Server │  │ Database │
└───┬──┘     └────┬───┘  └─────┬────┘
    ┆             ┆            ┆
    ┆ GET /items  ┆            ┆
    ├────────────►┤            ┆
    ┆             ┆            ┆
    ┆             ┆ SELECT *   ┆
    ┆             ├───────────►┤
    ┆             ┆            ┆
    ┆             ┆ rows       ┆
    ┆             ├◄┄┄┄┄┄┄┄┄┄┄┄┤
    ┆             ┆            ┆
    ┆ 200 OK      ┆            ┆
    ├◄┄┄┄┄┄┄┄┄┄┄┄┄┤            ┆
    ┆             ┆            ┆
`))
})

test("message styles", () => {
  expect(draw("sequenceDiagram\n  A->B: open\n  A-->B: dashed open\n  A-xB: cross\n  A-)B: async", 60)).toBe(art(`
┌───┐          ┌───┐
│ A │          │ B │
└─┬─┘          └─┬─┘
  ┆              ┆
  ┆ open         ┆
  ├──────────────┤
  ┆              ┆
  ┆ dashed open  ┆
  ├┄┄┄┄┄┄┄┄┄┄┄┄┄┄┤
  ┆              ┆
  ┆ cross        ┆
  ├─────────────×┤
  ┆              ┆
  ┆ async        ┆
  ├─────────────»┤
  ┆              ┆
`))
})

test("notes beside, over one and over two participants, with numbering", () => {
  expect(draw("sequenceDiagram\n  autonumber\n  Alice->>Bob: Hi\n  Note right of Bob: Bob thinks\n  Note left of Alice: Alice waits\n  Note over Alice: alone\n  Note over Alice,Bob: both of them\n  Bob->>Alice: Bye", 70)).toBe(art(`
            ┌───────┐        ┌─────┐
            │ Alice │        │ Bob │
            └───┬───┘        └──┬──┘
                ┆               ┆
                ┆ 1. Hi         ┆
                ├──────────────►┤
                ┆               ┆
                ┆               ┆ ┌────────────┐
                ┆               ┆ │ Bob thinks │
                ┆               ┆ └────────────┘
                ┆               ┆
┌─────────────┐ ┆               ┆
│ Alice waits │ ┆               ┆
└─────────────┘ ┆               ┆
                ┆               ┆
            ┌───────┐           ┆
            │ alone │           ┆
            └───────┘           ┆
                ┆               ┆
              ┌───────────────────┐
              │   both of them    │
              └───────────────────┘
                ┆               ┆
                ┆ 2. Bye        ┆
                ├◄──────────────┤
                ┆               ┆
`))
})

test("a message to itself", () => {
  expect(draw("sequenceDiagram\n  A->>A: think hard\n  A->>B: done", 60)).toBe(art(`
┌───┐             ┌───┐
│ A │             │ B │
└─┬─┘             └─┬─┘
  ┆                 ┆
  ├──┐ think hard   ┆
  ├◄─┘              ┆
  ┆                 ┆
  ┆ done            ┆
  ├────────────────►┤
  ┆                 ┆
`))
})

test("blocks show as a marker row", () => {
  expect(draw("sequenceDiagram\n  A->>B: start\n  loop Every minute\n    B->>A: ping\n  end\n  alt ok\n    A->>B: yes\n  else bad\n    A->>B: no\n  end", 60)).toBe(art(`
┌───┐    ┌───┐
│ A │    │ B │
└─┬─┘    └─┬─┘
  ┆        ┆
  ┆ start  ┆
  ├───────►┤
  ┆        ┆
── loop · Every minute ──
  ┆        ┆
  ┆ ping   ┆
  ├◄───────┤
  ┆        ┆
── alt · ok ──
  ┆        ┆
  ┆ yes    ┆
  ├───────►┤
  ┆        ┆
── else · bad ──
  ┆        ┆
  ┆ no     ┆
  ├───────►┤
  ┆        ┆
`))
})

test("a message that crosses a lifeline", () => {
  expect(draw("sequenceDiagram\n  A->>C: skips the middle one\n  B->>A: back", 60)).toBe(art(`
┌───┐                   ┌───┐  ┌───┐
│ A │                   │ C │  │ B │
└─┬─┘                   └─┬─┘  └─┬─┘
  ┆                       ┆      ┆
  ┆ skips the middle one  ┆      ┆
  ├──────────────────────►┤      ┆
  ┆                       ┆      ┆
  ┆ back                  ┆      ┆
  ├◄──────────────────────┼──────┤
  ┆                       ┆      ┆
`))
})

test("long labels wrap to fit a narrow pane", () => {
  expect(draw("sequenceDiagram\n  Alice->>Bob: A fairly long message about things\n  Bob-->>Alice: ok", 30)).toBe(art(`
┌───────┐         ┌─────┐
│ Alice │         │ Bob │
└───┬───┘         └──┬──┘
    ┆                ┆
    ┆ A fairly long  ┆
    ┆ message about  ┆
    ┆ things         ┆
    ├───────────────►┤
    ┆                ┆
    ┆ ok             ┆
    ├◄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┤
    ┆                ┆
`))
})

test("a pie chart as bars with percentages", () => {
  expect(draw("pie title Pets adopted\n  \"Dogs\" : 386\n  \"Cats\" : 85\n  \"Rats\" : 15", 50)).toBe(art(`
Pets adopted

Dogs  █████████████████████████████▍░░░░░░░  79.4%
Cats  ██████▌░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  17.5%
Rats  █▏░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   3.1%
`))
})

test("showData adds the values", () => {
  expect(draw("pie showData\n  \"Alpha\" : 1\n  \"Beta\" : 1\n  \"Gamma\" : 2", 40)).toBe(art(`
Alpha  █████▊░░░░░░░░░░░░░░░░░  25.0%  1
Beta   █████▊░░░░░░░░░░░░░░░░░  25.0%  1
Gamma  ███████████▌░░░░░░░░░░░  50.0%  2
`))
})

test("a pie in a very narrow pane drops the bars and cuts the labels", () => {
  expect(draw("pie\n  \"A long label that gets cut\" : 3\n  \"B\" : 1", 20)).toBe(art(`
A long…  75.0%
B        25.0%
`))
})
