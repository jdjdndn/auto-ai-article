// ============================================================
// 素材采集：RSS 解析 + HTML 正文提取 + 文本相似度去重
// 零依赖纯 JS，可直接跑在 Cloudflare Workers
// ============================================================

export interface RssItem {
  title: string
  link: string
  description: string
  pubDate: string
}

/** 极简 RSS/Atom 解析：从 XML 提取 item 列表 */
function parseRssXml(xml: string): RssItem[] {
  const items: RssItem[] = []
  const itemRegex = /<(?:item|entry)[\s>][\s\S]*?<\/(?:item|entry)>/gi
  let match: RegExpExecArray | null
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[0]
    const title = extractTag(block, 'title')
    const link = extractTag(block, 'link') || extractAttr(block, 'link', 'href')
    const description = extractTag(block, 'description') || extractTag(block, 'summary') || extractTag(block, 'content')
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated')
    if (title && link) {
      items.push({ title, link, description: stripHtml(description).slice(0, 500), pubDate })
    }
  }
  return items
}

function extractTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return m ? decodeHtml(m[1].trim()) : ''
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i'))
  return m ? m[1] : ''
}

function stripHtml(html: string): string {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function decodeHtml(s: string): string {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

/** fetch RSS feed 并解析为 item 数组 */
export async function fetchRssFeed(url: string, timeoutMs = 10000): Promise<RssItem[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'ArticleBot/1.0' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const xml = await res.text()
    return parseRssXml(xml)
  } finally {
    clearTimeout(timer)
  }
}

/** 从 HTML 提取正文：优先 <article>/<main>，否则取所有 <p> 拼接 */
export function extractArticleText(html: string): string {
  if (!html) return ''
  let body = html
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    || html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
  if (articleMatch) body = articleMatch[1]
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
  const paragraphs: string[] = []
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi
  let m: RegExpExecArray | null
  while ((m = pRegex.exec(body)) !== null) {
    const text = stripHtml(m[1])
    if (text.length > 20) paragraphs.push(text)
  }
  return paragraphs.slice(0, 15).join('\n').slice(0, 2000)
}

/** 文本归一化：小写、去标点 */
export function normalizeText(text: unknown): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 文本相似度：bigram Jaccard，返回 0-1 */
export function textSimilarity(a: unknown, b: unknown): number {
  const na = normalizeText(a)
  const nb = normalizeText(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const setA = new Set<string>()
  const setB = new Set<string>()
  for (let i = 0; i < na.length - 1; i++) setA.add(na.slice(i, i + 2))
  for (let i = 0; i < nb.length - 1; i++) setB.add(nb.slice(i, i + 2))
  if (!setA.size || !setB.size) return 0
  let intersection = 0
  for (const g of setA) if (setB.has(g)) intersection++
  return intersection / (setA.size + setB.size - intersection)
}
