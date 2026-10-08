// ============================================================
// 统一调度入口 — 本地发文 / 线上发文 / 线上兜底（触发式）一体封装
//
// 把各站脚本里重复实现的线上 API adapter、防重、日志上报、云端兜底收编进库：
//   - 线上 API 的 PipelineDB adapter（dry-run 副作用落内存）
//   - getPublishedToday 防重（北京时间当天已发布数）
//   - reportRun 运行日志（失败不阻塞）
//   - cloudFallback 触发式兜底：只触发线上 /api/admin/run-daily-generate，
//     短超时不等云端跑完（云端侧 waitUntil 异步执行 + 幂等防重，结果见 run-logs）
//
// 各站接入只需：runScheduledGenerate({ site, adminBase, adminKeyFile, ... })
// ============================================================

import { readFileSync } from 'node:fs'
import { execute, type ExecutorConfig } from './executor.js'
import type { PipelineDB } from './pipeline.js'
import type { RunLogInput } from './types.js'
import { cnTodayStartISO } from './utils.js'

export interface SiteRunnerConfig
  extends Omit<ExecutorConfig, 'cloudFallback' | 'getPublishedToday' | 'reportRun' | 'publishDueDrafts'> {
  /** 站点标识（日志前缀） */
  site: string
  /** 线上站点 API 基址（如 https://www.wcbblll.cc） */
  adminBase: string
  /** admin 密钥文件路径（内容为 MANAGE_KEY=xxx，自动剥前缀） */
  adminKeyFile?: string
  /** 或直接传 admin 密钥明文（优先于 adminKeyFile） */
  adminKey?: string
  /** 每天目标篇数（默认 3，与 executor 一致） */
  dailyTarget?: number
  /** 云端兜底 API 路径（默认 /api/admin/run-daily-generate） */
  cloudEndpoint?: string
  /** 云端兜底触发超时（毫秒，默认 15000：只触发不等结果，云端幂等防重） */
  cloudTriggerTimeoutMs?: number
  /** 普通 API 请求超时（毫秒，默认 60000） */
  apiTimeoutMs?: number
  /**
   * 优先发草稿：生成前先发布到期草稿（默认调线上 POST /api/admin/publish-due）。
   * false = 关闭；函数 = 自定义实现。发布数计入当日已发布口径，剩余目标由生成补足。
   */
  publishDueDrafts?: false | (() => Promise<number>)
  /** 到期草稿发布 API 路径（默认 /api/admin/publish-due） */
  publishDueEndpoint?: string
}

export type SiteRunnerResult = Awaited<ReturnType<typeof execute>>

/**
 * 统一每日发文入口：本地 AI 发文（网关自愈/模型轮换/互斥锁）→ 网关离线走云端 AI →
 * 未配云端 key 走线上兜底（触发式）。防重与日志统一内置。
 */
export async function runScheduledGenerate(cfg: SiteRunnerConfig): Promise<SiteRunnerResult> {
  const {
    site,
    adminBase,
    dailyTarget = 3,
    cloudEndpoint = '/api/admin/run-daily-generate',
    cloudTriggerTimeoutMs = 15_000,
    apiTimeoutMs = 60_000,
    adminKeyFile,
    adminKey,
    dryRun = false,
    logger,
    publishDueDrafts,
    publishDueEndpoint = '/api/admin/publish-due',
    ...rest
  } = cfg

  const log = logger || ((...a: unknown[]) => console.log(new Date().toISOString(), `[${site}]`, ...a))
  const key =
    adminKey ||
    (adminKeyFile
      ? readFileSync(adminKeyFile, 'utf-8')
          .trim()
          .replace(/^MANAGE_KEY=/, '')
      : '')
  if (!key) throw new Error(`[${site}] 未配置 adminKey/adminKeyFile`)

  async function apiFetch(pathname: string, opts: RequestInit = {}, timeoutMs: number = apiTimeoutMs): Promise<any> {
    const res = await fetch(`${adminBase}${pathname}`, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`API HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`)
    return data
  }

  // —— 线上 API 的 PipelineDB adapter（dry-run 时副作用落内存，不入库不标记） ——
  const memSeeds: any[] = []
  const db: PipelineDB = {
    async fetchPendingSeeds(size) {
      if (dryRun && memSeeds.length) return memSeeds.slice(0, size)
      const { list } = await apiFetch(`/api/admin/seeds?status=pending&size=${size}`)
      return list || []
    },
    async insertSeeds(items, source) {
      if (dryRun) {
        let id = -1
        const now = new Date().toISOString()
        for (const it of items) {
          memSeeds.push({
            id: id--,
            raw: it.raw,
            category: it.category || 'auto',
            template: it.template || 'auto',
            status: 'pending',
            publishAt: it.publishAt || null,
            expiresAt: it.expiresAt || null,
            articleId: null,
            error: null,
            source,
            fp: '',
            createdAt: now,
            updatedAt: now,
          })
        }
        return { added: items.length }
      }
      const r = await apiFetch('/api/admin/seeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, source }),
      })
      return { added: r?.added || 0 }
    },
    async markSeedDone(id, articleId) {
      if (dryRun) return
      await apiFetch(`/api/admin/seeds/${id}/done`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId: articleId || null }),
      }).catch((e) => log('标记素材完成失败:', (e as Error)?.message || e))
    },
    async markSeedFailed(id, error) {
      if (dryRun) return
      await apiFetch(`/api/admin/seeds/${id}/fail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: String(error || '未知错误') }),
      }).catch((e) => log('标记素材失败失败:', (e as Error)?.message || e))
    },
    async insertArticles(articles) {
      if (dryRun) {
        return {
          total: articles.length,
          created: articles.length,
          failed: 0,
          results: articles.map((a, i) => ({ id: `dry-run-${i}`, ok: true })),
        }
      }
      const r = await apiFetch('/api/admin/articles/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articles }),
      })
      return { total: r.total, created: r.created, failed: r.failed, results: r.results || [] }
    },
    // 运行日志由 execute() 的 reportRun 统一上报（带 dryRun 字段）；此处 no-op 避免重复
    async insertRunLog() {},
  }

  // —— 今日已发布篇数（防重口径：北京时间今日发布总数，含定时发布的草稿；API 按 updatedAt 过滤） ——
  async function getPublishedToday(): Promise<number> {
    const from = cnTodayStartISO()
    const r = await apiFetch(`/api/admin/articles?status=published&from=${encodeURIComponent(from)}&limit=100`)
    return (r.list || []).length
  }

  // —— 优先发草稿：生成前发布到期草稿（默认调线上 publish-due API；false 关闭；函数自定义） ——
  async function publishDueDraftsDefault(): Promise<number> {
    const r = await apiFetch(publishDueEndpoint, { method: 'POST' })
    return r?.published || 0
  }
  const publishDue = publishDueDrafts === false ? undefined : publishDueDrafts || publishDueDraftsDefault

  // —— 运行日志上报（失败不阻塞流水线） ——
  async function reportRun(payload: RunLogInput): Promise<void> {
    try {
      await apiFetch('/api/admin/run-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch (e) {
      log('[warn] 运行日志上报失败：', (e as Error).message)
    }
  }

  // —— 云端兜底：触发式（只触发不等云端完成；云端 waitUntil 异步执行 + 幂等防重；结果见 run-logs） ——
  async function cloudFallback(): Promise<{ ok: boolean; message: string }> {
    log('本地 AI 网关离线，转云端兜底（触发式：只触发不等云端完成，结果见 run-logs）')
    try {
      const r = await apiFetch(cloudEndpoint, {}, cloudTriggerTimeoutMs)
      const brief = JSON.stringify(r).slice(0, 140)
      log('[cloud] 云端兜底已触发，响应：', brief)
      return { ok: true, message: `云端兜底已触发（${cloudEndpoint}），异步执行结果见 run-logs；响应 ${brief}` }
    } catch (e) {
      const msg = (e as Error).message
      log('[cloud] 云端兜底触发失败：', msg)
      return { ok: false, message: `云端兜底触发失败：${msg.slice(0, 120)}` }
    }
  }

  return execute(db, {
    ...rest,
    dailyTarget,
    dryRun,
    publishDueDrafts: publishDue,
    getPublishedToday,
    reportRun,
    cloudFallback,
    logger: log,
  })
}
