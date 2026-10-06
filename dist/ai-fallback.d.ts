import type { AiClient } from './types.js';
export interface AiModel {
    /** 模型 ID（Cloudflare Workers AI） */
    id: string;
    /** 供应商 */
    provider: string;
    /** 优先级（数字越小越优先） */
    priority: number;
    /** 说明 */
    description: string;
    /** 是否适合中文长文 */
    chineseOptimized: boolean;
}
export declare const FREE_TEXT_MODELS: AiModel[];
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
/** 重置额度状态（测试或手动恢复时使用） */
export declare function resetQuotaState(): void;
/** 获取当前额度用完的模型列表 */
export declare function getQuotaExhaustedModels(): string[];
export declare function createFallbackClient(config: FallbackConfig): AiClient;
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
        models?: AiModel[];
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
 * 2. 配置了 openai → 使用 OpenAI 兼容客户端
 * 3. 都未配置 → 抛出错误
 */
export declare function createAiClient(config: UnifiedAiConfig): AiClient;
