import type { ContentBlock } from './types.js';
/** 从候选字段中取第一个非空字符串（空串不能短路，否则会丢掉后面的真实内容） */
export declare function firstNonEmpty(...vals: unknown[]): string;
export declare function extractJson(text: string): unknown;
/** 从解析结果中尽可能取出数组列表（topics/list/items/data/result 等常见包装） */
export declare function asAnyArray(parsed: unknown): unknown[] | null;
/** 安全 JSON 解析 */
export declare function safeJson(s: string | null | undefined, fallback?: unknown): unknown;
/** JSON 字段归一化：任意值 → 紧凑 JSON 字符串；空 → '[]' */
export declare function normalizeJson(v: unknown): string | null;
/** 从 content 块数组提取第一个 image 块 URL */
export declare function firstImageOf(content: unknown): string;
/** 把 AI 松散 content 块归一化为标准 {type,...} 结构，禁止缺 type 的对象入库 */
export declare function normalizeContentBlocks(raw: unknown): ContentBlock[];
/** HTML 转义，防 XSS */
export declare function escapeHtml(v: unknown): string;
/** 从 blocks 提取 h2 生成 TOC 目录（≥3 个 h2 才输出），用 <details> 小屏折叠 */
export declare function generateToc(blocks: ContentBlock[]): string;
/** 估算阅读时长（中文 300 字/分钟），返回分钟数 */
export declare function readingTime(blocks: ContentBlock[]): number;
/** 渲染单个 block 为 HTML 字符串 */
export declare function renderBlock(block: ContentBlock, h2Idx: {
    i: number;
}): string;
/** 渲染整个 content blocks 数组为 HTML 字符串（自动加 TOC） */
export declare function renderArticleBlocks(blocks: ContentBlock[]): string;
/** 渲染底部 CTA 卡片 HTML */
export declare function renderArticleCta(siteConfig: {
    name?: string;
    priceRange?: string;
    userUrl?: string;
    agentUrl?: string;
} | undefined): string;
