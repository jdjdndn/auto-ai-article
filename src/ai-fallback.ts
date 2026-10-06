// ============================================================
// AI 模型降级库 — Cloudflare Workers AI 免费模型故障自动切换
// 独立封装，不修改其他项目代码
// ============================================================

import type { AiClient, AiMessage } from './types.js'

// —— 模型定义 ——

export interface AiModel {
  /** 模型 ID（Cloudflare Workers AI） */
  id: string
  /** 供应商 */
  provider: string
  /** 优先级（数字越小越优先） */
  priority: number
  /** 说明 */
  description: string
  /** 是否适合中文长文 */
  chineseOptimized: boolean
}

// —— 免费模型清单（按优先级排序）——
// 来源：Cloudflare Workers AI 官方文档（2026-10）
// 免费额度：每个模型每日 10,000 neurons

export const FREE_TEXT_MODELS: AiModel[] = [
  // —— 中文优化模型（优先）——
  { id: '@cf/qwen/qwen3.8-27b', provider: 'Alibaba/Qwen', priority: 1, description: 'Qwen 3.8，中文能力最强', chineseOptimized: true },
  { id: '@cf/zai-org/glm-5.3', provider: 'Zhipu AI', priority: 2, description: '智谱 GLM 5.3，中文优秀', chineseOptimized: true },
  { id: '@cf/deepseek-ai/deepseek-v4-pro-0813', provider: 'DeepSeek', priority: 3, description: 'DeepSeek V4 专业版', chineseOptimized: true },
  { id: '@cf/moonshotai/kimi-k2.6', provider: 'Moonshot AI', priority: 4, description: 'Moonshot Kimi K2.6', chineseOptimized: true },
  { id: '@cf/qwen/qwen3-30b-a3b-fp8', provider: 'Alibaba/Qwen', priority: 5, description: 'Qwen 3 MoE 架构', chineseOptimized: true },
  { id: '@cf/zai-org/glm-5.2', provider: 'Zhipu AI', priority: 6, description: '智谱 GLM 5.2', chineseOptimized: true },
  { id: '@cf/deepseek-ai/deepseek-v4-flash-0731', provider: 'DeepSeek', priority: 7, description: 'DeepSeek V4 快速版', chineseOptimized: true },
  { id: '@cf/moonshotai/kimi-k2.7-code', provider: 'Moonshot AI', priority: 8, description: 'Kimi K2.7 代码增强版', chineseOptimized: true },
  { id: '@cf/zai-org/glm-5.3-flash', provider: 'Zhipu AI', priority: 9, description: '智谱 GLM 5.3 快速版', chineseOptimized: true },
  { id: '@cf/qwen/qwen2.5-coder-32b-instruct', provider: 'Alibaba/Qwen', priority: 10, description: 'Qwen 2.5 Coder 32B', chineseOptimized: true },

  // —— 通用模型（备选）——
  { id: '@cf/meta/llama-4-scout-17b-16e-instruct', provider: 'Meta', priority: 11, description: 'Meta Llama 4 Scout', chineseOptimized: false },
  { id: '@cf/openai/gpt-oss-120b', provider: 'OpenAI', priority: 12, description: 'OpenAI 开源 120B', chineseOptimized: false },
  { id: '@cf/zai-org/glm-4.7-flash', provider: 'Zhipu AI', priority: 13, description: '智谱 GLM 4.7 快速版', chineseOptimized: true },
  { id: '@cf/mistralai/mistral-small-3.1-24b-instruct', provider: 'Mistral AI', priority: 14, description: 'Mistral Small 3.1', chineseOptimized: false },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', provider: 'Meta', priority: 15, description: 'Meta Llama 3.3 70B', chineseOptimized: false },
]

// —— 故障类型 ——

export type FallbackReason =
  | 'quota_exceeded'      // 额度不足
  | 'timeout'             // 超时
  | 'rate_limit'          // 限流
  | 'server_error'        // 服务端错误
  | 'invalid_request'     // 请求无效
  | 'unknown'             // 未知错误

// —— 降级配置 ——

export interface FallbackConfig {
  /** Cloudflare Workers AI API 地址（默认 https://api.cloudflare.com/client/v4） */
  baseUrl?: string
  /** Cloudflare API Token */
  apiToken: string
  /** Account ID */
  accountId: string
  /** 最大降级深度（默认使用全部模型） */
  maxDepth?: number
  /** 单次请求超时（毫秒，默认 120000） */
  timeoutMs?: number
  /** 重试次数（每个模型，默认 1） */
  retriesPerModel?: number
  /** 自定义模型列表（覆盖默认） */
  models?: AiModel[]
}

// —— 降级结果 —-

export interface FallbackResult {
  /** 最终成功的模型 ID */
  modelUsed: string
  /** 尝试过的模型列表 */
  attempted: Array<{
    model: string
    success: boolean
    reason?: FallbackReason
    error?: string
  }>
  /** 生成的内容 */
  content: string
}

// —— 错误分类 ——

function classifyError(error: Error): FallbackReason {
  const msg = error.message.toLowerCase()
  if (msg.includes('quota') || msg.includes('limit') || msg.includes('exceeded')) return 'quota_exceeded'
  if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout'
  if (msg.includes('rate') || msg.includes('429')) return 'rate_limit'
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('server')) return 'server_error'
  if (msg.includes('400') || msg.includes('invalid') || msg.includes('bad request')) return 'invalid_request'
  return 'unknown'
}

// —— 创建单个模型的客户端 ——

function createModelClient(
  model: AiModel,
  config: FallbackConfig
): AiClient {
  const baseUrl = config.baseUrl || 'https://api.cloudflare.com/client/v4'
  const timeoutMs = config.timeoutMs || 120_000

  return async (messages: AiMessage[]): Promise<string> => {
    const res = await fetch(
      `${baseUrl}/accounts/${config.accountId}/ai/run/${model.id}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages }),
        signal: AbortSignal.timeout(timeoutMs),
      }
    )

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
    }

    const data: any = await res.json()
    return data?.result?.response ?? data?.result ?? ''
  }
}

// —— 额度状态记录（模块级，进程内共享）——

/** 额度已用完的模型 ID 集合 */
const quotaExhausted = new Set<string>()

/** 重置额度状态（测试或手动恢复时使用） */
export function resetQuotaState(): void {
  quotaExhausted.clear()
}

/** 获取当前额度用完的模型列表 */
export function getQuotaExhaustedModels(): string[] {
  return Array.from(quotaExhausted)
}

// —— 创建降级客户端 ——

export function createFallbackClient(config: FallbackConfig): AiClient {
  const models = (config.models || FREE_TEXT_MODELS)
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .slice(0, config.maxDepth || FREE_TEXT_MODELS.length)

  const retriesPerModel = config.retriesPerModel ?? 1
  const log = (...args: unknown[]) => console.log(new Date().toISOString(), '[ai-fallback]', ...args)

  return async (messages: AiMessage[]): Promise<string> => {
    const attempted: FallbackResult['attempted'] = []

    // 过滤掉额度已用完的模型
    const availableModels = models.filter(m => !quotaExhausted.has(m.id))

    if (availableModels.length === 0) {
      throw new Error(`所有模型额度均已用完。已记录：${Array.from(quotaExhausted).join(', ')}`)
    }

    if (availableModels.length < models.length) {
      const skipped = models.filter(m => quotaExhausted.has(m.id)).map(m => m.id)
      log(`跳过额度用完的模型：${skipped.join(', ')}`)
    }

    for (const model of availableModels) {
      const client = createModelClient(model, config)
      let lastError: Error | undefined

      for (let retry = 0; retry <= retriesPerModel; retry++) {
        if (retry > 0) {
          log(`模型 ${model.id} 第 ${retry + 1} 次重试`)
        }

        try {
          const content = await client(messages)
          if (content) {
            attempted.push({ model: model.id, success: true })
            log(`成功：${model.id}（尝试 ${attempted.length} 个模型）`)
            return content
          }
          lastError = new Error('Empty response')
        } catch (e: any) {
          lastError = e
          const reason = classifyError(e)
          log(`失败：${model.id}（${reason}）: ${e.message}`)

          // 额度用完 → 记录状态，后续调用跳过该模型
          if (reason === 'quota_exceeded') {
            quotaExhausted.add(model.id)
            log(`模型 ${model.id} 额度已用完，已记录`)
          }

          if (retry === retriesPerModel) {
            attempted.push({ model: model.id, success: false, reason, error: e.message })
          }
        }
      }

      // 某些错误不值得继续尝试（如请求无效）
      if (lastError && classifyError(lastError) === 'invalid_request') {
        log(`请求无效，跳过剩余模型`)
        break
      }
    }

    throw new Error(
      `所有模型均失败。尝试记录：${attempted.map(a => `${a.model}(${a.reason || 'error'})`).join(', ')}`
    )
  }
}

// —— 获取推荐模型列表 ——

export function getRecommendedModels(chineseOnly = true): AiModel[] {
  return FREE_TEXT_MODELS
    .filter(m => !chineseOnly || m.chineseOptimized)
    .sort((a, b) => a.priority - b.priority)
}

// —— 导出默认客户端工厂 ——

export function createCloudflareAiClient(config: FallbackConfig): AiClient {
  return createFallbackClient(config)
}

// —— 统一客户端工厂（根据配置自动选择）——

export interface UnifiedAiConfig {
  /** Cloudflare Workers AI 配置（启用降级） */
  cloudflare?: {
    apiToken: string
    accountId: string
    baseUrl?: string
    maxDepth?: number
    timeoutMs?: number
    retriesPerModel?: number
    models?: AiModel[]
  }
  /** OpenAI 兼容 API 配置（普通客户端） */
  openai?: {
    baseUrl?: string
    apiKey: string
    model?: string
    maxTokens?: number
  }
}

/**
 * 创建 AI 客户端（根据配置自动选择）
 *
 * 优先级：
 * 1. 配置了 cloudflare → 使用降级客户端（额度用完自动切换）
 * 2. 配置了 openai → 使用 OpenAI 兼容客户端
 * 3. 都未配置 → 抛出错误
 */
export function createAiClient(config: UnifiedAiConfig): AiClient {
  if (config.cloudflare) {
    return createFallbackClient(config.cloudflare)
  }

  if (config.openai) {
    const baseUrl = (config.openai.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
    const apiKey = config.openai.apiKey
    const model = config.openai.model || 'gpt-4o-mini'
    const maxTokens = config.openai.maxTokens || 4096

    return async (messages: AiMessage[]): Promise<string> => {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: false }),
        signal: AbortSignal.timeout(180_000),
      })
      if (!res.ok) throw new Error(`AI API HTTP ${res.status}: ${await res.text().catch(() => '')}`)
      const data: any = await res.json()
      return data?.choices?.[0]?.message?.content ?? ''
    }
  }

  throw new Error('必须配置 cloudflare 或 openai')
}
