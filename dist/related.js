"use strict";
// ============================================================
// 相关文章计算 — 相似（分类/tags/词重叠）+ 互补（同分类不同 tags）混合评分
// 公共能力：article-site 与各子站 articles/[id].get.ts 统一接入，
// 替代"同分类兜底"的弱关联，输出按分数排序的相关文章 id 列表。
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeRelatedArticles = computeRelatedArticles;
const DEFAULT_OPTS = {
    limit: 6,
    minScore: 1,
    sameCategoryWeight: 3,
    tagWeight: 2,
    textWeight: 5,
    complementWeight: 1.5,
    textSimilarityFloor: 0.06,
};
// 中文按连续串切 2-gram，英文按词切小写；数字忽略（避免"2026""3 篇"类噪音）
function tokens(text) {
    const out = new Set();
    const cn = text.replace(/[^\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(Boolean);
    for (const seg of cn) {
        if (seg.length === 1)
            out.add(seg);
        else
            for (let i = 0; i < seg.length - 1; i++)
                out.add(seg.slice(i, i + 2));
    }
    const en = text.toLowerCase().match(/[a-z][a-z0-9]{1,}/g) || [];
    for (const w of en)
        out.add(w);
    return out;
}
function jaccard(a, b) {
    if (!a.size || !b.size)
        return 0;
    let inter = 0;
    for (const x of a)
        if (b.has(x))
            inter++;
    const union = a.size + b.size - inter;
    return union ? inter / union : 0;
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
function computeRelatedArticles(article, candidates, opts = {}) {
    const o = { ...DEFAULT_OPTS, ...opts };
    const self = new Set([article.title, article.summary || '']);
    const articleTok = tokens(`${article.title} ${article.summary || ''}`);
    const articleTags = new Set((article.tags || []).map((t) => String(t).trim()).filter(Boolean));
    const scored = candidates
        .filter((c) => c.id && String(c.id) !== '')
        .map((c) => {
        const candTok = tokens(`${c.title} ${c.summary || ''}`);
        const candTags = new Set((c.tags || []).map((t) => String(t).trim()).filter(Boolean));
        const sameCat = c.category && article.category && c.category === article.category;
        // tags 交集（去重计数）
        let tagHit = 0;
        for (const t of articleTags)
            if (candTags.has(t))
                tagHit++;
        const sim = jaccard(articleTok, candTok);
        const textScore = sim * o.textWeight;
        let score = 0;
        if (sameCat)
            score += o.sameCategoryWeight;
        score += tagHit * o.tagWeight;
        score += textScore;
        // 互补信号：同分类、tags 无重叠、文本不相似 → 视为"同领域互补"
        if (sameCat && tagHit === 0 && sim < o.textSimilarityFloor) {
            score += o.complementWeight;
        }
        return { id: c.id, score, sim };
    })
        .filter((x) => x.score >= o.minScore)
        .sort((a, b) => b.score - a.score || b.sim - a.sim);
    return scored.slice(0, o.limit).map((x) => x.id);
}
