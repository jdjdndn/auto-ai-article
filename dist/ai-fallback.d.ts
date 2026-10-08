import type { AiClient, AiMessage } from './types.js';
import { FREE_TEXT_MODELS, OPENROUTER_FREE_MODELS } from './ai-config.js';
import type { AiModel } from './ai-config.js';
/** 失败模型持久化存储接口（Workers 环境用 KV/D1，Node 环境用 fs） */
export interface BadModelStore {
    load(): string[] | null;
    save(models: string[]): void;
}
export { FREE_TEXT_MODELS, OPENROUTER_FREE_MODELS };
export type { AiModel };
export type FallbackReason = 'quota_exceeded' | 'timeout' | 'rate_limit' | 'server_error' | 'invalid_request' | 'unknown';
export interface FallbackConfig {
    /** Cloudflare Workers AI API 地址（默认 https://api.cloudflare.com/client/v4） */
    baseUrl?: string;
    /** Cloudflare API Token */
    apiToken: string;
    /** Account ID */
    accountId: string;
    /** 最大降级深度（默认使用全部模型） */
    maxDepth?: number;
    /** 单次请求超时（毫秒，默认 120000） */
    timeoutMs?: number;
    /** 重试次数（每个模型，默认 1） */
    retriesPerModel?: number;
    /** 生成 token 预算（默认 15360，覆盖思考型模型预算不足导致的内容截断） */
    maxTokens?: number;
    /** 当天失败记忆：注入存储实现（Node 传 fs 实现，Workers 传 KV 实现，不传则不持久化） */
    badModelStore?: BadModelStore;
    /** 内容最短长度门禁（默认 0 不启用；启用后短文视为失败切换下一模型） */
    minLength?: number;
    /** 完整收尾门禁（默认 false 不启用；启用后结尾须以句号类标点或 URL 收尾，否则视为截断切换下一模型） */
    requireEnding?: boolean;
    /** 自定义模型列表（覆盖默认） */
    models?: AiModel[];
}
export interface FallbackResult {
    /** 最终成功的模型 ID */
    modelUsed: string;
    /** 尝试过的模型列表 */
    attempted: Array<{
        model: string;
        success: boolean;
        reason?: FallbackReason;
        error?: string;
    }>;
    /** 生成的内容 */
    content: string;
}
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
export declare function extractResponse(data: any): string;
/** 重置额度状态（测试或手动恢复时使用） */
export declare function resetQuotaState(): void;
/** 获取当前额度用完的模型列表 */
export declare function getQuotaExhaustedModels(): string[];
export declare function createFallbackClient(config: FallbackConfig): AiClient;
/** AI 提供方接口（策略模式） */
export interface AiProvider {
    /** 提供方名称 */
    name: string;
    /** 尝试生成，成功返回内容，失败抛错 */
    try(messages: AiMessage[]): Promise<string>;
    /** 获取已记录的坏模型列表 */
    getBadModels(): string[];
}
/** 责任链：多个 provider 依次尝试，一个全失败切下一个 */
export declare class FallbackChain {
    private providers;
    private log;
    constructor(providers: AiProvider[], logFn?: (...args: unknown[]) => void);
    run(messages: AiMessage[]): Promise<string>;
}
/** CF Workers AI binding provider */
export declare class CfBindingProvider implements AiProvider {
    name: string;
    private binding;
    private models;
    private maxTokens;
    private timeoutMs;
    private badModels;
    private quotaExhausted;
    private log;
    constructor(config: {
        binding: any;
        models?: AiModel[];
        maxDepth?: number;
        maxTokens?: number;
        timeoutMs?: number;
        logFn?: (...args: unknown[]) => void;
    });
    try(messages: AiMessage[]): Promise<string>;
    getBadModels(): string[];
}
/** OpenRouter provider（包装 createOpenRouterClient） */
export declare class OpenRouterProvider implements AiProvider {
    name: string;
    private client;
    private badModels;
    constructor(config: {
        apiKey: string;
        baseUrl?: string;
        models?: string[];
        timeoutMs?: number;
    });
    try(messages: AiMessage[]): Promise<string>;
    getBadModels(): string[];
}
export interface BindingFallbackConfig {
    /** Cloudflare Workers AI binding 对象（env.AI） */
    binding: any;
    /** CF 模型列表（默认 FREE_TEXT_MODELS） */
    models?: AiModel[];
    /** 最大降级深度 */
    maxDepth?: number;
    /** 单次请求超时（毫秒，默认 120000） */
    timeoutMs?: number;
    /** 生成 token 预算（默认 4096） */
    maxTokens?: number;
    /** OpenRouter 兜底配置（不传则不启用） */
    openrouter?: {
        apiKey: string;
        baseUrl?: string;
        models?: string[];
        timeoutMs?: number;
    };
}
export declare function createBindingFallbackClient(config: BindingFallbackConfig): AiClient;
export declare function getRecommendedModels(chineseOnly?: boolean): AiModel[];
export declare function createCloudflareAiClient(config: FallbackConfig): AiClient;
export interface UnifiedAiConfig {
    /** Cloudflare Workers AI 配置（启用降级） */
    cloudflare?: {
        apiToken: string;
        accountId: string;
        baseUrl?: string;
        maxDepth?: number;
        timeoutMs?: number;
        retriesPerModel?: number;
        maxTokens?: number;
        badModelStore?: BadModelStore;
        minLength?: number;
        requireEnding?: boolean;
        models?: AiModel[];
    };
    /** OpenRouter 兜底（OpenAI 兼容，免费模型链降级） */
    openrouter?: {
        apiKey: string;
        baseUrl?: string;
        models?: string[];
        timeoutMs?: number;
    };
    /** OpenAI 兼容 API 配置（普通客户端） */
    openai?: {
        baseUrl?: string;
        apiKey: string;
        model?: string;
        maxTokens?: number;
    };
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
export declare function createAiClient(config: UnifiedAiConfig): AiClient;
/**
 * OpenRouter 客户端：OpenAI 兼容端点 + 免费模型链依次降级
 * （402 无额度 / 404 模型下架 / 429 限流 / 5xx → 切换下一模型）
 */
export declare function createOpenRouterClient(config: {
    apiKey: string;
    baseUrl?: string;
    models?: string[];
    timeoutMs?: number;
}): AiClient;
