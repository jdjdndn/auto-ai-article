"use strict";
// ============================================================
// 文章质量评分 — 信息密度 + 套话密度 + 结构完整性 + 原创性
// 公共能力：生成后自动评分，低分切下一平台重生成，杜绝水文上线
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreArticle = scoreArticle;
const sources_js_1 = require("./sources.js");
const DEFAULT_CLICHE_WORDS = [
    '首先',
    '其次',
    '最后',
    '总之',
    '总而言之',
    '值得注意的是',
    '不难发现',
    '综上所述',
    '随着',
    '的发展',
    '在当今',
    '的背景下',
    '不仅',
    '而且',
    '赋能',
    '抓手',
    '闭环',
    '底层逻辑',
    '天花板',
    '作为AI',
    '作为语言模型',
    '人工智能时代',
    '希望对你有所帮助',
];
function countCliche(text, words) {
    const hits = [];
    for (const w of words) {
        if (text.includes(w))
            hits.push(w);
    }
    return hits;
}
function countInfoDensity(text) {
    const lines = text.split('\n').filter((l) => l.trim().length > 20);
    if (!lines.length)
        return 0;
    const infoLines = lines.filter((l) => /\d+[%元块年月日时分秒万亿千百]|v?\d+\.\d+|[A-Z]{2,}\d+/.test(l));
    return Math.min(25, Math.round((infoLines.length / lines.length) * 25));
}
function countStructure(text) {
    let score = 0;
    if (/^#\s+/m.test(text))
        score += 8;
    const h2Count = (text.match(/^##\s+/gm) || []).length;
    if (h2Count >= 2)
        score += 8;
    if (/^[-*]\s+/m.test(text))
        score += 5;
    if (text.trim().length > 800)
        score += 4;
    return Math.min(25, score);
}
function countOriginality(text, recent) {
    if (!recent.length)
        return 25;
    const sims = recent.map((r) => (0, sources_js_1.textSimilarity)(text, r));
    const maxSim = Math.max(...sims);
    return Math.round((1 - maxSim) * 25);
}
function scoreArticle(content, opts = {}) {
    const threshold = opts.threshold ?? 60;
    const minDim = opts.minDimension ?? 15;
    const cliches = opts.clicheWords ?? DEFAULT_CLICHE_WORDS;
    const recent = opts.recentArticles ?? [];
    const clicheHits = countCliche(content, cliches);
    const infoDensity = countInfoDensity(content);
    const clicheDensity = Math.max(0, 25 - clicheHits.length * 3);
    const structure = countStructure(content);
    const originality = countOriginality(content, recent);
    const total = infoDensity + clicheDensity + structure + originality;
    const pass = total >= threshold &&
        infoDensity >= minDim &&
        clicheDensity >= minDim &&
        structure >= minDim &&
        originality >= minDim;
    return { total, details: { infoDensity, clicheDensity, structure, originality }, pass, clicheHits };
}
