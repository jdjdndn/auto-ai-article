// ============================================================
// AI 模型降级库 — Cloudflare Workers AI 免费模型故障自动切换
// 独立封装，不修改其他项目代码
// ============================================================

import type { AiClient, AiMessage } from './types.js'
import { FREE_TEXT_MODELS, OPENROUTER_FREE_MODELS } from './ai-config.js'
import type { AiModel } from './ai-config.js'

/** 失败模型持久化存储接口（Workers 环境用 KV/D1，Node 环境用 fs） */
export interface BadModelStore {
  load(): string[] | null
  save(models: string[]): void
}

// —— 模型/提供方配置：唯一事实源 ai-config.ts（勿在此手抄）——
export { FREE_TEXT_MODELS, OPENROUTER_FREE_MODELS }
export type { AiModel }

// —— 故障类型 ——

export type FallbackReason =
  | 'quota_exceeded' // 额度不足
  | 'timeout' // 超时
  | 'rate_limit' // 限流
  | 'server_error' // 服务端错误
  | 'invalid_request' // 请求无效
  | 'unknown' // 未知错误

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
  /** 生成 token 预算（默认 15360，覆盖思考型模型预算不足导致的内容截断） */
  maxTokens?: number
  /** 当天失败记忆：注入存储实现（Node 传 fs 实现，Workers 传 KV 实现，不传则不持久化） */
  badModelStore?: BadModelStore
  /** 内容最短长度门禁（默认 0 不启用；启用后短文视为失败切换下一模型） */
  minLength?: number
  /** 完整收尾门禁（默认 false 不启用；启用后结尾须以句号类标点或 URL 收尾，否则视为截断切换下一模型） */
  requireEnding?: boolean
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

// —— 响应提取（兼容不同模型格式）——

/**
 * 从 Cloudflare Workers AI 响应中提取文本内容
 *
 * 兼容格式（HTTP API + Workers AI binding 两条路径共用）：
 * 1. 顶层字符串：data 本身就是 string
 * 2. 标准格式：{ result: { response: "..." } }
 * 3. 直接字符串：{ result: "..." }
 * 4. OpenAI 兼容：{ result: { choices: [{ message: { content: "..." } }] } }
 * 5. 数组格式：{ result: [{ content: "..." }] }
 * 6. binding 无 result 包装：{ choices: [...] } / { response: "..." } / { text: "..." }
 * 7. reasoning_content 回退（思考型模型：content 为空时取 reasoning）
 * 8. 其他格式：尝试提取 content/text 字段
 *
 * 空串保护：content 为空串/纯空白时继续尝试后续通道，避免 ?? 短路丢掉真实内容。
 */
export function extractResponse(data: any): string {
  // 1. 顶层字符串：部分 binding 直接返回 string
  if (typeof data === 'string') return data

  const pick = (v: unknown): string => (typeof v === 'string' && v.trim() ? v : '')

  // 2. 标准格式：{ result: { response: "..." } }
  const r1 = pick(data?.result?.response)
  if (r1) return r1

  // 3. 直接字符串：{ result: "..." }
  const r2 = pick(data?.result)
  if (r2) return r2

  // 4. OpenAI 兼容：{ result: { choices: [{ message: { content } }] } }
  const r3 = pick(data?.result?.choices?.[0]?.message?.content)
  if (r3) return r3

  // 5. 数组格式：{ result: [{ content: "..." }] }
  if (Array.isArray(data?.result)) {
    const r4 = pick(data.result[0]?.content)
    if (r4) return r4
  }

  // 6. binding 无 result 包装（部分模型直接返回顶层字段）
  const r5 = pick(data?.choices?.[0]?.message?.content)
  if (r5) return r5
  const r6 = pick(data?.response)
  if (r6) return r6

  // 7. reasoning_content 回退（思考型模型：content 为空时取 reasoning）
  const r7 = pick(data?.result?.choices?.[0]?.message?.reasoning_content)
  if (r7) return r7
  const r8 = pick(data?.choices?.[0]?.message?.reasoning_content)
  if (r8) return r8

  // 8. 其他格式：尝试提取 content/text 字段
  return pick(data?.result?.content) || pick(data?.result?.text) || pick(data?.text) || ''
}

// —— 错误分类 ——

function classifyError(error: Error): FallbackReason {
  // 超时：手动 AbortController 中止会产生 TimeoutError/AbortError
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'timeout'
  const msg = error.message.toLowerCase()
  if (msg.includes('rate') || msg.includes('429')) return 'rate_limit'
  if (msg.includes('quota') || msg.includes('exceeded')) return 'quota_exceeded'
  if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout'
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('server')) return 'server_error'
  if (msg.includes('400') || msg.includes('invalid') || msg.includes('bad request')) return 'invalid_request'
  return 'unknown'
}

// —— 创建单个模型的客户端 ——

function createModelClient(model: AiModel, config: FallbackConfig): AiClient {
  const baseUrl = config.baseUrl || 'https://api.cloudflare.com/client/v4'
  const timeoutMs = config.timeoutMs || 120_000
  const maxTokens = config.maxTokens || 15_360

  return async (messages: AiMessage[]): Promise<string> => {
    const body: Record<string, unknown> = { messages, max_tokens: maxTokens }
    // 关思考：思考型模型（glm/deepseek/qwen 系）会把预算烧在 reasoning 上导致正文截断；
    // 仅对实测支持 chat_template_kwargs 的模型开启（mistral-small 不支持，传参会 400）
    if (model.noThinking) {
      body.chat_template_kwargs = { thinking: false }
    }

    // Node v22 下 AbortSignal.timeout() 不可靠（不触发 abort），用手动控制器；
    // 中止时用 TimeoutError 命名，便于 classifyError 识别为超时（与 generate-posts.js 一致）
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('AI 请求超时', 'TimeoutError')), timeoutMs)
    try {
      const res = await fetch(`${baseUrl}/accounts/${config.accountId}/ai/run/${model.id}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}: ${bodyText.slice(0, 200)}`)
      }

      const data: any = await res.json()
      const content = extractResponse(data)
      if (!content) throw new Error('AI 没有返回内容')
      // 截断兜底：finish_reason=length 说明模型输出被预算截断（内容半截），
      // 直接视为失败切换下一模型，不接收不完整文章（与 generate-posts.js 一致）
      const fr = data?.result?.choices?.[0]?.finish_reason
      if (fr === 'length') throw new Error('AI 输出被截断（finish_reason=length，内容不完整）')
      return content
    } finally {
      clearTimeout(timer)
    }
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

// —— 按天失败记忆（BadModelStore 实现负责持久化）——

function loadBadModels(store?: BadModelStore): Set<string> {
  if (!store) return new Set()
  try {
    const data = store.load()
    if (data && Array.isArray(data)) return new Set(data)
  } catch {
    /* 读失败：从空开始 */
  }
  return new Set()
}

function saveBadModels(store: BadModelStore | undefined, models: Set<string>): void {
  if (!store) return
  try {
    store.save([...models])
  } catch {
    /* 写失败不影响主流程 */
  }
}

// —— 创建降级客户端 ——

export function createFallbackClient(config: FallbackConfig): AiClient {
  const models = (config.models || FREE_TEXT_MODELS)
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .slice(0, config.maxDepth || FREE_TEXT_MODELS.length)

  const retriesPerModel = config.retriesPerModel ?? 1
  const minLength = config.minLength || 0
  const requireEnding = config.requireEnding ?? false
  const badModels = loadBadModels(config.badModelStore)
  const log = (...args: unknown[]) => console.log(new Date().toISOString(), '[ai-fallback]', ...args)

  // 完整收尾门禁：最后一句必须以句号类标点结束，或以 URL 收尾（URL 后不带句号是模型常见合法写法）
  function endingOk(content: string): boolean {
    const tail = content.trim().replace(/`{3,}/g, '').trim()
    return /[。！？…!?.]$/.test(tail) || /https?:\/\/\S+$/.test(tail)
  }

  // 确定性失败（不重试直接切下一模型）：额度/限流/超时/请求无效/截断/空响应/过短/结尾不完整
  function isDeterministicFailure(err: Error): boolean {
    const reason = classifyError(err)
    if (reason === 'quota_exceeded' || reason === 'rate_limit' || reason === 'timeout' || reason === 'invalid_request')
      return true
    return /被截断|没有返回内容|过短|结尾不完整/.test(err.message)
  }

  return async (messages: AiMessage[]): Promise<string> => {
    const attempted: FallbackResult['attempted'] = []

    // 过滤掉额度已用完或当天已失败的模型
    const unavailable = [...quotaExhausted, ...badModels]
    const availableModels = models.filter((m) => !unavailable.includes(m.id))

    if (availableModels.length === 0) {
      throw new Error(`所有模型当天不可用。已记录：${[...new Set(unavailable)].join(', ')}`)
    }

    if (availableModels.length < models.length) {
      const skipped = models.filter((m) => unavailable.includes(m.id)).map((m) => m.id)
      log(`跳过当天不可用模型：${skipped.join(', ')}`)
    }

    for (const model of availableModels) {
      const client = createModelClient(model, config)
      let lastError: Error | undefined
      let failedForGood = false

      for (let retry = 0; retry <= retriesPerModel; retry++) {
        if (retry > 0) {
          log(`模型 ${model.id} 第 ${retry + 1} 次重试`)
        }

        try {
          const content = await client(messages)
          // 内容质量门禁（对齐 generate-posts.js）：过短/结尾不完整视为不合格，切下一模型
          if (minLength > 0 && content.trim().length < minLength) {
            throw new Error(`内容过短(${content.trim().length}字 < ${minLength})`)
          }
          if (requireEnding && !endingOk(content)) {
            throw new Error(`内容被截断(结尾不完整: …${content.trim().slice(-16)})`)
          }
          attempted.push({ model: model.id, success: true })
          log(`成功：${model.id}（尝试 ${attempted.length} 个模型）`)
          return content
        } catch (e: any) {
          lastError = e
          const reason = classifyError(e)
          log(`失败：${model.id}（${reason}）: ${e.message}`)

          if (reason === 'quota_exceeded') {
            quotaExhausted.add(model.id)
            log(`模型 ${model.id} 额度已用完，已记录`)
          }

          // 确定性失败不重试：额度/限流/超时/请求无效/截断/空响应/过短（重试只会浪费 token）
          if (isDeterministicFailure(e)) {
            failedForGood = true
            break
          }

          if (retry === retriesPerModel) {
            failedForGood = true
          }
        }
      }

      // 模型整体失败（重试完或确定性失败）→ 记入当天失败记忆：今天之内不再使用
      if (failedForGood) {
        badModels.add(model.id)
        saveBadModels(config.badModelStore, badModels)
        attempted.push({
          model: model.id,
          success: false,
          reason: classifyError(lastError || new Error('unknown')),
          error: lastError?.message,
        })
      }
    }

    throw new Error(
      `所有模型均失败。尝试记录：${attempted.map((a) => `${a.model}(${a.reason || 'error'})`).join(', ')}`,
    )
  }
}

// —— 策略模式 + 责任链：AI Provider 抽象 ——

/** AI 提供方接口（策略模式） */
export interface AiProvider {
  /** 提供方名称 */
  name: string
  /** 尝试生成，成功返回内容，失败抛错 */
  try(messages: AiMessage[]): Promise<string>
  /** 获取已记录的坏模型列表 */
  getBadModels(): string[]
}

/** 责任链：多个 provider 依次尝试，一个全失败切下一个 */
export class FallbackChain {
  private providers: AiProvider[]
  private log: (...args: unknown[]) => void

  constructor(providers: AiProvider[], logFn?: (...args: unknown[]) => void) {
    this.providers = providers
    this.log = logFn || ((...args: unknown[]) => console.log(new Date().toISOString(), '[ai-chain]', ...args))
  }

  async run(messages: AiMessage[]): Promise<string> {
    const errors: string[] = []
    for (const provider of this.providers) {
      try {
        return await provider.try(messages)
      } catch (e: any) {
        const msg = String(e?.message || e)
        errors.push(`${provider.name}: ${msg}`)
        this.log(`${provider.name} 失败，切换下一个 provider`)
      }
    }
    throw new Error(`所有 AI provider 均失败：\n${errors.join('\n')}`)
  }
}

/** CF Workers AI binding provider */
export class CfBindingProvider implements AiProvider {
  name = 'cloudflare-binding'
  private binding: any
  private models: AiModel[]
  private maxTokens: number
  private timeoutMs: number
  private badModels = new Set<string>()
  private quotaExhausted = new Set<string>()
  private log: (...args: unknown[]) => void

  constructor(config: {
    binding: any
    models?: AiModel[]
    maxDepth?: number
    maxTokens?: number
    timeoutMs?: number
    logFn?: (...args: unknown[]) => void
  }) {
    this.binding = config.binding
    this.models = (config.models || FREE_TEXT_MODELS)
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .slice(0, config.maxDepth || FREE_TEXT_MODELS.length)
    this.maxTokens = config.maxTokens || 4096
    this.timeoutMs = config.timeoutMs || 120_000
    this.log = config.logFn || ((...args: unknown[]) => console.log(new Date().toISOString(), '[ai-cf]', ...args))
  }

  async try(messages: AiMessage[]): Promise<string> {
    const unavailable = [...this.quotaExhausted, ...this.badModels]
    const available = this.models.filter((m) => !unavailable.includes(m.id))
    if (!available.length) throw new Error('CF 所有模型当天不可用')

    for (const model of available) {
      try {
        const timer = setTimeout(() => {}, this.timeoutMs)
        let out: any
        try {
          const body: Record<string, unknown> = { messages, max_tokens: this.maxTokens }
          if (model.noThinking) body.chat_template_kwargs = { thinking: false }
          out = await this.binding.run(model.id, body)
        } finally {
          clearTimeout(timer)
        }
        const content = extractResponse(out)
        if (!content) throw new Error('AI 没有返回内容')
        const fr = out?.result?.choices?.[0]?.finish_reason || out?.choices?.[0]?.finish_reason
        if (fr === 'length') throw new Error('AI 输出被截断')
        this.log(`成功：${model.id}`)
        return content
      } catch (e: any) {
        const reason = classifyError(e)
        this.log(`失败：${model.id}（${reason}）`)
        if (reason === 'quota_exceeded') this.quotaExhausted.add(model.id)
        this.badModels.add(model.id)
      }
    }
    throw new Error(`CF 所有模型失败：${[...unavailable].join(', ')}`)
  }

  getBadModels(): string[] {
    return Array.from(this.badModels)
  }
}

/** OpenRouter provider（包装 createOpenRouterClient） */
export class OpenRouterProvider implements AiProvider {
  name = 'openrouter'
  private client: AiClient
  private badModels = new Set<string>()

  constructor(config: { apiKey: string; baseUrl?: string; models?: string[]; timeoutMs?: number }) {
    this.client = createOpenRouterClient(config)
  }

  async try(messages: AiMessage[]): Promise<string> {
    return this.client(messages)
  }

  getBadModels(): string[] {
    return Array.from(this.badModels)
  }
}

// —— Binding 降级客户端（基于 FallbackChain）——

export interface BindingFallbackConfig {
  /** Cloudflare Workers AI binding 对象（env.AI） */
  binding: any
  /** CF 模型列表（默认 FREE_TEXT_MODELS） */
  models?: AiModel[]
  /** 最大降级深度 */
  maxDepth?: number
  /** 单次请求超时（毫秒，默认 120000） */
  timeoutMs?: number
  /** 生成 token 预算（默认 4096） */
  maxTokens?: number
  /** OpenRouter 兜底配置（不传则不启用） */
  openrouter?: {
    apiKey: string
    baseUrl?: string
    models?: string[]
    timeoutMs?: number
  }
}

export function createBindingFallbackClient(config: BindingFallbackConfig): AiClient {
  const log = (...args: unknown[]) => console.log(new Date().toISOString(), '[ai-fallback]', ...args)

  const providers: AiProvider[] = [
    new CfBindingProvider({
      binding: config.binding,
      models: config.models,
      maxDepth: config.maxDepth,
      maxTokens: config.maxTokens,
      timeoutMs: config.timeoutMs,
      logFn: (...args: unknown[]) => console.log(new Date().toISOString(), '[ai-cf]', ...args),
    }),
  ]

  if (config.openrouter) {
    providers.push(new OpenRouterProvider(config.openrouter))
  }

  const chain = new FallbackChain(providers, log)
  return (messages: AiMessage[]) => chain.run(messages)
}

export function getRecommendedModels(chineseOnly = true): AiModel[] {
  return FREE_TEXT_MODELS.filter((m) => !chineseOnly || m.chineseOptimized).sort((a, b) => a.priority - b.priority)
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
    maxTokens?: number
    badModelStore?: BadModelStore
    minLength?: number
    requireEnding?: boolean
    models?: AiModel[]
  }
  /** OpenRouter 兜底（OpenAI 兼容，免费模型链降级） */
  openrouter?: {
    apiKey: string
    baseUrl?: string
    models?: string[]
    timeoutMs?: number
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
 * 2. 配置了 openrouter → 使用 OpenRouter 免费模型链客户端（CF 用尽后的兜底）
 * 3. 配置了 openai → 使用 OpenAI 兼容客户端
 * 4. 都未配置 → 抛出错误
 */
export function createAiClient(config: UnifiedAiConfig): AiClient {
  if (config.cloudflare) {
    const cfClient = createFallbackClient(config.cloudflare)
    // 同时配了 openrouter → CF 全部模型失败时回退到 OpenRouter
    if (config.openrouter) {
      const orClient = createOpenRouterClient(config.openrouter)
      return async (messages: AiMessage[]): Promise<string> => {
        try {
          return await cfClient(messages)
        } catch (e: any) {
          const msg = String(e?.message || e)
          if (msg.includes('所有模型') || msg.includes('不可用') || msg.includes('均失败')) {
            console.log('[ai-fallback] Cloudflare 模型全部不可用，回退到 OpenRouter')
            return orClient(messages)
          }
          throw e
        }
      }
    }
    return cfClient
  }

  if (config.openrouter) {
    return createOpenRouterClient(config.openrouter)
  }

  if (config.openai) {
    const baseUrl = (config.openai.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
    const apiKey = config.openai.apiKey
    const model = config.openai.model || 'gpt-4o-mini'
    const maxTokens = config.openai.maxTokens || 15_360

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

  throw new Error('必须配置 cloudflare、openrouter 或 openai')
}

/**
 * OpenRouter 客户端：OpenAI 兼容端点 + 免费模型链依次降级
 * （402 无额度 / 404 模型下架 / 429 限流 / 5xx → 切换下一模型）
 */
export function createOpenRouterClient(config: {
  apiKey: string
  baseUrl?: string
  models?: string[]
  timeoutMs?: number
}): AiClient {
  const baseUrl = (config.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '')
  const apiKey = config.apiKey
  const models = config.models?.length ? config.models : OPENROUTER_FREE_MODELS
  const timeoutMs = config.timeoutMs || 120_000

  return async (messages: AiMessage[]): Promise<string> => {
    const attempted: string[] = []
    for (const model of models) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new DOMException('AI 请求超时', 'TimeoutError')), timeoutMs)
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages, max_tokens: 15_360, stream: false }),
          signal: controller.signal,
        })
        if (!res.ok) {
          const bodyText = await res.text().catch(() => '')
          throw new Error(`HTTP ${res.status}: ${bodyText.slice(0, 200)}`)
        }
        const data: any = await res.json()
        const content = data?.choices?.[0]?.message?.content ?? ''
        if (!content.trim()) throw new Error('AI 没有返回内容')
        return content
      } catch (e: any) {
        attempted.push(`${model}(${classifyError(e)})`)
        const reason = classifyError(e)
        const msg = String(e.message || '').toLowerCase()
        // 确定性失败直接切下一模型；未知/服务端错误也切（免费模型链无需重试）
        if (reason === 'timeout' && !msg.includes('500') && !msg.includes('502') && !msg.includes('503')) {
          // 超时可能瞬时，但免费链上继续尝试下一模型成本更低
        }
      } finally {
        clearTimeout(timer)
      }
    }
    throw new Error(`所有 OpenRouter 免费模型失败。尝试记录：${attempted.join(', ')}`)
  }
}
