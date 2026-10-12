// Walks tool results and conversation rows and redacts every string in them. Pure: it returns the SAME object
// when nothing changed (so callers can tell by identity) and a modified copy otherwise; the input is never mutated.

import { mergeHits, redact } from './detect'
import type { Hits, Rule } from './detect'

/** Keys whose strings are paths, ids or bulk media: scanning them finds nothing and costs time. */
const SKIP_KEYS = new Set(['base64', 'filePath', 'file_path', 'filenames', 'outputDir', 'rawOutputPath', 'persistedOutputPath', 'tool_use_id'])
const MEDIA_TYPES = new Set(['image', 'document', 'audio', 'video'])
const MAX_DEPTH = 16

type Ctx = { rules: readonly Rule[]; hits: Hits }

/** Redacts the strings of any JSON-like value (a tool's record, an MCP result, an error text). */
export function scrubValue(value: unknown, rules: readonly Rule[], hits: Hits): unknown {
  return walk(value, { rules, hits }, 0)
}

function walk(value: unknown, ctx: Ctx, depth: number): unknown {
  if (typeof value === 'string') return one(value, ctx)
  if (depth >= MAX_DEPTH || typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) return mapArray(value, ctx, depth)
  const record = value as Record<string, unknown>
  if (typeof record.type === 'string' && MEDIA_TYPES.has(record.type)) return value
  let copy: Record<string, unknown> | undefined
  for (const [key, inner] of Object.entries(record)) {
    if (SKIP_KEYS.has(key)) continue
    const next = walk(inner, ctx, depth + 1)
    if (next !== inner) (copy ??= { ...record })[key] = next
  }
  return copy ?? value
}

function mapArray(items: readonly unknown[], ctx: Ctx, depth: number): unknown {
  let copy: unknown[] | undefined
  items.forEach((item, i) => {
    const next = walk(item, ctx, depth + 1)
    if (next !== item) (copy ??= [...items])[i] = next
  })
  return copy ?? items
}

function one(text: string, ctx: Ctx): string {
  const found = redact(text, ctx.rules)
  mergeHits(ctx.hits, found.hits)
  return found.text
}

type Block = { type: string; [field: string]: unknown }

/**
 * The content blocks of a row. Text blocks and a tool_result's content are redacted; media, thinking and tool_use
 * blocks are left as they are (the engine puts those back anyway).
 */
export function scrubBlocks(blocks: readonly Block[], rules: readonly Rule[], hits: Hits): readonly Block[] {
  const ctx: Ctx = { rules, hits }
  let copy: Block[] | undefined
  blocks.forEach((block, i) => {
    const next = scrubBlock(block, ctx)
    if (next !== block) (copy ??= [...blocks])[i] = next
  })
  return copy ?? blocks
}

function scrubBlock(block: Block, ctx: Ctx): Block {
  if (block.type === 'text' && typeof block.text === 'string') {
    const text = one(block.text, ctx)
    return text === block.text ? block : { ...block, text }
  }
  if (block.type === 'tool_result') {
    const content = walk(block.content, ctx, 1)
    return content === block.content ? block : { ...block, content }
  }
  return block
}
