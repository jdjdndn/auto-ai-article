/** AI 模型定义（Cloudflare Workers AI） */
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
    /** 是否关闭思考模式（chat_template_kwargs.thinking=false） */
    noThinking?: boolean;
}
export declare const FREE_TEXT_MODELS: AiModel[];
/** OpenRouter 免费模型链（2026-10-07 实时查询，前 10 个，顺序即降级顺序；:free 后缀的模型无需账户 credits） */
export declare const OPENROUTER_FREE_MODELS: string[];
/** 备用提供方（OpenAI 兼容；OpenRouter 走 :free 免费模型链） */
export interface FallbackProvider {
    name: string;
    envKey: string;
    baseUrl: string;
    models: string[];
}
export declare const FALLBACK_PROVIDERS: FallbackProvider[];
/** 各站点族默认 CF 模型（消费项目不单独声明时使用；当前 15 站点统一） */
export declare const SITE_DEFAULT_MODELS: Record<string, string>;
/** 取站点默认模型（未在表中覆盖则用 default） */
export declare function getSiteDefaultModel(siteKey?: string): string;
