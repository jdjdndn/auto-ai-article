// ============================================================
// 生成统计聚合 — 成功率/失败分布/平台稳定性/项目统计/每日趋势
// 公共能力：从运行日志聚合统计，输出 markdown 面板
// ============================================================

export interface RunLogEntry {
  project: string
  provider: string
  success: boolean
  wordCount: number
  durationMs: number
  tokensUsed?: number
  failReason?: string
  timestamp: string
}

export interface StatSummary {
  totalRuns: number
  successRate: number
  failReasons: Array<{ reason: string; count: number }>
  providerStats: Array<{
    provider: string
    runs: number
    successRate: number
    avgDurationMs: number
    avgTokens: number
  }>
  projectStats: Array<{ project: string; runs: number; successRate: number }>
  dailyTrend: Array<{ date: string; runs: number; successRate: number }>
}

export function aggregateStats(logs: RunLogEntry[]): StatSummary {
  const totalRuns = logs.length
  const successes = logs.filter((l) => l.success)
  const successRate = totalRuns ? successes.length / totalRuns : 0

  const failMap = new Map<string, number>()
  for (const l of logs) {
    if (!l.success && l.failReason) {
      failMap.set(l.failReason, (failMap.get(l.failReason) || 0) + 1)
    }
  }
  const failReasons = [...failMap.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)

  const providerMap = new Map<string, RunLogEntry[]>()
  for (const l of logs) {
    if (!providerMap.has(l.provider)) providerMap.set(l.provider, [])
    providerMap.get(l.provider)!.push(l)
  }
  const providerStats = [...providerMap.entries()]
    .map(([provider, entries]) => {
      const s = entries.filter((e) => e.success)
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
      }
    })
    .sort((a, b) => b.runs - a.runs)

  const projectMap = new Map<string, RunLogEntry[]>()
  for (const l of logs) {
    if (!projectMap.has(l.project)) projectMap.set(l.project, [])
    projectMap.get(l.project)!.push(l)
  }
  const projectStats = [...projectMap.entries()]
    .map(([project, entries]) => {
      const s = entries.filter((e) => e.success)
      return { project, runs: entries.length, successRate: entries.length ? s.length / entries.length : 0 }
    })
    .sort((a, b) => b.runs - a.runs)

  const dayMap = new Map<string, RunLogEntry[]>()
  for (const l of logs) {
    const day = l.timestamp.slice(0, 10)
    if (!dayMap.has(day)) dayMap.set(day, [])
    dayMap.get(day)!.push(l)
  }
  const dailyTrend = [...dayMap.entries()]
    .map(([date, entries]) => {
      const s = entries.filter((e) => e.success)
      return { date, runs: entries.length, successRate: entries.length ? s.length / entries.length : 0 }
    })
    .sort((a, b) => a.date.localeCompare(b.date))

  return { totalRuns, successRate, failReasons, providerStats, projectStats, dailyTrend }
}

export function renderStatsMarkdown(summary: StatSummary): string {
  const pct = (r: number) => `${(r * 100).toFixed(1)}%`
  let md = `## 生成统计\n\n`
  md += `- 总运行: ${summary.totalRuns}\n- 成功率: ${pct(summary.successRate)}\n\n`

  md += `### 失败原因分布\n\n`
  md += `| 原因 | 次数 |\n|------|------|\n`
  for (const f of summary.failReasons) md += `| ${f.reason} | ${f.count} |\n`

  md += `\n### 平台稳定性\n\n`
  md += `| 平台 | 次数 | 成功率 | 平均耗时 | 平均Token |\n|------|------|--------|----------|----------|\n`
  for (const p of summary.providerStats)
    md += `| ${p.provider} | ${p.runs} | ${pct(p.successRate)} | ${p.avgDurationMs}ms | ${p.avgTokens} |\n`

  md += `\n### 每日趋势\n\n`
  md += `| 日期 | 次数 | 成功率 |\n|------|------|--------|\n`
  for (const d of summary.dailyTrend) md += `| ${d.date} | ${d.runs} | ${pct(d.successRate)} |\n`

  return md
}

/**
 * 将 RunLogInput（管线运行日志）转换为 RunLogEntry（统计聚合输入）。
 * 缺失字段以合理默认值填充。
 */
export function fromRunLogInput(input: import('./types.js').RunLogInput, project = 'unknown'): RunLogEntry {
  return {
    project,
    provider: input.model ?? 'unknown',
    success: input.fail === 0 || (input.ok != null && input.ok > 0 && (input.fail ?? 0) === 0),
    wordCount: input.total ?? 0,
    durationMs: 0,
    tokensUsed: undefined,
    failReason: input.error ?? undefined,
    timestamp: input.runAt ?? new Date().toISOString(),
  }
}

/**
 * 生成独立 HTML 运营面板（纯 HTML + 内联 CSS，无外部依赖）。
 * 可直接写入 .html 文件用浏览器打开，或作为 HTTP 响应体返回。
 */
export function renderStatsHtml(summary: StatSummary, title = 'AI 文章生成运营面板'): string {
  const pct = (r: number) => `${(r * 100).toFixed(1)}%`
  const rateColor = (r: number) => (r >= 0.8 ? '#22c55e' : r >= 0.6 ? '#f59e0b' : '#ef4444')
  const maxFail = Math.max(1, ...summary.failReasons.map((f) => f.count))
  const maxDailyRuns = Math.max(1, ...summary.dailyTrend.map((d) => d.runs))

  const failBars = summary.failReasons
    .map(
      (f) => `
        <div class="bar-row">
          <span class="bar-label">${escapeHtml(f.reason)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(f.count / maxFail) * 100}%;background:#ef4444"></div></div>
          <span class="bar-value">${f.count}</span>
        </div>`,
    )
    .join('')

  const providerRows = summary.providerStats
    .map(
      (p) => `
        <tr>
          <td>${escapeHtml(p.provider)}</td>
          <td>${p.runs}</td>
          <td style="color:${rateColor(p.successRate)}">${pct(p.successRate)}</td>
          <td>${p.avgDurationMs}ms</td>
          <td>${p.avgTokens}</td>
        </tr>`,
    )
    .join('')

  const projectRows = summary.projectStats
    .map(
      (p) => `
        <tr>
          <td>${escapeHtml(p.project)}</td>
          <td>${p.runs}</td>
          <td style="color:${rateColor(p.successRate)}">${pct(p.successRate)}</td>
        </tr>`,
    )
    .join('')

  const dailyBars = summary.dailyTrend
    .map(
      (d) => `
        <div class="day-col" title="${d.date}: ${d.runs}次, ${pct(d.successRate)}">
          <div class="day-bar" style="height:${(d.runs / maxDailyRuns) * 120}px;background:${rateColor(d.successRate)}"></div>
          <span class="day-label">${d.date.slice(5)}</span>
        </div>`,
    )
    .join('')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
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
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="updated">更新时间：${new Date().toLocaleString('zh-CN')}</div>

  <div class="cards">
    <div class="card"><div class="label">总运行</div><div class="value">${summary.totalRuns}</div></div>
    <div class="card"><div class="label">成功率</div><div class="value" style="color:${rateColor(summary.successRate)}">${pct(summary.successRate)}</div></div>
    <div class="card"><div class="label">失败原因数</div><div class="value">${summary.failReasons.length}</div></div>
    <div class="card"><div class="label">平台数</div><div class="value">${summary.providerStats.length}</div></div>
    <div class="card"><div class="label">项目数</div><div class="value">${summary.projectStats.length}</div></div>
  </div>

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
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
