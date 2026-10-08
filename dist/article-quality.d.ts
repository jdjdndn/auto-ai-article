export interface QualityScore {
    total: number;
    details: {
        infoDensity: number;
        clicheDensity: number;
        structure: number;
        originality: number;
    };
    pass: boolean;
    clicheHits: string[];
}
export interface QualityOptions {
    /** 及格线（默认 60） */
    threshold?: number;
    /** 单维度最低分（默认 15） */
    minDimension?: number;
    /** 套话词表（默认用内置） */
    clicheWords?: string[];
    /** 近期文章正文，用于原创性比对 */
    recentArticles?: string[];
}
export declare function scoreArticle(content: string, opts?: QualityOptions): QualityScore;
