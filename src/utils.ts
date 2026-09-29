// ============================================================
// 工具函数 — 从 article-site/shared/ai-utils.mjs + content.ts 提取
// ============================================================

import type { ContentBlock } from './types.js'

// —— JSON 提取（容忍 markdown 代码块包裹 / 前后多余文字）——

export function extractJson(text: string): unknown {
  if (typeof text !== 'string') return null
  const t = text.trim()
  try { return JSON.parse(t) } catch { /* fallthrough */ }
  const mc = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (mc) {
    try { return JSON.parse(mc[1].trim()) } catch { /* fallthrough */ }
  }
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)) } catch { /* fallthrough */ }
  }
  // 尝试提取数组
  const arrStart = t.indexOf('[')
  const arrEnd = t.lastIndexOf(']')
  if (arrStart >= 0 && arrEnd > arrStart) {
    try { return JSON.parse(t.slice(arrStart, arrEnd + 1)) } catch { /* fallthrough */ }
  }
  return null
}

// —— 内容工具 ——

/** 安全 JSON 解析 */
export function safeJson(s: string | null | undefined, fallback: unknown = []): unknown {
  if (!s) return fallback
  try { return JSON.parse(s) } catch { return fallback }
}

/** JSON 字段归一化：任意值 → 紧凑 JSON 字符串；空 → '[]' */
export function normalizeJson(v: unknown): string | null {
  if (v == null || v === '') return '[]'
  if (typeof v === 'string') {
    try { return JSON.stringify(JSON.parse(v)) } catch { return null }
  }
  try { return JSON.stringify(v) } catch { return null }
}

/** 从 content 块数组提取第一个 image 块 URL */
export function firstImageOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const b = content.find((x: unknown) => {
    const block = x as ContentBlock
    return block?.type === 'image' && 'url' in block && !!(block as any).url
  }) as any
  return b?.url || ''
}
