export interface RelatedCandidate {
    id: string;
    title: string;
    summary?: string;
    category?: string;
    tags?: string[];
}
export interface RelatedOptions {
    /** 返回条数（默认 6） */
    limit?: number;
    /** 最低分过滤（默认 1：完全无关联的候选不进入结果） */
    minScore?: number;
    /** 分类相同权重（默认 3） */
    sameCategoryWeight?: number;
    /** 每个重叠 tag 权重（默认 2） */
    tagWeight?: number;
    /** 标题+摘要文本相似度（Jaccard）权重（默认 5） */
    textWeight?: number;
    /** 互补信号权重：同分类但 tags 无重叠且文本相似度低（默认 1.5） */
    complementWeight?: number;
    /** 文本相似度下限：低于此值的候选视为"不相似"（默认 0.06） */
    textSimilarityFloor?: number;
}
/**
 * 计算目标文章的相关文章，返回按分数降序的候选 id 列表。
 *
 * 评分维度（可配置权重）：
 *  - 分类相同：+sameCategoryWeight（强关联）
 *  - tags 重叠：每个相同 tag +tagWeight（主题强相关）
 *  - 文本相似：标题+摘要 2-gram Jaccard × textWeight（相似内容）
 *  - 互补信号：同分类且 tags 无重叠且文本不相似 → +complementWeight（同领域不同角度，
 *    如"省钱攻略"配"比价技巧"，避免清一色雷同文）
 */
export declare function computeRelatedArticles(article: Pick<RelatedCandidate, 'title' | 'summary' | 'category' | 'tags'>, candidates: RelatedCandidate[], opts?: RelatedOptions): string[];
