export interface RssItem {
    title: string;
    link: string;
    description: string;
    pubDate: string;
}
/** fetch RSS feed 并解析为 item 数组 */
export declare function fetchRssFeed(url: string, timeoutMs?: number): Promise<RssItem[]>;
/** 从 HTML 提取正文：优先 <article>/<main>，否则取所有 <p> 拼接 */
export declare function extractArticleText(html: string): string;
/** 文本归一化：小写、去标点 */
export declare function normalizeText(text: unknown): string;
/** 文本相似度：bigram Jaccard，返回 0-1 */
export declare function textSimilarity(a: unknown, b: unknown): number;
