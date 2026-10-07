// ============================================================
// 核心管线 — 素材 → AI 选题 → AI 生成 → 内容安全 → 入库
// ============================================================

import type {
  Seed, SeedInput, GeneratedArticle, InsertResult,
  AiClient, AiConfig, AiMessage, PipelineConfig,
  PipelineRunResult, TopicSuggestion, RunLogInput, ContentBlock,
} from './types.js'
import { aiSystemPrompt, aiSuggestPrompt } from './prompts.js'
import { extractJson, asAnyArray, normalizeContentBlocks } from './utils.js'
import { checkArticleSafety, replaceViolatingWords } from './content-safety.js'
import { createAiClient } from './ai-fallback.js'

// —— 占位 URL 清洗 ——

const PLACEHOLDER_URL = /(^|[/.@])(example\.(com|org|net)|test\.com|yourlink\.com|yourdomain\.com|your-url\.com|sample\.com|domain\.com|website\.com|lorem\.ipsum|placeholder\.com)/i

function cleanUrl(u: unknown): string {
  if (typeof u !== 'string') return ''
  const s = u.trim()
  if (!/^https?:\/\//i.test(s)) return ''
  if (PLACEHOLDER_URL.test(s)) return ''
  return s
}

function sanitizeLinks(arr: unknown): Array<{ label: string; url: string }> {
  return (Array.isArray(arr) ? arr : [])
    .filter((l): l is { label: string; url: string } =>
      l != null && typeof l === 'object' && typeof (l as any).url === 'string' && !!cleanUrl((l as any).url))
    .map((l) => ({ label: String((l as any).label || ''), url: cleanUrl((l as any).url) }))
}

function sanitizeBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return blocks
    .map((b) => {
      if (!b || typeof b !== 'object') return b
      if (b.type === 'ad' && typeof (b as any).link === 'string' && !cleanUrl((b as any).link)) {
        const { link: _, ...rest } = b as any
        return rest as ContentBlock
      }
      if ((b.type === 'image' || b.type === 'video') && typeof (b as any).url === 'string' && !cleanUrl((b as any).url)) {
        return null
      }
      return b
    })
    .filter((b): b is ContentBlock => b !== null)
}

// —— 默认 AI 客户端（复用 ai-fallback 的 OpenAI 兼容客户端）——

function createDefaultAiClient(config: AiConfig): AiClient {
  return createAiClient({
    openai: {
      baseUrl: config.baseUrl || 'https://api.openai.com/v1',
      apiKey: config.apiKey || '',
      model: config.model || 'gpt-4o-mini',
      maxTokens: config.maxTokens || 4096,
    },
  })
}

// —— 重试工具 ——

/** 可注入的 sleep 函数（Workers alarm 里需用 ctx.waitUntil） */
export type SleepFn = (ms: number) => Promise<void>

const defaultSleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms))

async function withRetry<T>(fn: () => Promise<T>, retries: number, label: string, sleep: SleepFn = defaultSleep): Promise<T> {
  let lastErr: Error | undefined
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn()
    } catch (e: any) {
      lastErr = e
      if (i < retries) {
        await sleep(1000 * (i + 1))
      }
    }
  }
  throw lastErr!
}

/** 简单并发限制：并发执行 tasks，最多同时 limit 个 */
async function mapWithConcurrency<T, R>(tasks: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(tasks.length)
  let nextIdx = 0
  async function worker() {
    while (nextIdx < tasks.length) {
      const i = nextIdx++
      try {
        const value = await fn(tasks[i], i)
        results[i] = { status: 'fulfilled', value }
      } catch (reason: any) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker)
  await Promise.all(workers)
  return results
}

// —— 管线核心 ——

export interface Pipeline {
  /** AI 自动选题（返回选题列表，不入库） */
  suggestTopics(): Promise<TopicSuggestion[]>
  /** 单条素材 → AI 生成文章（不做安全检查，不入库） */
  generateArticle(raw: string, opts?: { category?: string; template?: string }): Promise<GeneratedArticle>
  /** 完整管线：拉取种子 → 选题补足 → 生成 → 安全检查 → 入库 */
  run(): Promise<PipelineRunResult>
}

export interface PipelineDB {
  fetchPendingSeeds(size: number): Promise<Seed[]>
  insertSeeds(items: SeedInput[], source: string): Promise<{ added: number }>
  markSeedDone(id: number, articleId: string): Promise<void>
  markSeedFailed(id: number, error: string): Promise<void>
  insertArticles(articles: GeneratedArticle[]): Promise<InsertResult>
  insertRunLog(log: RunLogInput): Promise<void>
}

export function createPipeline(db: PipelineDB, config: PipelineConfig = {}): Pipeline {
  const target = config.target ?? 3

  // AI 客户端选择逻辑：
  // 1. config.ai.client → 直接使用（最高优先级）
  // 2. config.ai.cloudflare → 使用降级客户端（额度用完自动切换）
  // 3. config.ai.baseUrl/apiKey → 使用 OpenAI 兼容客户端
  // 4. 默认 → OpenAI 兼容客户端
  let aiClient: AiClient
  if (config.ai?.client) {
    aiClient = config.ai.client
  } else if (config.ai?.cloudflare) {
    aiClient = createAiClient({
      cloudflare: config.ai.cloudflare,
    })
  } else {
    aiClient = createDefaultAiClient(config.ai ?? {})
  }

  const systemPrompt = config.systemPrompt ?? aiSystemPrompt()
  const suggestPrompt = config.suggestPrompt ?? aiSuggestPrompt()
  const extraSafetyRules = config.extraSafetyRules ?? []
  const sanitizeUrls = config.sanitizeUrls ?? true
  const safetyAction = config.safetyAction ?? 'replace'
  const suggestRetries = config.suggestRetries ?? 1

  // —— AI 选题（带重试）——

  async function suggestTopics(): Promise<TopicSuggestion[]> {
    return withRetry(async () => {
      const text = await aiClient([
        { role: 'system', content: suggestPrompt },
        { role: 'user', content: '请输出 3 个选题 JSON 数组。只输出 JSON 数组，不要 markdown，不要解释。' },
      ])
      const parsed = extractJson(text)
      const arr = asAnyArray(parsed)
      if (!arr || !arr.length) {
        const snippet = String(text || '').slice(0, 180).replace(/\s+/g, ' ')
        throw new Error(`AI 选题返回空数组 raw=${snippet}`)
      }
      const items = arr
        .map((x: any) => ({
          title: String(x?.title || '').trim(),
          angle: String(x?.angle || '').trim(),
          category: ['优惠', '攻略', '好物', '副业'].includes(x?.category) ? x.category : 'auto',
        }))
        .filter((x) => x.title && x.angle)
      if (!items.length) throw new Error('AI 选题字段无效（缺 title/angle）')
      return items.slice(0, 3)
    }, suggestRetries, 'AI 选题')
  }

  // —— 单素材生成 ——

  async function generateArticle(
    raw: string,
    opts: { category?: string; template?: string } = {},
  ): Promise<GeneratedArticle> {
    if (!raw || raw.length < 8) throw new Error('素材过短（至少 8 字符）')

    const text = await aiClient([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `原始信息：\n${JSON.stringify(raw)}` },
    ])
    const a = extractJson(text) as any
    if (!a) throw new Error('AI 返回无法解析为 JSON')

    const item: GeneratedArticle = {
      title: String(a.title || '').trim(),
      summary: String(a.summary || ''),
      content: normalizeContentBlocks(a.content),
      template: (['deal', 'guide', 'faq', 'default'].includes(a.template)
        ? a.template
        : (opts.template && opts.template !== 'auto' ? opts.template : 'deal')) as GeneratedArticle['template'],
      category: opts.category && opts.category !== 'auto' ? opts.category : (a.category || '优惠'),
      tags: Array.isArray(a.tags) ? a.tags : [],
      faq: Array.isArray(a.faq) ? a.faq : [],
      links: Array.isArray(a.links) ? a.links : [],
      expiresAt: a.expiresAt || null,
    }

    if (!item.title || !item.content.length) throw new Error('AI 结果缺 title/content')

    // 内容充实度兜底
    const contentChars = JSON.stringify(item.content).length
    if (item.content.length < 3 || contentChars < 250) {
      throw new Error(`AI 内容过短（${item.content.length} 块 / ${contentChars} 字），请重试`)
    }

    // URL 清洗
    if (sanitizeUrls) {
      item.links = sanitizeLinks(item.links)
      item.content = sanitizeBlocks(item.content)
    }

    return item
  }

  // —— 内容安全处理 ——

  function applySafety(article: GeneratedArticle): { article: GeneratedArticle; hit: boolean } {
    const safety = checkArticleSafety({
      title: article.title,
      summary: article.summary,
      content: article.content,
      faq: article.faq,
      tags: article.tags,
      links: article.links,
    }, extraSafetyRules)

    if (!safety.hits.length) return { article, hit: false }

    if (safetyAction === 'draft') {
      article.status = 'draft'
      return { article, hit: true }
    }

    // replace 模式：逐字段替换违规词
    const r1 = replaceViolatingWords(article.title)
    article.title = r1.text
    const r2 = replaceViolatingWords(article.summary)
    article.summary = r2.text
    article.content = article.content.map((b) => {
      if ('text' in b && typeof b.text === 'string') {
        const r = replaceViolatingWords(b.text)
        return r.replaced ? { ...b, text: r.text } : b
      }
      return b
    })

    return { article, hit: true }
  }

  // —— 完整管线 ——

  async function run(): Promise<PipelineRunResult> {
    const result: PipelineRunResult = { ok: 0, fail: 0, total: 0, articles: [], errors: [] }

    // 1. 拉取 pending 素材
    let list = await db.fetchPendingSeeds(target + 5)
    const have = list?.length || 0

    // 2. 素材不足 → AI 选题补足（带重试）
    if (have < target) {
      try {
        const topics = await suggestTopics()
        if (topics.length) {
          await db.insertSeeds(
            topics.map((tp) => ({
              raw: `选题：${tp.title}\n思路：${tp.angle}\n分类建议：${tp.category}`,
              category: tp.category,
            })),
            'ai',
          )
          list = await db.fetchPendingSeeds(target + 5)
        }
      } catch (e: any) {
        result.errors.push(`AI 选题失败: ${e.message}`)
      }
    }

    if (!list || !list.length) {
      result.errors.push('素材池没有待处理素材')
      return result
    }

    // 3. 清理已关联文章的残留 pending
    const linked = list.filter((s) => s.articleId)
    if (linked.length) {
      for (const s of linked) {
        await db.markSeedDone(s.id, s.articleId!).catch(() => {})
      }
      list = list.filter((s) => !s.articleId)
    }

    // 4. 生成 + 安全处理
    const targets = list.slice(0, target)
    result.total = targets.length

    const outcomes = await mapWithConcurrency(targets, 3, async (s) => {
      const raw = String(s.raw || '')
      if (raw.length < 8) {
        await db.markSeedFailed(s.id, '素材过短').catch(() => {})
        throw new Error('素材过短')
      }

      const article = await generateArticle(raw, {
        category: s.category,
        template: s.template,
      })

      // 内容安全处理
      const { article: safeArticle } = applySafety(article)

      // 入库
      const r = await db.insertArticles([safeArticle])
      const res = r.results?.[0]
      if (res?.ok && res.id) {
        await db.markSeedDone(s.id, res.id)
        return { title: safeArticle.title, articleId: res.id }
      }
      await db.markSeedFailed(s.id, res?.error || '入库失败')
      throw new Error(res?.error || '入库失败')
    })

    // 5. 汇总
    for (const o of outcomes) {
      if (o.status === 'fulfilled') {
        result.ok++
        result.articles.push(o.value)
      } else {
        result.fail++
        result.errors.push(o.reason?.message || '未知错误')
      }
    }

    // 6. 运行日志
    try {
      await db.insertRunLog({
        runAt: new Date().toISOString(),
        model: config.ai?.model || 'default',
        total: result.total,
        ok: result.ok,
        fail: result.fail,
        error: result.errors.length ? result.errors.join('; ').slice(0, 300) : null,
      })
    } catch { /* 日志失败不阻塞 */ }

    return result
  }

  return { suggestTopics, generateArticle, run }
}
