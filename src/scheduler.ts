// ============================================================
// 定时调度器 — 基于 Cloudflare Durable Objects Alarms
// 每天固定时间触发文章生成，无需 cron triggers
// ============================================================

import { execute, type ExecutorConfig } from './executor.js'
import { articles, seeds, runLogs } from './schema.js'
import { eq, desc } from 'drizzle-orm'
import { firstImageOf } from './utils.js'

/** 调度器配置 */
export interface SchedulerConfig {
  /** 目标时间（如 "08:00"），默认 "08:00" */
  time?: string
  /** 执行器配置（dailyTarget/ai 等从这里读，不硬编码） */
  executorConfig?: ExecutorConfig
}

/**
 * ArticleScheduler — Durable Object class
 *
 * 使用方式（在 Worker 入口文件中）：
 * ```ts
 * export { ArticleScheduler } from 'ai-article-pipeline'
 * ```
 *
 * wrangler.jsonc 配置：
 * ```json
 * {
 *   "durable_objects": {
 *     "bindings": [{ "name": "ARTICLE_SCHEDULER", "class_name": "ArticleScheduler" }]
 *   },
 *   "migrations": [{ "tag": "v1", "new_classes": ["ArticleScheduler"] }]
 * }
 * ```
 */
export class ArticleScheduler {
  private ctx: any
  private env: any

  constructor(state: any, env: any) {
    this.ctx = state
    this.env = env
  }

  /** alarm 处理函数 — Cloudflare DO alarm 触发时调用 */
  async alarm() {
    console.log(`[scheduler] alarm 触发: ${new Date().toISOString()}`)

    try {
      const db = this.env.DB
      const pipelineDB = createPipelineDB(db)
      // 配置从 this.config 读，不硬编码
      const cfg = (this as any)._config || {}
      const result = await execute(pipelineDB, cfg.executorConfig || {})

      console.log(`[scheduler] 执行完成:`, result)
    } catch (e: any) {
      console.error(`[scheduler] 执行失败:`, e.message)
    }

    // 设置下一天的 alarm
    await this.scheduleNext()
  }

  /** 启动调度器 — 设置第一次 alarm */
  async start(config: SchedulerConfig = {}) {
    ;(this as any)._config = config
    const existing = await this.ctx.storage.getAlarm()
    if (existing) {
      console.log(`[scheduler] alarm 已存在: ${new Date(existing).toISOString()}`)
      return { scheduled: new Date(existing).toISOString() }
    }

    const next = this.getNextAlarmTime(config.time || '08:00')
    await this.ctx.storage.setAlarm(next)
    console.log(`[scheduler] 首次 alarm 设置: ${new Date(next).toISOString()}`)

    return { scheduled: new Date(next).toISOString() }
  }

  /** 获取 alarm 状态 */
  async getStatus() {
    const alarm = await this.ctx.storage.getAlarm()
    return {
      hasAlarm: !!alarm,
      nextAlarm: alarm ? new Date(alarm).toISOString() : null,
    }
  }

  /** 设置下一天的 alarm */
  private async scheduleNext(time?: string) {
    const next = this.getNextAlarmTime(time || '08:00')
    await this.ctx.storage.setAlarm(next)
    console.log(`[scheduler] 下次 alarm: ${new Date(next).toISOString()}`)
  }

  /** 计算下一次 alarm 时间（固定时间，每天触发，UTC+8 中国时区） */
  private getNextAlarmTime(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number)
    // Workers 是 UTC，先 +8 偏移到中国时间再算
    const now = new Date(Date.now() + 8 * 3600 * 1000)
    const target = new Date(now)
    target.setUTCHours(hours, minutes, 0, 0)
    if (target <= now) {
      target.setUTCDate(target.getUTCDate() + 1)
    }
    // 减回 8 偏移，得到真实 UTC 时间戳
    return target.getTime() - 8 * 3600 * 1000
  }
}

/** 创建 PipelineDB 适配器（供 DO 内部使用） */
function createPipelineDB(db: any) {
  return {
    async fetchPendingSeeds(size: number) {
      return db.select().from(seeds)
        .where(eq(seeds.status, 'pending'))
        .orderBy(desc(seeds.id))
        .limit(size)
    },

    async insertSeeds(items: Array<{ raw: string; category?: string; template?: string }>, source: string) {
      const now = new Date().toISOString()
      const rows = items
        .filter(it => it.raw?.length >= 8)
        .map(it => ({
          raw: it.raw,
          category: it.category || '优惠',
          template: it.template || 'deal',
          status: 'pending' as const,
          source,
          createdAt: now,
          updatedAt: now,
        }))

      if (!rows.length) return { added: 0 }
      await db.insert(seeds).values(rows)
      return { added: rows.length }
    },

    async markSeedDone(id: number, articleId: string) {
      await db.update(seeds).set({
        status: 'done',
        articleId,
        error: null,
        updatedAt: new Date().toISOString(),
      }).where(eq(seeds.id, id))
    },

    async markSeedFailed(id: number, error: string) {
      await db.update(seeds).set({
        status: 'failed',
        error: String(error).slice(0, 500),
        updatedAt: new Date().toISOString(),
      }).where(eq(seeds.id, id))
    },

    async insertArticles(articlesList: any[]) {
      const results: Array<{ id: string; ok: boolean; error?: string }> = []
      const now = new Date().toISOString()
      const rows = articlesList.map((a) => ({
        id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: a.title,
        summary: a.summary || '',
        content: typeof a.content === 'string' ? a.content : JSON.stringify(a.content || []),
        firstImage: firstImageOf(typeof a.content === 'string' ? [] : (a.content || [])),
        template: a.template || 'default',
        category: a.category || '',
        tags: typeof a.tags === 'string' ? a.tags : JSON.stringify(a.tags || []),
        status: a.status || 'published',
        publishAt: a.publishAt || null,
        expiresAt: a.expiresAt || null,
        links: typeof a.links === 'string' ? a.links : JSON.stringify(a.links || []),
        friendLinks: typeof a.friendLinks === 'string' ? a.friendLinks : JSON.stringify(a.friendLinks || []),
        relatedIds: typeof a.relatedIds === 'string' ? a.relatedIds : JSON.stringify(a.relatedIds || []),
        faq: typeof a.faq === 'string' ? a.faq : JSON.stringify(a.faq || []),
        createdAt: now,
        updatedAt: now,
      }))
      try {
        await db.insert(articles).values(rows)
        for (const r of rows) results.push({ id: r.id, ok: true })
      } catch (e: any) {
        for (const r of rows) results.push({ id: r.id, ok: false, error: e.message })
      }
      return {
        total: articlesList.length,
        created: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length,
        results,
      }
    },

    async insertRunLog(log: { runAt?: string; model?: string; total?: number; ok?: number; fail?: number; error?: string | null; dryRun?: boolean }) {
      await db.insert(runLogs).values({
        runAt: log.runAt || new Date().toISOString(),
        model: log.model || '',
        total: log.total || 0,
        ok: log.ok || 0,
        fail: log.fail || 0,
        error: log.error || null,
        dryRun: log.dryRun ? 1 : 0,
        createdAt: new Date().toISOString(),
      })
    },
  }
}

/**
 * 启动调度器 — 在 Worker fetch handler 中调用
 *
 * @example
 * ```ts
 * import { startScheduler } from 'ai-article-pipeline'
 *
 * export default {
 *   async fetch(request, env) {
 *     const scheduler = startScheduler(env, { time: '08:00' })
 *     await scheduler.start()
 *     return new Response('Scheduler started')
 *   }
 * }
 * ```
 */
export function startScheduler(env: any, config: SchedulerConfig = {}) {
  const id = env.ARTICLE_SCHEDULER.idFromName('global')
  const stub = env.ARTICLE_SCHEDULER.get(id)
  return {
    start: () => stub.start(config),
    getStatus: () => stub.getStatus(),
  }
}
