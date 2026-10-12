import { expect, test } from 'claude-code/testing'

import { MAX_NODES, drawDiagram } from '../hooks/render'

const SOURCES = [
  'flowchart TD\n  A[Start] --> B{Ok?}\n  B -->|yes| C[Go]\n  B -->|no| D(Stop)\n  C --> E[Done]\n  D --> E\n  E --> A',
  'flowchart LR\n  A[One] --> B[Two] --> C[Three] --> D[Four]\n  A -.->|skip| D\n  B ==> D',
  'graph TD\n  R --> A & B & C\n  A --> M\n  B --> M\n  C --> M\n  R -->|long| M',
  'sequenceDiagram\n  autonumber\n  Alice->>Bob: A fairly long message that has to wrap somewhere\n  Note over Alice,Bob: both\n  Bob-->>Alice: ok\n  loop Every minute\n    Alice->>Alice: think\n  end',
  'pie showData title Pets\n  "Dogs" : 386\n  "Cats and other small furry things" : 85\n  "Rats" : 15',
  'classDiagram\n  Animal <|-- Duck',
  'gantt\n  title A very long title that is wider than a narrow pane for sure',
  'garbage with a very long first line that goes on and on and on and on',
]
const WIDTHS = [12, 14, 20, 30, 40, 60, 80, 120, 300]

test('every drawing fits the columns it was given, and whatever is not drawn says so', () => {
  for (const source of SOURCES) {
    for (const columns of WIDTHS) {
      const drawing = drawDiagram(source, columns)
      for (const line of drawing.lines) expect(line.length).toBeLessThanOrEqual(columns)
      if (!drawing.isDrawn) {
        expect(drawing.title).toBe('')
        expect(drawing.lines[0]).toMatch(/^Diagram ·/)
      } else expect(drawing.title).not.toBe('')
    }
  }
})

test('no drawing contains a tab, a control character or a trailing blank', () => {
  const tabbed = 'flowchart TD\n\tA[Tab\there] --> B\n\tB --> C'
  for (const source of [tabbed, `classDiagram\n\tA <|-- B`, ...SOURCES]) {
    for (const line of drawDiagram(source, 60).lines) {
      // eslint-disable-next-line no-control-regex
      expect(/[\u0000-\u001f\u007f-\u009f]/.test(line)).toBe(false)
      expect(line).toBe(line.replace(/\s+$/, ''))
    }
  }
  expect(drawDiagram(tabbed, 60).isDrawn).toBe(true)
  expect(drawDiagram('classDiagram\n\tA <|-- B', 60).lines.join('\n')).toContain('│   A <|-- B')
})

test('up to 25 nodes are drawn; more show the source', () => {
  const chain = (n: number) => `flowchart TD\n${Array.from({ length: n - 1 }, (_, i) => `  N${i} --> N${i + 1}`).join('\n')}`
  expect(MAX_NODES).toBe(25)
  expect(drawDiagram(chain(25), 60).isDrawn).toBe(true)
  const over = drawDiagram(chain(26), 60)
  expect(over.isDrawn).toBe(false)
  expect(over.lines[0]).toBe('Diagram · 26 nodes is more than the 25 drawn here')
  expect(over.lines.join('\n')).toContain('N24 --> N25')
  expect(drawDiagram(chain(5), 60, { maxNodes: 4 }).lines[0]).toBe('Diagram · 5 nodes is more than the 4 drawn here')
})

test('a sequence diagram has the same cap on participants, and a cap on steps', () => {
  const people = `sequenceDiagram\n${Array.from({ length: 26 }, (_, i) => `  participant P${i}`).join('\n')}\n  P0->>P1: hi`
  expect(drawDiagram(people, 300).lines[0]).toBe('Diagram · 26 participants is more than the 25 drawn here')
  const steps = `sequenceDiagram\n${'  A->>B: x\n'.repeat(151)}`
  expect(drawDiagram(steps, 60).lines[0]).toBe('Diagram · 151 steps is more than the 150 drawn here')
  expect(drawDiagram(`sequenceDiagram\n${'  A->>B: x\n'.repeat(150)}`, 60).isDrawn).toBe(true)
})

test('a dense flowchart is left as source quickly instead of being laid out', () => {
  const lines = ['flowchart TD']
  for (let a = 0; a < 25; a++) for (let b = 0; b < 25; b++) if (a !== b) lines.push(`  N${a} --> N${b}`)
  const started = Date.now()
  const drawing = drawDiagram(lines.join('\n'), 200)
  expect(drawing.isDrawn).toBe(false)
  expect(drawing.lines[0]).toBe('Diagram · 600 connections is more than the 60 drawn here')
  expect(Date.now() - started).toBeLessThan(2000)
})

test('every cycle shape is drawn without throwing and lists the loops', () => {
  const cycles = [
    'flowchart TD\n  A --> A',
    'flowchart TD\n  A --> B\n  B --> A',
    'flowchart LR\n  A --> B --> C --> A',
    'flowchart TD\n  A --> B\n  B --> C\n  C --> B\n  C --> A\n  B --> B',
    'flowchart LR\n  A --> B\n  B --> A\n  A --> C\n  C --> A\n  C --> C',
  ]
  for (const source of cycles) {
    for (const columns of [20, 60]) {
      const drawing = drawDiagram(source, columns)
      expect(drawing.isDrawn).toBe(true)
      expect(drawing.lines.some(line => line.startsWith('↺ '))).toBe(true)
    }
  }
})

test('garbage and odd input never throw, and always give a headline', () => {
  const junk = [
    '', ' ', '\n\n', '```', '\u0000\u0001\u0002', 'flowchart', 'flowchart TD', 'graph LR\nA-->', 'graph LR\n-->B', 'graph TD\nA --> B -->',
    'graph TD\nA[unclosed', 'graph TD\nA((x)', 'graph TD\nA -->|oops B', 'sequenceDiagram', 'sequenceDiagram\nA->>', 'sequenceDiagram\nNote over', 'pie',
    'pie\n"a": x', '%%', '---\ntitle: x', '---\ntitle: x\n---', 'x'.repeat(5000), '🙂🙂🙂', 'flowchart TD\nA --> B\n'.repeat(1000),
  ]
  for (const source of junk) {
    for (const columns of [1, 5, 12, 40, 100]) {
      const drawing = drawDiagram(source, columns)
      expect(drawing.lines.length).toBeGreaterThan(0)
      expect(drawing.lines.every(line => typeof line === 'string')).toBe(true)
    }
  }
  for (const odd of [undefined, null, 42, {}] as unknown[]) expect(drawDiagram(odd as string, 40).lines[0]).toBe('Diagram · nothing to draw')
  for (const columns of [Number.NaN, Infinity, -5, 0, 2.7]) expect(drawDiagram(SOURCES[0] as string, columns).lines.length).toBeGreaterThan(0)
})

test('pseudo-random punctuation after a header never throws', () => {
  let seed = 7
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const chars = 'AB[](){}|>-=.:;"\n %xo<&`~'.split('')
  const headers = ['flowchart TD\n', 'graph LR\n', 'sequenceDiagram\n', 'pie\n']
  for (let n = 0; n < 400; n++) {
    const header = headers[Math.floor(next() * headers.length)] as string
    const body = Array.from({ length: Math.floor(next() * 60) }, () => chars[Math.floor(next() * chars.length)]).join('')
    const drawing = drawDiagram(header + body, 60)
    for (const line of drawing.lines) expect(line.length).toBeLessThanOrEqual(60)
  }
})

test('randomly built flowcharts fit their columns whatever the shape', () => {
  let seed = 31
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const ops = ['-->', '---', '-.->', '==>', '-->|label|', '<-->']
  for (let n = 0; n < 120; n++) {
    const nodes = 2 + Math.floor(next() * 10)
    const lines = [`flowchart ${next() < 0.5 ? 'TD' : 'LR'}`]
    for (let i = 0; i < nodes * 1.5; i++) {
      const a = Math.floor(next() * nodes)
      const b = Math.floor(next() * nodes)
      lines.push(`  N${a}[Node number ${a}] ${ops[Math.floor(next() * ops.length)]} N${b}{Q ${b}?}`)
    }
    const columns = [20, 40, 80, 160][n % 4] as number
    for (const line of drawDiagram(lines.join('\n'), columns).lines) expect(line.length).toBeLessThanOrEqual(columns)
  }
})

test('a narrow pane drops the pie values first, then cuts the labels, and never overflows', () => {
  const pie = 'pie showData\n  "Alpha" : 12\n  "Beta" : 3'
  expect(drawDiagram(pie, 40).lines[0]).toMatch(/80\.0%\s+12$/)
  expect(drawDiagram(pie, 14).lines).toEqual(['Alp…  80.0%', 'Beta  20.0%'])
  expect(drawDiagram(pie, 3).lines).toEqual(['Alp…  80.0%', 'Beta  20.0%']) // 12 columns is the least it plans for
})
