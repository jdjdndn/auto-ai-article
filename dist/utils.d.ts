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
/** 文章页配套 CSS（TOC/block 排版），各项目用 useHead({ style }) 注入 */
export declare const articleCss = "\n.article-toc {\n  background: var(--primary-weak, #eff6ff);\n  border: 1px solid #dbeafe;\n  border-radius: 10px;\n  padding: 12px 16px;\n  margin-bottom: 20px;\n  font-size: 14px;\n}\n.article-toc .toc-title {\n  font-weight: 600;\n  color: var(--text);\n  cursor: pointer;\n  list-style: none;\n}\n.article-toc .toc-title::-webkit-details-marker { display: none; }\n.article-toc ul { list-style: none; padding: 0; margin: 8px 0 0; }\n.article-toc li { padding: 3px 0; }\n.article-toc a {\n  color: var(--primary);\n  text-decoration: none;\n  line-height: 1.5;\n}\n.article-toc a:hover { text-decoration: underline; }\n.block-h2 { scroll-margin-top: 80px; }\n@media (max-width: 767px) {\n  .article-toc .toc-title::after {\n    content: '\\25B8';\n    float: right;\n    transition: transform .2s;\n  }\n  .article-toc[open] .toc-title::after { transform: rotate(90deg); }\n}\n.text-block, .list-item {\n  line-height: 1.8;\n  margin: 0 0 1em;\n  color: var(--text);\n}\n.block-list { margin: 0 0 1em; }\n.block-price {\n  display: flex;\n  align-items: baseline;\n  gap: 8px;\n  padding: 12px 16px;\n  background: #f8fafc;\n  border-radius: 8px;\n  margin: 0 0 1em;\n}\n.block-price .price { font-size: 20px; font-weight: 700; color: #dc2626; }\n.block-price .original { font-size: 14px; color: #94a3b8; text-decoration: line-through; }\n.block-price .spec { font-size: 13px; color: #64748b; }\n.block-quote {\n  padding: 12px 16px;\n  border-left: 3px solid var(--primary, #2563eb);\n  background: var(--primary-weak, #eff6ff);\n  border-radius: 0 8px 8px 0;\n  margin: 0 0 1em;\n  font-style: italic;\n}\n.block-quote.warn { border-left-color: #f59e0b; background: #fffbeb; }\n.block-image { margin: 0 0 1em; }\n.block-image img { max-width: 100%; border-radius: 8px; }\n.block-image figcaption { font-size: 12px; color: #94a3b8; text-align: center; margin-top: 6px; }\n.ad-block {\n  padding: 14px 16px;\n  background: linear-gradient(135deg, #eff6ff, #dbeafe);\n  border-radius: 10px;\n  margin: 1.5em 0;\n}\n.ad-block .ad-label {\n  display: inline-block;\n  font-size: 12px;\n  color: var(--primary, #2563eb);\n  background: #fff;\n  padding: 2px 8px;\n  border-radius: 4px;\n  margin-bottom: 6px;\n}\n.ad-block p { margin: 0 0 8px; }\n.ad-block .ad-link { color: var(--primary, #2563eb); font-weight: 500; }\n";
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
