"use strict";
// ============================================================
// 搜索词采集 — Google Search Console API + 搜索词注入选题
// 公共能力：定期拉搜索词数据，注入 topicPrompt 指导 AI 选题
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchSearchConsoleTerms = fetchSearchConsoleTerms;
exports.injectSearchTerms = injectSearchTerms;
/**
 * 从 Google Search Console API 拉搜索词数据
 * 需先在 Search Console 添加站点并验证所有权，再创建 OAuth2 service account
 */
async function fetchSearchConsoleTerms(siteUrl, authToken, opts = {}) {
    const days = opts.days ?? 28;
    const limit = opts.limit ?? 50;
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 86400000);
    const fmt = (d) => d.toISOString().slice(0, 10);
    const resp = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            startDate: fmt(startDate),
            endDate: fmt(endDate),
            dimensions: ['query'],
            rowLimit: limit,
        }),
    });
    if (!resp.ok) {
        const bodyText = await resp.text().catch(() => '');
        throw new Error(`Search Console API ${resp.status}: ${bodyText.slice(0, 200)}`);
    }
    const data = await resp.json();
    return (data.rows || []).map((r) => ({
        query: r.keys[0],
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
        position: r.position,
    }));
}
/**
 * 将搜索词注入 topicPrompt，让 AI 优先覆盖用户实际在搜的词
 */
function injectSearchTerms(prompt, terms, limit = 20) {
    if (!terms.length)
        return prompt;
    const top = terms.slice(0, limit);
    const termList = top.map((t, i) => `${i + 1}. ${t.query}（月搜${t.impressions}次）`).join('\n');
    return `${prompt}\n\n以下是用户实际在搜的词（按搜索量排序），优先围绕这些出主题：\n${termList}`;
}
