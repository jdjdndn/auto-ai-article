export interface SearchTerm {
    query: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}
export interface SearchTermsOptions {
    /** 拉取天数（默认 28） */
    days?: number;
    /** 返回条数（默认 50） */
    limit?: number;
}
/**
 * 从 Google Search Console API 拉搜索词数据
 * 需先在 Search Console 添加站点并验证所有权，再创建 OAuth2 service account
 */
export declare function fetchSearchConsoleTerms(siteUrl: string, authToken: string, opts?: SearchTermsOptions): Promise<SearchTerm[]>;
/**
 * 将搜索词注入 topicPrompt，让 AI 优先覆盖用户实际在搜的词
 */
export declare function injectSearchTerms(prompt: string, terms: SearchTerm[], limit?: number): string;
