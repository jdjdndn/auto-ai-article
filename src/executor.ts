// ============================================================
// 执行器 — 完整的每日生成流程编排
// 从 article-site/scripts/scheduled-generate.mjs + server/utils/daily-generate.ts 提取
// 本地网关健康探测兼容 token-free-gateway（/health）与普通 OpenAI 兼容网关（/models 回退）
// ============================================================

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PipelineConfig, PipelineRunResult, RunLogInput } from './types.js'
import { createPipeline, withRetry, type PipelineDB } from './pipeline.js'

// —— 执行器配置 ——

export interface ExecutorConfig extends PipelineConfig {
  /** 每日目标发布篇数（默认 3） */
  dailyTarget?: number
  /** 本地 AI 网关地址（默认 http://localhost:3456/v1） */
  localGateway?: string
  /** 本地 AI 模型名称（默认 deepseek-chat） */
  localModel?: string
  /**
   * 本地候选模型（按优先级轮换；缺省仅用 localModel，行为不变）。
   * 网关某个模型/会话不可用（网络错误/HTTP 4xx/5xx）时自动尝试下一个。
   * 示例：['deepseek-chat', 'deepseek-reasoner', 'kimi']
   */
  localModels?: string[]
  /** 云端 AI 模型（本地网关离线时兜底） */
  cloudModel?: string
  /**
   * 本地发文互斥锁文件（跨进程/跨站共享；多站同机用本地网关时串行化，避免并发打网关）。
   * 各站配置**同一路径**即可全局互斥：后到站等待 localLockWaitMs，超时则本轮跳过（由各站云端 alarm 兜底）。
   * 缺省不启用，行为不变。
   */
  localLockFile?: string
  /** 等待互斥锁的最长时间（毫秒，默认 180000；0 = 不等待直接跳过） */
  localLockWaitMs?: number
  /** 互斥锁视为过期的最长时间（毫秒，默认 1800000=30min，防异常退出残留锁） */
  localLockStaleMs?: number
  /** 本地 AI 单次请求超时（毫秒，默认 280000，对齐 TFG requestTimeoutSec=300 减余量） */
  localTimeoutMs?: number
  /** 本地网关离线时的自愈拉起命令（如 auto-start.ps1；空则不拉起） */
  localGatewayStartCommand?: string
  /** 网关 degraded（browser disconnected）时拉起浏览器命令（如 `chrome start`；空则只提示） */
  localChromeStartCommand?: string
  /** 执行拉起命令后的等待/重探测时间（毫秒，默认 45000） */
  autoStartWaitMs?: number
  /**
   * 本地离线且未配置云端 AI key 时的整轮兜底钩子（如调线上 /api/admin/run-daily-generate）。
   * 返回后视为已处理，不再本地生成，也**不**再本地上报 run-logs（由兜底实现方负责）。
   * 缺省时保持原 skip 行为。
   */
  cloudFallback?: (ctx: { localGateway: string; dryRun: boolean }) => Promise<{ ok: boolean; message?: string } | void>
  /** dry-run 模式：只生成不入库 */
  dryRun?: boolean
  /** 今日已发布篇数查询函数 */
  getPublishedToday?: () => Promise<number>
  /** 今日是否已有本地成功运行记录（防重复发布） */
  hasLocalRunToday?: () => Promise<boolean>
  /** 运行日志上报函数 */
  reportRun?: (log: RunLogInput) => Promise<void>
  /** 自定义 logger（默认 console.log） */
  logger?: (...args: unknown[]) => void
}

export interface ExecutorResult {
  mode: 'local' | 'cloud' | 'cloud-fallback' | 'skipped'
  reason?: string
  pipeline?: PipelineRunResult
}

// —— 工具 ——

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 执行自愈命令（shell 模式，最多等 30s；命令自身不应阻塞，如内部用 Start-Process） */
async function runCommand(command: string, log: (...args: unknown[]) => void): Promise<void> {
  return new Promise((resolve) => {
    log(`执行自愈命令: ${command}`)
    let child: ReturnType<typeof spawn> | null = null
    try {
      child = spawn(command, { shell: true, windowsHide: true, stdio: 'ignore' })
    } catch (e: any) {
      log(`自愈命令启动失败: ${e.message}`)
      resolve()
      return
    }
    const timer = setTimeout(() => {
      try { child?.kill() } catch { /* noop */ }
      resolve()
    }, 30_000)
    child.on('exit', () => { clearTimeout(timer); resolve() })
    child.on('error', () => { clearTimeout(timer); resolve() })
  })
}

// —— 本地 AI 网关客户端（复用公共 withRetry：慢启动重试 + 可配超时 + 模型轮换）——

function createLocalGatewayClient(config: {
  gateway: string
  models: string[]
  timeoutMs: number
  logger?: (...args: unknown[]) => void
}) {
  const log = config.logger || ((...args: unknown[]) => console.log(new Date().toISOString(), '[executor]', ...args))
  const models = config.models.length ? config.models : ['deepseek-chat']
  return async (messages: Array<{ role: string; content: string }>): Promise<string> => {
    return withRetry(
      async (attempt) => {
        // 每轮尝试换下一个模型：单模型时行为不变（同模型 3 次重试），多模型时 A→B→C 轮换
        const model = models[attempt % models.length]
        try {
          const res = await fetch(`${config.gateway}/chat/completions`, {
            method: 'POST',
            signal: AbortSignal.timeout(config.timeoutMs),
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              messages,
              stream: false,
            }),
          })
          if (!res.ok) throw new Error(`AI 网关 HTTP ${res.status}`)
          const data: any = await res.json()
          const content = data?.choices?.[0]?.message?.content ?? ''
          if (!content.trim()) throw new Error('AI 网关没有返回内容')
          return content
        } catch (e: any) {
          log(`网关第 ${attempt + 1} 次失败（模型 ${model}）: ${e.message}`)
          throw e
        }
      },
      2,
      '网关',
      undefined,
      [15_000, 30_000],
    )
  }
}

// —— 跨进程/跨站互斥锁（原子 mkdir；带 owner.json 过期检测）——
// 多站同机共用本地网关时，配置同一 localLockFile 即可全局串行化本地发文。

async function acquireLock(file: string, waitMs: number, staleMs: number, log: (...args: unknown[]) => void): Promise<boolean> {
  const deadline = Date.now() + waitMs
  for (;;) {
    try {
      mkdirSync(file)
    } catch {
      // 锁已存在：检查是否过期（owner.ts 超时则强占，即使 waitMs=0）
      let owner: { pid?: number; ts?: number } | null = null
      try {
        const raw = readFileSync(join(file, 'owner.json'), 'utf-8').replace(/^\uFEFF/, '') // 容忍 BOM
        owner = JSON.parse(raw)
      } catch { /* owner.json 缺失/损坏：不接管 */ }
      if (owner && typeof owner.ts === 'number' && Date.now() - owner.ts > staleMs) {
        log(`互斥锁已过期（${Math.round((Date.now() - owner.ts) / 1000)}s），强制接管`)
        rmSync(file, { recursive: true, force: true })
        continue // 回到循环顶部重新 mkdir（for 循环的 continue 不跳过条件检查）
      }
      if (Date.now() >= deadline) return false
      log(`本地网关正被其他站点占用，等待互斥锁（剩 ${Math.max(0, Math.round((deadline - Date.now()) / 1000))}s）`)
      await sleep(5_000)
      continue
    }
    try {
      writeFileSync(join(file, 'owner.json'), JSON.stringify({ pid: process.pid, ts: Date.now() }))
    } catch { /* noop */ }
    return true
  }
}

function releaseLock(file: string): void {
  try { rmSync(file, { recursive: true, force: true }) } catch { /* noop */ }
}

// —— 本地网关探测 ——

export interface LocalGatewayProbe {
  /** 网关可用（可发 AI 请求） */
  online: boolean
  /** token-free-gateway degraded（status:"degraded"，browser disconnected） */
  degraded: boolean
  /** 会话过期（status:"session_expired"）或 /v1/models 返回空列表（未授权） */
  sessionExpired: boolean
  /** 可用模型列表（可能为空） */
  models: string[]
}

async function fetchJson(url: string, timeoutMs: number): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function listLocalModels(gateway: string, timeoutMs: number): Promise<string[]> {
  const data = await fetchJson(`${gateway}/models`, timeoutMs)
  const arr = Array.isArray(data?.data) ? data.data : null
  if (!arr) return []
  return arr
    .map((m: any) => String(m?.id || '').trim())
    .filter(Boolean)
}

/**
 * 探测本地网关。
 * TFG 语义（src/server.ts /health）：status 'ok'|'degraded'|'session_expired'，browser 'connected'|'disconnected'。
 * - ok + connected → 在线
 * - degraded（browser disconnected）→ 不可发请求，需拉起 Chrome
 * - session_expired → 需重新 webauth
 * 非 TFG 网关没有 /health → 回退老逻辑 /v1/models（200 且有模型即在线）
 */
async function probeLocalGateway(gateway: string, timeoutMs = 10_000): Promise<LocalGatewayProbe> {
  const health = await fetchJson(`${gateway}/health`, timeoutMs)
  if (health && typeof health === 'object') {
    const status = String(health?.status || '')
    const models = await listLocalModels(gateway, timeoutMs)
    if (status === 'ok') {
      const browser = String(health?.browser || '')
      if (browser === 'connected') {
        return { online: true, degraded: false, sessionExpired: false, models }
      }
      // status ok 但浏览器未连接：浏览器会话不可用，按 degraded 处理
      return { online: false, degraded: true, sessionExpired: false, models }
    }
    if (status === 'degraded') {
      return { online: false, degraded: true, sessionExpired: false, models }
    }
    if (status === 'session_expired') {
      return { online: false, degraded: false, sessionExpired: true, models }
    }
    // 其它 status：以 /models 为准
  }
  const models = await listLocalModels(gateway, timeoutMs)
  return { online: models.length > 0, degraded: false, sessionExpired: models.length === 0, models }
}

// —— 执行器 ——

export async function execute(db: PipelineDB, config: ExecutorConfig = {}): Promise<ExecutorResult> {
  const dailyTarget = config.dailyTarget ?? 3
  const localGateway = config.localGateway ?? 'http://localhost:3456/v1'
  const localModel = config.localModel ?? 'deepseek-chat'
  const localTimeoutMs = config.localTimeoutMs ?? 280_000
  const autoStartWaitMs = config.autoStartWaitMs ?? 45_000
  const dryRun = config.dryRun ?? false
  const log = config.logger || ((...args: unknown[]) => console.log(new Date().toISOString(), '[executor]', ...args))

  // 1. 检查今日配额
  if (config.getPublishedToday) {
    const done = await config.getPublishedToday()
    if (done >= dailyTarget) {
      log(`当天已发布 ${done}/${dailyTarget} 篇，跳过`)
      return { mode: 'skipped', reason: `当天已发布 ${done} 篇` }
    }
    log(`当天已发布 ${done}/${dailyTarget} 篇，继续`)
  }

  // 2. 防重复发布：今天已有本地成功记录 → 信任本地，跳过
  if (config.hasLocalRunToday) {
    const hasLocal = await config.hasLocalRunToday()
    if (hasLocal) {
      log('今天已有本地流水线成功记录，跳过')
      return { mode: 'skipped', reason: '今天已有本地成功记录' }
    }
  }

  // 3. 检查本地网关（已提供云端 client 时跳过，Workers/线上环境无本地网关）
  let probe: LocalGatewayProbe | null = config.ai?.client
    ? null
    : await probeLocalGateway(localGateway)
  let localOnline = probe ? probe.online : false

  // 3.1 自愈：离线/degraded → 拉起（网关或浏览器）→ 等待 → 重探测一次
  if (probe && !localOnline) {
    if (probe.degraded) {
      log('本地网关 degraded（浏览器未连接），尝试拉起浏览器')
      if (config.localChromeStartCommand) {
        await runCommand(config.localChromeStartCommand, log)
        await sleep(autoStartWaitMs)
      } else {
        log('未配置 localChromeStartCommand，跳过浏览器拉起')
      }
    } else {
      log('本地 AI 网关离线，尝试自愈拉起')
      if (config.localGatewayStartCommand) {
        await runCommand(config.localGatewayStartCommand, log)
        await sleep(autoStartWaitMs)
      } else {
        log('未配置 localGatewayStartCommand，跳过拉起')
      }
    }
    probe = await probeLocalGateway(localGateway)
    localOnline = probe.online
  }

  if (probe && !localOnline) {
    if (probe.sessionExpired) {
      log('本地网关会话过期或 /v1/models 未授权，请运行网关 webauth 重新登录')
    }
    if (dryRun) {
      log('本地 AI 网关离线，dry-run 不转云端')
      return { mode: 'skipped', reason: '本地网关离线，dry-run 模式' }
    }
    if (!config.ai?.client && !config.ai?.apiKey) {
      if (config.cloudFallback) {
        log('本地网关离线且未配置云端 AI key，调用 cloudFallback 整轮兜底')
        try {
          const fb = await config.cloudFallback({ localGateway, dryRun })
          const message = fb?.message || (fb?.ok === false ? 'cloudFallback 未成功' : '云端兜底已执行')
          return { mode: 'cloud-fallback', reason: message }
        } catch (e: any) {
          log(`cloudFallback 失败: ${e.message}`)
          return { mode: 'skipped', reason: `cloudFallback 失败: ${e.message}` }
        }
      }
      return { mode: 'skipped', reason: '本地网关离线且未配置云端 AI' }
    }
    log(config.ai?.client ? '已配置云端 AI client，直接走云端' : '本地 AI 网关离线，尝试云端兜底')
  }

  // 4. 创建管线
  const pipelineConfig: PipelineConfig = {
    ...config,
    target: dailyTarget,
  }

  if (localOnline) {
    // 模型发现：localModel 不在网关模型列表时自动选第一个可用模型；
    // 显式配置 localModels 时优先使用（按优先级轮换，缺失本地模型不可用时自动切换）
    const models = probe?.models ?? []
    let model = localModel
    if (models.length && !models.includes(localModel)) {
      model = models[0]
      log(`本地模型 ${localModel} 不在网关模型列表，自动使用 ${model}`)
    }
    const localModels = config.localModels?.length ? config.localModels : [model]
    log(`使用本地网关 ${localGateway}，模型候选 ${localModels.join(' -> ')}`)
    pipelineConfig.ai = {
      ...pipelineConfig.ai,
      client: createLocalGatewayClient({ gateway: localGateway, models: localModels, timeoutMs: localTimeoutMs, logger: log }),
      model: localModels[0],
    }
  } else {
    log(`使用云端 AI，模型 ${config.cloudModel || config.ai?.model || 'default'}`)
    pipelineConfig.ai = {
      ...pipelineConfig.ai,
      model: config.cloudModel || config.ai?.model,
    }
  }

  const pipeline = createPipeline(db, pipelineConfig)

  // 5. 运行管线（本地分支先拿跨站互斥锁，避免多站并发打同一网关）
  try {
    const lockFile = localOnline ? config.localLockFile : undefined
    if (lockFile) {
      const got = await acquireLock(
        lockFile,
        config.localLockWaitMs ?? 180_000,
        config.localLockStaleMs ?? 1_800_000,
        log,
      )
      if (!got) {
        log(`本地网关正被其他站点占用（锁 ${lockFile}），本轮跳过，由云端兜底`)
        return { mode: 'skipped', reason: `本地网关正被其他站点占用（${lockFile}）` }
      }
    }
    try {
      const result = await pipeline.run()
      log(`完成：成功 ${result.ok}，失败 ${result.fail}`)

      // 6. 上报运行日志
      if (config.reportRun) {
        try {
          await config.reportRun({
            runAt: new Date().toISOString(),
            model: pipelineConfig.ai?.model || 'default',
            total: result.total,
            ok: result.ok,
            fail: result.fail,
            error: result.errors.length ? result.errors.join('; ').slice(0, 300) : null,
            dryRun,
          })
        } catch { /* 日志失败不阻塞 */ }
      }

      return { mode: localOnline ? 'local' : 'cloud', pipeline: result }
    } finally {
      if (lockFile) releaseLock(lockFile)
    }
  } catch (e: any) {
    log('执行失败:', e.message)
    if (config.reportRun) {
      try {
        await config.reportRun({
          runAt: new Date().toISOString(),
          model: pipelineConfig.ai?.model || 'default',
          total: 0,
          ok: 0,
          fail: 1,
          error: e.message?.slice(0, 300),
          dryRun,
        })
      } catch { /* noop */ }
    }
    throw e
  }
}
