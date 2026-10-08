"use strict";
// ============================================================
// 生成统计聚合 — 成功率/失败分布/平台稳定性/项目统计/每日趋势
// 公共能力：从运行日志聚合统计，输出 markdown 面板
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.aggregateStats = aggregateStats;
exports.renderStatsMarkdown = renderStatsMarkdown;
function aggregateStats(logs) {
    const totalRuns = logs.length;
    const successes = logs.filter((l) => l.success);
    const successRate = totalRuns ? successes.length / totalRuns : 0;
    const failMap = new Map();
    for (const l of logs) {
        if (!l.success && l.failReason) {
            failMap.set(l.failReason, (failMap.get(l.failReason) || 0) + 1);
        }
    }
    const failReasons = [...failMap.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count);
    const providerMap = new Map();
    for (const l of logs) {
        if (!providerMap.has(l.provider))
            providerMap.set(l.provider, []);
        providerMap.get(l.provider).push(l);
    }
    const providerStats = [...providerMap.entries()]
        .map(([provider, entries]) => {
        const s = entries.filter((e) => e.success);
        return {
            provider,
            runs: entries.length,
            successRate: entries.length ? s.length / entries.length : 0,
            avgDurationMs: entries.length
                ? Math.round(entries.reduce((sum, e) => sum + e.durationMs, 0) / entries.length)
                : 0,
            avgTokens: entries.length
                ? Math.round(entries.reduce((sum, e) => sum + (e.tokensUsed || 0), 0) / entries.length)
                : 0,
        };
    })
        .sort((a, b) => b.runs - a.runs);
    const projectMap = new Map();
    for (const l of logs) {
        if (!projectMap.has(l.project))
            projectMap.set(l.project, []);
        projectMap.get(l.project).push(l);
    }
    const projectStats = [...projectMap.entries()]
        .map(([project, entries]) => {
        const s = entries.filter((e) => e.success);
        return { project, runs: entries.length, successRate: entries.length ? s.length / entries.length : 0 };
    })
        .sort((a, b) => b.runs - a.runs);
    const dayMap = new Map();
    for (const l of logs) {
        const day = l.timestamp.slice(0, 10);
        if (!dayMap.has(day))
            dayMap.set(day, []);
        dayMap.get(day).push(l);
    }
    const dailyTrend = [...dayMap.entries()]
        .map(([date, entries]) => {
        const s = entries.filter((e) => e.success);
        return { date, runs: entries.length, successRate: entries.length ? s.length / entries.length : 0 };
    })
        .sort((a, b) => a.date.localeCompare(b.date));
    return { totalRuns, successRate, failReasons, providerStats, projectStats, dailyTrend };
}
function renderStatsMarkdown(summary) {
    const pct = (r) => `${(r * 100).toFixed(1)}%`;
    let md = `## 生成统计\n\n`;
    md += `- 总运行: ${summary.totalRuns}\n- 成功率: ${pct(summary.successRate)}\n\n`;
    md += `### 失败原因分布\n\n`;
    md += `| 原因 | 次数 |\n|------|------|\n`;
    for (const f of summary.failReasons)
        md += `| ${f.reason} | ${f.count} |\n`;
    md += `\n### 平台稳定性\n\n`;
    md += `| 平台 | 次数 | 成功率 | 平均耗时 | 平均Token |\n|------|------|--------|----------|----------|\n`;
    for (const p of summary.providerStats)
        md += `| ${p.provider} | ${p.runs} | ${pct(p.successRate)} | ${p.avgDurationMs}ms | ${p.avgTokens} |\n`;
    md += `\n### 每日趋势\n\n`;
    md += `| 日期 | 次数 | 成功率 |\n|------|------|--------|\n`;
    for (const d of summary.dailyTrend)
        md += `| ${d.date} | ${d.runs} | ${pct(d.successRate)} |\n`;
    return md;
}
