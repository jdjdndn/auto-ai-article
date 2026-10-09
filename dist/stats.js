"use strict";
// ============================================================
// 生成统计聚合 — 成功率/失败分布/平台稳定性/项目统计/每日趋势
// 公共能力：从运行日志聚合统计，输出 markdown 面板
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.aggregateStats = aggregateStats;
exports.renderStatsMarkdown = renderStatsMarkdown;
exports.fromRunLogInput = fromRunLogInput;
exports.exportStatsCsv = exportStatsCsv;
exports.exportStatsJson = exportStatsJson;
exports.renderStatsHtml = renderStatsHtml;
function aggregateStats(logs, filter) {
    let filtered = logs;
    if (filter?.project)
        filtered = filtered.filter((l) => l.project === filter.project);
    if (filter?.from) {
        const from = filter.from;
        filtered = filtered.filter((l) => l.timestamp.slice(0, 10) >= from);
    }
    if (filter?.to) {
        const to = filter.to;
        filtered = filtered.filter((l) => l.timestamp.slice(0, 10) <= to);
    }
    const totalRuns = filtered.length;
    const successes = filtered.filter((l) => l.success);
    const successRate = totalRuns ? successes.length / totalRuns : 0;
    const failMap = new Map();
    for (const l of filtered) {
        if (!l.success && l.failReason) {
            failMap.set(l.failReason, (failMap.get(l.failReason) || 0) + 1);
        }
    }
    const failReasons = [...failMap.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count);
    const providerMap = new Map();
    for (const l of filtered) {
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
    for (const l of filtered) {
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
    for (const l of filtered) {
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
/**
 * 将 RunLogInput（管线运行日志）转换为 RunLogEntry（统计聚合输入）。
 * 缺失字段以合理默认值填充。
 */
function fromRunLogInput(input, project = 'unknown') {
    return {
        project,
        provider: input.model ?? 'unknown',
        success: input.fail === 0 || (input.ok != null && input.ok > 0 && (input.fail ?? 0) === 0),
        wordCount: input.total ?? 0,
        durationMs: 0,
        tokensUsed: undefined,
        failReason: input.error ?? undefined,
        timestamp: input.runAt ?? new Date().toISOString(),
    };
}
function exportStatsCsv(summary) {
    const pct = (r) => `${(r * 100).toFixed(1)}%`;
    const esc = (v) => {
        const s = String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [];
    lines.push([esc('指标'), esc('值')].join(','));
    lines.push([esc('总运行'), esc(summary.totalRuns)].join(','));
    lines.push([esc('成功率'), esc(pct(summary.successRate))].join(','));
    lines.push([esc('失败原因数'), esc(summary.failReasons.length)].join(','));
    lines.push([esc('平台数'), esc(summary.providerStats.length)].join(','));
    lines.push([esc('项目数'), esc(summary.projectStats.length)].join(','));
    lines.push('');
    lines.push([esc('日期'), esc('运行次数'), esc('成功率')].join(','));
    for (const d of summary.dailyTrend)
        lines.push([esc(d.date), esc(d.runs), esc(pct(d.successRate))].join(','));
    lines.push('');
    lines.push([esc('失败原因'), esc('次数')].join(','));
    for (const f of summary.failReasons)
        lines.push([esc(f.reason), esc(f.count)].join(','));
    return `${lines.join('\n')}\n`;
}
function exportStatsJson(summary) {
    return JSON.stringify(summary, null, 2);
}
/**
 * 生成独立 HTML 运营面板（纯 HTML + 内联 CSS，无外部依赖）。
 * 可直接写入 .html 文件用浏览器打开，或作为 HTTP 响应体返回。
 */
function renderStatsHtml(summary, title = 'AI 文章生成运营面板', alertInfo) {
    const pct = (r) => `${(r * 100).toFixed(1)}%`;
    const rateColor = (r) => (r >= 0.8 ? '#22c55e' : r >= 0.6 ? '#f59e0b' : '#ef4444');
    const maxFail = Math.max(1, ...summary.failReasons.map((f) => f.count));
    const maxDailyRuns = Math.max(1, ...summary.dailyTrend.map((d) => d.runs));
    const truncReason = (reason) => (reason.length > 50 ? `${reason.slice(0, 50)}…` : reason);
    const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(exportStatsCsv(summary))}`;
    const jsonHref = `data:text/json;charset=utf-8,${encodeURIComponent(exportStatsJson(summary))}`;
    const failBars = summary.failReasons
        .map((f) => `
        <div class="bar-row" title="${escapeHtml(f.reason)}">
          <span class="bar-label">${escapeHtml(truncReason(f.reason))}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(f.count / maxFail) * 100}%;background:#ef4444"></div></div>
          <span class="bar-value">${f.count}</span>
        </div>`)
        .join('');
    const providerRows = summary.providerStats
        .map((p) => `
        <tr>
          <td>${escapeHtml(p.provider)}</td>
          <td>${p.runs}</td>
          <td style="color:${rateColor(p.successRate)}">${pct(p.successRate)}</td>
          <td>${p.avgDurationMs}ms</td>
          <td>${p.avgTokens}</td>
        </tr>`)
        .join('');
    const projectRows = summary.projectStats
        .map((p) => `
        <tr>
          <td>${escapeHtml(p.project)}</td>
          <td>${p.runs}</td>
          <td style="color:${rateColor(p.successRate)}">${pct(p.successRate)}</td>
        </tr>`)
        .join('');
    const dailyBars = summary.dailyTrend
        .map((d) => `
        <div class="day-col" title="${d.date}: ${d.runs}次, ${pct(d.successRate)}">
          <div class="day-bar" style="height:${(d.runs / maxDailyRuns) * 120}px;background:${rateColor(d.successRate)}"></div>
          <span class="day-label">${d.date.slice(5)}</span>
        </div>`)
        .join('');
    const alertSection = alertInfo
        ? `
  <div class="section">
    <h2>告警状态</h2>
    <div class="alert-grid">
      <div class="alert-item"><span class="alert-label">成功率阈值</span><span class="alert-value">${alertInfo.threshold != null ? pct(alertInfo.threshold) : '未配置'}</span></div>
      <div class="alert-item"><span class="alert-label">Webhook</span><span class="alert-value">${alertInfo.webhookConfigured ? '已配置' : '未配置'}</span></div>
      <div class="alert-item"><span class="alert-label">最近触发</span><span class="alert-value">${alertInfo.lastTriggered ? escapeHtml(alertInfo.lastTriggered) : '从未'}</span></div>
    </div>
  </div>`
        : '';
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>${escapeHtml(title)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#1e293b;padding:24px}
  h1{font-size:24px;margin-bottom:8px}
  .updated{color:#64748b;font-size:13px;margin-bottom:24px}
  .cards{display:flex;gap:16px;margin-bottom:32px;flex-wrap:wrap}
  .card{background:#fff;border-radius:12px;padding:20px 28px;box-shadow:0 1px 3px rgba(0,0,0,.08);min-width:160px}
  .card .label{font-size:13px;color:#64748b;margin-bottom:4px}
  .card .value{font-size:32px;font-weight:700}
  .section{background:#fff;border-radius:12px;padding:20px 24px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  .section h2{font-size:16px;margin-bottom:16px;color:#334155}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #e2e8f0}
  th{color:#64748b;font-weight:600;font-size:13px}
  .bar-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
  .bar-label{width:200px;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bar-track{flex:1;height:20px;background:#f1f5f9;border-radius:4px;overflow:hidden}
  .bar-fill{height:100%;border-radius:4px;transition:width .3s}
  .bar-value{width:32px;text-align:right;font-size:13px;font-weight:600}
  .trend-chart{display:flex;align-items:flex-end;gap:4px;height:160px;overflow-x:auto;padding-bottom:4px}
  .day-col{display:flex;flex-direction:column;align-items:center;min-width:36px}
  .day-bar{width:20px;border-radius:3px 3px 0 0;min-height:2px}
  .day-label{font-size:10px;color:#94a3b8;margin-top:4px}
  .export-bar{display:flex;gap:8px;margin-bottom:20px}
  .btn{display:inline-block;padding:8px 16px;background:#3b82f6;color:#fff;border-radius:6px;font-size:14px;text-decoration:none}
  .btn:hover{background:#2563eb}
  .alert-grid{display:flex;gap:24px;flex-wrap:wrap}
  .alert-item{display:flex;flex-direction:column;gap:4px}
  .alert-label{font-size:13px;color:#64748b}
  .alert-value{font-size:16px;font-weight:600}
  @media (prefers-color-scheme: dark){
    body{background:#0f172a;color:#e2e8f0}
    .card{background:#1e293b;box-shadow:0 1px 3px rgba(0,0,0,.3)}
    .section{background:#1e293b;box-shadow:0 1px 3px rgba(0,0,0,.2)}
    .card .label{color:#94a3b8}
    .section h2{color:#cbd5e1}
    th{color:#94a3b8}
    th,td{border-bottom:1px solid #334155}
    .bar-track{background:#334155}
    .updated{color:#94a3b8}
    .day-label{color:#64748b}
    .alert-label{color:#94a3b8}
    .btn{background:#2563eb}
    .btn:hover{background:#3b82f6}
  }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="updated">更新时间：${new Date().toLocaleString('zh-CN')}</div>

  <div class="export-bar">
    <a class="btn" href="${csvHref}" download="stats.csv">导出 CSV</a>
    <a class="btn" href="${jsonHref}" download="stats.json">导出 JSON</a>
  </div>

  <div class="cards">
    <div class="card"><div class="label">总运行</div><div class="value">${summary.totalRuns}</div></div>
    <div class="card"><div class="label">成功率</div><div class="value" style="color:${rateColor(summary.successRate)}">${pct(summary.successRate)}</div></div>
    <div class="card"><div class="label">失败原因数</div><div class="value">${summary.failReasons.length}</div></div>
    <div class="card"><div class="label">平台数</div><div class="value">${summary.providerStats.length}</div></div>
    <div class="card"><div class="label">项目数</div><div class="value">${summary.projectStats.length}</div></div>
  </div>
${alertSection}
  <div class="section">
    <h2>每日趋势</h2>
    <div class="trend-chart">${dailyBars || '<p style="color:#94a3b8">无数据</p>'}</div>
  </div>

  <div class="section">
    <h2>失败原因分布</h2>
    ${failBars || '<p style="color:#94a3b8">无失败记录</p>'}
  </div>

  <div class="section">
    <h2>平台稳定性</h2>
    <table>
      <thead><tr><th>平台</th><th>次数</th><th>成功率</th><th>平均耗时</th><th>平均Token</th></tr></thead>
      <tbody>${providerRows || '<tr><td colspan="5" style="color:#94a3b8">无数据</td></tr>'}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>项目统计</h2>
    <table>
      <thead><tr><th>项目</th><th>次数</th><th>成功率</th></tr></thead>
      <tbody>${projectRows || '<tr><td colspan="3" style="color:#94a3b8">无数据</td></tr>'}</tbody>
    </table>
  </div>
</body>
</html>`;
}
function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
