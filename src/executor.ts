// ============================================================
// 执行器 — 完整的每日生成流程编排
// 从 article-site/scripts/scheduled-generate.mjs + server/utils/daily-generate.ts 提取
// ============================================================

import type { PipelineConfig, PipelineRunResult, RunLogInput } from './types.js'
import { createPipeline, type PipelineDB } from './pipeline.js'

// —— 执行器配置 ——

export interface ExecutorConfig extends PipelineConfig {
  /** 每日目标发布篇数（默认 3） */
  dailyTarget?: number
  /** 本地 AI 网关地址（默认 http://localhost:3456/v1） */
  localGateway?: string
  /** 本地 AI 模型名称（默认 deepseek-chat） */
  localModel?: string
  /** 云端 AI 模型（本地网关离线时兜底） */
  cloudModel?: string
  /** dry-run 模式：只生成不入库 */
  dryRun?: boolean
  /** 今日已发布篇数查询函数 */
  getPublishedToday?: () => Promise<number>
  /** 今日是否已有本地成功运行记录（防重复发布） */
  hasLocalRunToday?: () => Promise<boolean>
  /** 运行日志上报函数 */
  reportRun?: (log: RunLogInput) => Promise<void>
}

export interface ExecutorResult {
  mode: 'local' | 'cloud' | 'skipped'
  reason?: string
  pipeline?: PipelineRunResult
}

// —— 本地 AI 网关客户端（带慢启动重试）——

function createLocalGatewayClient(config: {
  gateway: string
  model: string
}) {
  return async (messages: Array<{ role: string; content: string }>): Promise<string> => {
    const delays = [15_000, 30_000]
    let lastErr: Error | undefined
    for (let i = 0; i < 3; i++) {
      if (i > 0) {
        console.log(new Date().toISOString(), '[executor]', `网关第 ${i + 1} 次重试（等 ${delays[i - 1] / 1000}s）`)
        await new Promise((r) => setTimeout(r, delays[i - 1]))
      }
      try {
        const res = await fetch(`${config.gateway}/chat/completions`, {
          method: 'POST',
          signal: AbortSignal.timeout(180_000),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: config.model,
            messages,
            stream: false,
          }),
        })
        if (!res.ok) throw new Error(`AI 网关 HTTP ${res.status}`)
        const data: any = await res.json()
        return data?.choices?.[0]?.message?.content ?? ''
      } catch (e: any) {
        lastErr = e
        console.log(new Date().toISOString(), '[executor]', `网关第 ${i + 1} 次失败: ${e.message}`)
      }
    }
    throw lastErr || new Error('AI 网关调用失败')
  }
}

// —— 检查本地网关是否在线 ——

async function isLocalGatewayOnline(gateway: string): Promise<boolean> {
  try {
    const res = await fetch(`${gateway}/models`, { signal: AbortSignal.timeout(10_000) })
    return res.ok
  } catch {
    return false
  }
}

// —— 执行器 ——

export async function execute(db: PipelineDB, config: ExecutorConfig = {}): Promise<ExecutorResult> {
  const dailyTarget = config.dailyTarget ?? 3
  const localGateway = config.localGateway ?? 'http://localhost:3456/v1'
  const localModel = config.localModel ?? 'deepseek-chat'
  const dryRun = config.dryRun ?? false
  const log = (...args: unknown[]) => console.log(new Date().toISOString(), '[executor]', ...args)

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
  const localOnline = config.ai?.client
    ? false
    : await isLocalGatewayOnline(localGateway)

  if (!localOnline) {
    if (dryRun) {
      log('本地 AI 网关离线，dry-run 不转云端')
      return { mode: 'skipped', reason: '本地网关离线，dry-run 模式' }
    }
    if (config.ai?.client) {
      log('已配置云端 AI client，直接走云端')
    } else {
      log('本地 AI 网关离线，尝试云端兜底')
    }
    if (!config.ai?.client && !config.ai?.apiKey) {
      return { mode: 'skipped', reason: '本地网关离线且未配置云端 AI' }
    }
  }

  // 4. 创建管线
  const pipelineConfig: PipelineConfig = {
    ...config,
    target: dailyTarget,
  }

  if (localOnline) {
    log(`使用本地网关 ${localGateway}，模型 ${localModel}`)
    pipelineConfig.ai = {
      ...pipelineConfig.ai,
      client: createLocalGatewayClient({ gateway: localGateway, model: localModel }),
      model: localModel,
    }
  } else {
    log(`使用云端 AI，模型 ${config.cloudModel || config.ai?.model || 'default'}`)
    pipelineConfig.ai = {
      ...pipelineConfig.ai,
      model: config.cloudModel || config.ai?.model,
    }
  }

  const pipeline = createPipeline(db, pipelineConfig)

  // 5. 运行管线
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
