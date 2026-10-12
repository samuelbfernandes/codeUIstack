import { expect, test } from 'claude-code/testing'

import { Canvas } from '../hooks/canvas'
import { parseFlow, statementsOf } from '../hooks/flow-parse'
import { parsePie } from '../hooks/pie'
import { parseSequence } from '../hooks/sequence'
import { clean, codeBox, truncate, wrapText } from '../hooks/text'

const flow = (body: string, header = 'flowchart TD') => parseFlow(header, body.split('\n'))

// ---- the flowchart parser -----------------------------------------------------------------------------------------

test('node shapes and their text', () => {
  const { nodes } = flow('A[Rect text] --> B(Round) --> C{Diamond} --> D((Circle)) --> E[(Db)] --> F[[Sub]] --> G{{Hex}} --> H([Stadium]) --> I')
  expect(nodes.map(n => [n.id, n.text, n.shape])).toEqual([
    ['A', 'Rect text', 'rect'],
    ['B', 'Round', 'round'],
    ['C', 'Diamond', 'diamond'],
    ['D', 'Circle', 'round'],
    ['E', 'Db', 'rect'],
    ['F', 'Sub', 'rect'],
    ['G', 'Hex', 'round'],
    ['H', 'Stadium', 'round'],
    ['I', 'I', 'rect'],
  ])
})

test('quotes, brackets inside quotes, line breaks and class suffixes in node text', () => {
  const { nodes } = flow('A["a ] b"] --> B[one<br/>two] --> C[<b>bold</b>]:::hot --> D["`md`"]')
  expect(nodes.map(n => n.text)).toEqual(['a ] b', 'one\ntwo', 'bold', 'md'])
})

test('a later definition gives an earlier bare node its text and shape; a bare mention changes nothing', () => {
  const { nodes } = flow('A --> B\nB{Choose}\nB --> C\nA')
  expect(nodes.map(n => [n.id, n.text, n.shape])).toEqual([['A', 'A', 'rect'], ['B', 'Choose', 'diamond'], ['C', 'C', 'rect']])
})

test('every arrow form: style, head, label', () => {
  const { edges } = flow(
    [
      'A --> B',
      'B --- C',
      'C -.-> D',
      'D -..-> E',
      'E ==> F',
      'F === G',
      'G <--> H',
      'H --x I',
      'I --o J',
      'J -->|with label| K',
      'K -- old label --> L',
      'L -. dotted old .-> M',
      'M == thick old ==> N',
      'N --- O',
    ].join('\n'),
  )
  expect(edges.map(e => [e.from + e.to, e.style, e.head, e.both, e.label])).toEqual([
    ['AB', 'solid', true, false, ''],
    ['BC', 'solid', false, false, ''],
    ['CD', 'dotted', true, false, ''],
    ['DE', 'dotted', true, false, ''],
    ['EF', 'thick', true, false, ''],
    ['FG', 'thick', false, false, ''],
    ['GH', 'solid', true, true, ''],
    ['HI', 'solid', true, false, ''],
    ['IJ', 'solid', true, false, ''],
    ['JK', 'solid', true, false, 'with label'],
    ['KL', 'solid', true, false, 'old label'],
    ['LM', 'dotted', true, false, 'dotted old'],
    ['MN', 'thick', true, false, 'thick old'],
    ['NO', 'solid', false, false, ''],
  ])
})

test('chains, groups, repeats and semicolons', () => {
  const { edges } = flow('A --> B --> C; X & Y --> Z\nA --> B')
  expect(edges.map(e => `${e.from}${e.to}`)).toEqual(['AB', 'BC', 'XZ', 'YZ'])
})

test('directions: TB and TD are top-down, LR left-right, BT and RL are noted', () => {
  expect(flow('A-->B', 'flowchart TB').direction).toBe('TD')
  expect(flow('A-->B', 'graph LR').direction).toBe('LR')
  expect(flow('A-->B', 'graph RL')).toMatchObject({ direction: 'LR', notes: ['RL is drawn as LR'] })
  expect(flow('A-->B', 'flowchart BT')).toMatchObject({ direction: 'TD', notes: ['BT is drawn as TD'] })
  expect(flow('A-->B', 'flowchart').direction).toBe('TD')
  expect(flow('', 'graph TD; A --> B').edges).toHaveLength(1)
})

test('styling lines are ignored; a node called like a keyword prefix is not', () => {
  const { nodes } = flow('classDef a fill:#f00\nclass A a\nstyle A fill:#fff\nlinkStyle 0 stroke:red\nclick A cb\nclassy --> styled')
  expect(nodes.map(n => n.id)).toEqual(['classy', 'styled'])
})

test('statements it cannot read throw, so the caller shows the source', () => {
  for (const bad of ['A -->', '--> B', 'A[open --> B', 'A -->|x B', '??', 'A B', '', 'A --> B -->']) expect(() => flow(bad)).toThrow()
})

test('statementsOf splits at ; outside quotes and brackets and drops comments', () => {
  expect(statementsOf('A --> B; B --> C %% note')).toEqual(['A --> B', 'B --> C'])
  expect(statementsOf('A["x;y"] --> B[a;b]')).toEqual(['A["x;y"] --> B[a;b]'])
  expect(statementsOf('%% only a comment')).toEqual([])
})

// ---- the other parsers --------------------------------------------------------------------------------------------

test('sequence: participants in order of appearance, aliases, message forms, notes, blocks', () => {
  const seq = parseSequence(
    [
      'participant B as Bob<br/>B',
      'A->>B: one',
      'A-->>+B: two',
      'B->A: three',
      'B--xA: four',
      'A-)B: five',
      'Note left of A: n1',
      'Note over A,B: n2',
      'loop Every minute',
      'activate A',
      'end',
    ].join('\n').split('\n'),
  )
  expect(seq.names).toEqual(['Bob\nB', 'A'])
  expect(seq.events.map(e => (e.type === 'message' ? `${e.from}${e.to} ${e.style} ${e.head} ${e.text}` : e.type === 'note' ? `${e.where} ${e.a}-${e.b} ${e.text}` : e.text))).toEqual([
    '10 solid arrow one',
    '10 dotted arrow two',
    '01 solid none three',
    '01 dotted cross four',
    '10 solid async five',
    'left 1-1 n1',
    'over 0-1 n2',
    'loop · Every minute',
  ])
})

test('sequence: autonumber numbers the messages from the line it appears on', () => {
  const seq = parseSequence(['A->>B: before', 'autonumber', 'A->>B: x', 'B->>A: y'])
  expect(seq.events.map(e => (e.type === 'message' ? e.text : ''))).toEqual(['before', '2. x', '3. y'])
})

test('sequence: a line it cannot read throws', () => {
  expect(() => parseSequence(['what is this'])).toThrow()
  expect(() => parseSequence([])).toThrow()
})

test('pie: header options, titles, quoted and bare labels, decimals', () => {
  expect(parsePie('pie showData title Pets', ['"Dogs" : 3', 'Cats : 1.5'])).toEqual({
    title: 'Pets',
    showData: true,
    slices: [{ label: 'Dogs', value: 3 }, { label: 'Cats', value: 1.5 }],
  })
  expect(parsePie('pie', ['title Later', '"A" : 1', '%% c'])).toMatchObject({ title: 'Later', showData: false })
  expect(() => parsePie('pie', [])).toThrow()
  expect(() => parsePie('pie', ['"A" : x'])).toThrow()
})

// ---- canvas and text ----------------------------------------------------------------------------------------------

test('canvas: lines join into corners, tees and crossings; heavier styles win; dotted cells use the dotted glyphs', () => {
  const c = new Canvas(5, 5)
  c.hline(0, 4, 2)
  c.vline(2, 0, 4)
  c.vline(0, 2, 4)
  c.hline(0, 1, 4, 'thick')
  expect(c.toLines()).toEqual(['  │', '  │', '┌─┼──', '│ │', '┗━│'])
})

test('canvas: dotted and thick straight runs, characters over lines, writes outside are ignored, free cells', () => {
  const c = new Canvas(6, 3)
  c.hline(0, 5, 0, 'dotted')
  c.vline(0, 0, 2, 'dotted')
  c.hline(1, 5, 2, 'thick')
  c.put(3, 1, 'x')
  c.text(4, 1, 'long text')
  c.put(-1, 0, 'q')
  c.vline(99, 0, 2)
  expect(c.toLines()).toEqual(['┌┄┄┄┄┄', '┆  xlo', '┆━━━━━'])
  expect(c.isFree(1, 1, 2)).toBe(true)
  expect(c.isFree(1, 1, 3)).toBe(false)
  expect(c.isFree(5, 1, 2)).toBe(false) // off the canvas
})

test('text: wrapText keeps newlines, breaks long words, never returns nothing', () => {
  expect(wrapText('one two three four', 9)).toEqual(['one two', 'three', 'four'])
  expect(wrapText('a\n\nb', 5)).toEqual(['a', '', 'b'])
  expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  expect(wrapText('', 5)).toEqual([''])
  expect(wrapText('x', 0)).toEqual(['x'])
})

test('text: truncate, clean and codeBox', () => {
  expect(truncate('abcdef', 4)).toBe('abc…')
  expect(truncate('abc', 3)).toBe('abc')
  expect(truncate('abc', 1)).toBe('…')
  expect(truncate('abc', 0)).toBe('')
  expect(clean('a\tb\r\nc\u0007d')).toBe('a  b\ncd')
  expect(codeBox('a\nbb', 20)).toEqual(['┌────┐', '│ a  │', '│ bb │', '└────┘'])
  expect(codeBox('x'.repeat(30), 14)).toEqual(['┌────────────┐', '│ xxxxxxxxxx │', '│ xxxxxxxxxx │', '│ xxxxxxxxxx │', '└────────────┘'])
  const long = codeBox(Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n'), 40)
  expect(long).toHaveLength(60 + 3)
  expect(long[long.length - 2]).toContain('… 40 more lines')
})
