export interface Seed {
    id: number;
    raw: string;
    category: string;
    template: string;
    status: string;
    publishAt: string | null;
    expiresAt: string | null;
    articleId: string | null;
    error: string | null;
    source: string;
    fp: string;
    createdAt: string;
    updatedAt: string;
}
export interface SeedInput {
    raw: string;
    category?: string;
    template?: string;
    publishAt?: string | null;
    expiresAt?: string | null;
}
/** AI 生成的文章结构 */
export interface GeneratedArticle {
    title: string;
    summary: string;
    content: ContentBlock[];
    template: 'deal' | 'guide' | 'faq' | 'default';
    category: string;
    tags: string[];
    faq: FaqItem[];
    links: LinkItem[];
    expiresAt?: string | null;
    /** 管线设置：安全检查命中时自动降级为 'draft' */
    status?: 'draft' | 'published';
}
/** 内容块（显式联合，去掉 catch-all 以保留类型安全） */
export type ContentBlock = {
    type: 'text';
    text: string;
} | {
    type: 'h2';
    text: string;
} | {
    type: 'list';
    items: string[];
} | {
    type: 'quote';
    text: string;
    tone?: 'warn' | 'info';
} | {
    type: 'ad';
    label: string;
    text: string;
    link?: string;
} | {
    type: 'price';
    price: string;
    original?: string;
    spec?: string;
    name?: string;
    desc?: string;
} | {
    type: 'image';
    url: string;
    alt?: string;
    caption?: string;
} | {
    type: 'video';
    url: string;
    title?: string;
};
/** CTA 卡片配置（renderArticleCta 用） */
export interface CtaConfig {
    /** 主标题，默认"想办一张高性价比套餐？" */
    title?: string;
    /** 描述文字 */
    description?: string;
    /** 主按钮文案，默认"立即办理" */
    primaryLabel?: string;
    /** 主按钮链接 */
    primaryUrl?: string;
    /** 副按钮文案（留空则不显示） */
    secondaryLabel?: string;
    /** 副按钮链接 */
    secondaryUrl?: string;
}
export interface FaqItem {
    q: string;
    a: string;
}
export interface LinkItem {
    label: string;
    url: string;
}
export interface InsertResultItem {
    id: string;
    ok: boolean;
    error?: string;
}
export interface InsertResult {
    total: number;
    created: number;
    failed: number;
    results: InsertResultItem[];
}
export interface SafetyHit {
    cat: string;
    label: string;
    word: string;
}
export interface SafetyResult {
    ok: boolean;
    hits: SafetyHit[];
}
export interface SafetyRule {
    cat: string;
    label: string;
    words: string[];
}
/** AI 消息 */
export interface AiMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
/** AI 客户端函数签名：接收消息数组，返回文本 */
export type AiClient = (messages: AiMessage[]) => Promise<string>;
/** AI 调用配置 */
export interface AiConfig {
    /** 自定义 AI 客户端（覆盖默认的 OpenAI 兼容调用） */
    client?: AiClient;
    /** OpenAI 兼容 API 地址（默认 https://api.openai.com/v1） */
    baseUrl?: string;
    /** API Key */
    apiKey?: string;
    /** 模型名称（默认 gpt-4o-mini） */
    model?: string;
    /** 最大 token 数（默认 4096） */
    maxTokens?: number;
    /** Cloudflare Workers AI 配置（启用降级，优先级高于 baseUrl/apiKey） */
    cloudflare?: {
        apiToken: string;
        accountId: string;
        baseUrl?: string;
        maxDepth?: number;
        timeoutMs?: number;
        retriesPerModel?: number;
    };
    /** OpenRouter 兜底（CF 额度用尽后自动切换；优先级高于 baseUrl/apiKey，低于 cloudflare） */
    openrouter?: {
        apiKey: string;
        baseUrl?: string;
        models?: string[];
    };
}
export interface PipelineConfig {
    /** 每轮目标生成篇数（默认 3） */
    target?: number;
    /** AI 配置 */
    ai?: AiConfig;
    /** 自定义系统提示词（覆盖默认） */
    systemPrompt?: string;
    /** 自定义选题提示词（覆盖默认） */
    suggestPrompt?: string;
    /** 自定义内容安全规则（追加到默认规则） */
    extraSafetyRules?: SafetyRule[];
    /** 是否启用水占位 URL 清洗（默认 true） */
    sanitizeUrls?: boolean;
    /**
     * 安全命中处理方式（默认 'replace'）
     * - 'draft': 标记为草稿待人工审核
     * - 'replace': 替换违规词后仍以 published 发表
     */
    safetyAction?: 'draft' | 'replace';
    /** AI 选题失败重试次数（默认 1，即最多尝试 2 次） */
    suggestRetries?: number;
    /** 并发生成篇数（默认 3） */
    concurrency?: number;
}
export interface PipelineRunResult {
    ok: number;
    fail: number;
    total: number;
    articles: Array<{
        title: string;
        articleId: string;
    }>;
    errors: string[];
}
export interface TopicSuggestion {
    title: string;
    angle: string;
    category: string;
}
export interface RunLogInput {
    runAt?: string;
    model?: string;
    total?: number;
    ok?: number;
    fail?: number;
    error?: string | null;
    dryRun?: boolean;
}
