import type { ContentBlock, CtaConfig } from './types.js';
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
/** 文章页配套 CSS（TOC + block 排版，v-html 渲染用，各站用 useHead 注入） */
export declare const articleCss = "\n/* TOC \u76EE\u5F55 */\n.article-toc {\n  background: var(--primary-weak, #eff6ff);\n  border: 1px solid #dbeafe;\n  border-radius: 10px;\n  padding: 12px 16px;\n  margin-bottom: 20px;\n  font-size: 14px;\n}\n.article-toc .toc-title {\n  font-weight: 600;\n  color: var(--text);\n  cursor: pointer;\n  list-style: none;\n}\n.article-toc .toc-title::-webkit-details-marker { display: none; }\n.article-toc ul { list-style: none; padding: 0; margin: 8px 0 0; }\n.article-toc li { padding: 3px 0; }\n.article-toc a { color: var(--primary); text-decoration: none; line-height: 1.5; }\n.article-toc a:hover { text-decoration: underline; }\n.block-h2 { scroll-margin-top: 80px; }\n@media (max-width: 767px) {\n  .article-toc .toc-title::after { content: '\\25B8'; float: right; transition: transform .2s; }\n  .article-toc[open] .toc-title::after { transform: rotate(90deg); }\n}\n\n/* block \u6392\u7248 */\n.text-block { margin-bottom: 14px; line-height: 1.85; color: var(--text); font-size: 15px; }\n.block-h2 { font-size: 18px; margin: 26px 0 12px; padding: 4px 0 8px 12px; border-left: 4px solid var(--primary, #2563eb); color: var(--text); }\n.block-list { margin: 12px 0; }\n.list-item { padding: 6px 0 6px 20px; position: relative; color: var(--text); font-size: 14px; margin: 0; }\n.list-item::before { content: '\u2022'; position: absolute; left: 4px; color: var(--primary, #2563eb); font-weight: 700; }\n.block-price { display: flex; align-items: baseline; gap: 12px; background: linear-gradient(135deg, #fff7e6, #fffbe8); border: 1px solid #fde68a; border-radius: 12px; padding: 14px 18px; margin: 16px 0; }\n.block-price .price { font-size: 28px; font-weight: 700; color: #dc2626; }\n.block-price .original { color: #b6bcc6; text-decoration: line-through; font-size: 14px; }\n.block-price .spec { color: var(--text-muted, #64748b); font-size: 13px; }\n.block-quote { border-radius: 10px; padding: 12px 16px; margin: 16px 0; font-size: 14px; line-height: 1.75; }\n.block-quote.warn { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; }\n.block-quote.info { background: var(--primary-weak, #eff6ff); border: 1px solid #bfdbfe; color: #1d4ed8; }\n.block-image { margin: 16px 0; }\n.block-image img { width: 100%; border-radius: 12px; display: block; }\n.block-image figcaption { font-size: 12px; color: var(--text-muted, #94a3b8); margin-top: 6px; text-align: center; }\n\n/* ad block\uFF08\u4E3B\u9898\u53D8\u91CF\uFF1A--ad-bg/--ad-border/--ad-color/--ad-label-bg\uFF09 */\n.ad-block { background: var(--ad-bg, #fffbeb); border: 1px dashed var(--ad-border, #fcd34d); border-radius: 10px; padding: 12px 16px; margin: 12px 0; font-size: 14px; }\n.ad-block .ad-label { display: inline-block; background: var(--ad-label-bg, linear-gradient(135deg, #f59e0b, #d97706)); color: #fff; font-size: 11px; padding: 1px 10px; border-radius: 999px; margin-bottom: 6px; }\n.ad-block p { margin: 0 0 6px; color: var(--ad-color, inherit); }\n.ad-block .ad-link { display: inline-block; margin-top: 6px; font-weight: 600; color: var(--primary, #2563eb); text-decoration: none; }\n\n/* CTA \u5361\u7247 */\n.article-cta { margin-bottom: 22px; padding: 28px 24px; text-align: center; background: linear-gradient(135deg, #f0f9ff, #e0f2fe); border: 1px solid #bae6fd; border-radius: 10px; }\n.article-cta h2 { font-size: 18px; margin-bottom: 8px; color: var(--text); }\n.article-cta p { color: var(--text-muted, #64748b); font-size: 14px; margin-bottom: 18px; }\n.article-cta .cta-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }\n.btn-primary-cta { display: inline-block; padding: 12px 28px; background: linear-gradient(180deg, var(--primary, #2563eb), var(--primary-strong, #1d4ed8)); color: #fff; border-radius: 10px; text-decoration: none; font-size: 15px; font-weight: 600; transition: opacity .2s; }\n.btn-primary-cta:hover { opacity: .9; }\n.btn-secondary-cta { display: inline-block; padding: 12px 28px; background: #fff; color: var(--primary, #2563eb); border: 1px solid var(--primary, #2563eb); border-radius: 10px; text-decoration: none; font-size: 15px; font-weight: 600; transition: background .2s; }\n.btn-secondary-cta:hover { background: var(--primary-weak, #eff6ff); }\n\n/* \u94FE\u63A5\u533A */\n.article-links { margin: 20px 0; }\n.article-links .ad-note { display: block; font-size: 12px; color: var(--text-muted, #94a3b8); margin-bottom: 10px; }\n.article-links .ad-badge { background: #fef3c7; color: #92400e; font-size: 11px; padding: 1px 8px; border-radius: 4px; margin-right: 4px; }\n.article-links .link-btn { display: inline-block; padding: 10px 24px; background: linear-gradient(180deg, var(--primary, #2563eb), var(--primary-strong, #1d4ed8)); color: #fff; border-radius: 10px; text-decoration: none; font-size: 14px; font-weight: 500; margin-right: 8px; margin-bottom: 8px; }\n.article-links .more-wrap { margin-top: 8px; }\n.article-links .more-toggle { background: none; border: none; color: var(--primary, #2563eb); cursor: pointer; font-size: 13px; text-decoration: underline; }\n.article-links .more-list { margin-top: 8px; }\n.article-links .more-list .more-link { display: block; padding: 6px 0; color: var(--primary, #2563eb); text-decoration: none; font-size: 13px; }\n\n/* FAQ */\n.article-faq { margin: 22px 0; padding: 20px 24px; background: var(--card-bg, #fff); border-radius: 10px; }\n.article-faq h2 { font-size: 17px; margin-bottom: 10px; }\n.article-faq details { border-radius: 10px; padding: 4px 10px; margin: 8px 0; }\n.article-faq details[open] { background: #f9fafb; }\n.article-faq summary { cursor: pointer; font-weight: 600; padding: 8px 2px; }\n.article-faq details p { color: var(--text-muted, #64748b); margin: 2px 0 10px 18px; font-size: 14px; }\n\n/* \u5206\u4EAB\u680F */\n.share-bar { display: flex; gap: 12px; justify-content: center; margin: 20px 0; }\n.share-bar .share-btn { padding: 8px 20px; background: #fff; border: 1px solid var(--primary, #2563eb); color: var(--primary, #2563eb); border-radius: 10px; cursor: pointer; font-size: 13px; }\n.share-bar .share-btn:hover { background: var(--primary-weak, #eff6ff); }\n";
/** HTML 转义，防 XSS */
export declare function escapeHtml(v: unknown): string;
/** 从 blocks 提取 h2 生成 TOC 目录（≥3 个 h2 才输出），用 <details> 小屏折叠 */
export declare function generateToc(blocks: ContentBlock[]): string;
/** 估算阅读时长（中文 300 字/分钟），返回分钟数 */
export declare function readingTime(blocks: ContentBlock[]): number;
/** 渲染整个 content blocks 数组为 HTML 字符串（自动加 TOC） */
export declare function renderArticleBlocks(blocks: ContentBlock[]): string;
/** 渲染底部 CTA 卡片 HTML（文案全可配置） */
export declare function renderArticleCta(config: CtaConfig | undefined): string;
/** 链接项 */
export interface LinkItem {
    id?: string | number;
    label: string;
    url: string;
    kind?: string;
}
/** 渲染推广链接区（主按钮常显 + 更多折叠，opts 可覆盖全部文案/样式） */
export declare function renderArticleLinks(links: unknown, opts?: {
    note?: string;
    hideNote?: boolean;
    primaryClass?: string;
    moreText?: string;
    adLabel?: string;
}): string;
/** FAQ 项 */
export interface FaqItem {
    q: string;
    a: string;
}
/** 渲染 FAQ 面板（opts.mode='collapse' 折叠默认 / 'expand' 全展开） */
export declare function renderFaqSection(faq: unknown, opts?: {
    mode?: 'collapse' | 'expand';
    title?: string;
}): string;
/** 分享/收藏/纠错按钮栏 */
export declare function renderShareBar(article: {
    id: string;
    title: string;
    summary?: string;
}, opts?: {
    shareUrl?: string;
}): string;
/** 生成 Article + FAQPage JSON-LD 结构化数据（SEO/GEO） */
export declare function articleJsonLd(article: {
    id: string;
    title: string;
    summary: string;
    createdAt: string;
    updatedAt?: string;
    category?: string;
    tags?: string[];
    faq?: {
        q: string;
        a: string;
    }[];
    firstImage?: string;
}, site: {
    name: string;
    url: string;
    logo?: string;
}): string;
/** 安全 JSON 解析（失败返回 []） */
export declare function flattenToStrings(v: unknown): any[];
/** 安全解析 FAQ（[{q,a}]） */
export declare function flattenFaq(v: unknown): {
    q: string;
    a: string;
}[];
/** 安全解析链接（[{label,url,kind}]） */
export declare function flattenLinks(v: unknown): {
    label: string;
    url: string;
    kind?: string;
}[];
/** 安全解析文章行（content/links/faq 可能是 JSON 字符串或对象） */
export declare function safeArticle<T extends Record<string, any>>(row: T): T & {
    content: any[];
    links: any[];
    faq: any[];
};
/**
 * 客户端事件委托绑定（仅浏览器环境调用）
 * 绑定：更多折叠 / 复制链接 / 纠错按钮
 * opts: { reportUrl?: string, onTrackClick?: (linkId) => void }
 */
export declare function initArticleActions(root?: ParentNode, opts?: {
    reportUrl?: string;
    onTrackClick?: (linkId: string) => void;
}): void;
