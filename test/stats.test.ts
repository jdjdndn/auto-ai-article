import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  aggregateStats,
  exportStatsCsv,
  exportStatsJson,
  renderStatsHtml,
  renderStatsMarkdown,
  type RunLogEntry,
} from '../src/stats.js'

const logs: RunLogEntry[] = [
  { project: 'p1', provider: 'cf', success: true, wordCount: 800, durationMs: 1000, timestamp: '2026-10-01T08:00:00Z' },
  { project: 'p1', provider: 'cf', success: false, wordCount: 0, durationMs: 2000, failReason: 'timeout', timestamp: '2026-10-01T09:00:00Z' },
  { project: 'p2', provider: 'or', success: true, wordCount: 900, durationMs: 3000, timestamp: '2026-10-02T08:00:00Z' },
]

describe('aggregateStats', () => {
  it('总运行数与成功率', () => {
    const s = aggregateStats(logs)
    assert.equal(s.totalRuns, 3)
    assert.ok(Math.abs(s.successRate - 2 / 3) < 1e-9)
  })

  it('失败原因聚合', () => {
    assert.deepEqual(aggregateStats(logs).failReasons, [{ reason: 'timeout', count: 1 }])
  })

  it('平台统计按运行次数降序', () => {
    const s = aggregateStats(logs)
    assert.equal(s.providerStats[0].provider, 'cf')
    assert.equal(s.providerStats[0].runs, 2)
  })

  it('每日趋势按日期升序', () => {
    assert.deepEqual(
      aggregateStats(logs).dailyTrend.map((d) => d.date),
      ['2026-10-01', '2026-10-02'],
    )
  })

  it('空日志零值安全', () => {
    const s = aggregateStats([])
    assert.equal(s.totalRuns, 0)
    assert.equal(s.successRate, 0)
    assert.deepEqual(s.providerStats, [])
  })

  it('filter from 过滤日期下界', () => {
    const s = aggregateStats(logs, { from: '2026-10-02' })
    assert.equal(s.totalRuns, 1)
    assert.equal(s.projectStats[0].project, 'p2')
  })

  it('filter to 过滤日期上界', () => {
    const s = aggregateStats(logs, { to: '2026-10-01' })
    assert.equal(s.totalRuns, 2)
    assert.equal(s.projectStats[0].project, 'p1')
  })

  it('filter project 精确匹配', () => {
    const s = aggregateStats(logs, { project: 'p1' })
    assert.equal(s.totalRuns, 2)
    assert.equal(s.projectStats.length, 1)
    assert.equal(s.projectStats[0].project, 'p1')
  })

  it('filter from/to 闭区间', () => {
    const s = aggregateStats(logs, { from: '2026-10-01', to: '2026-10-01' })
    assert.equal(s.totalRuns, 2)
  })

  it('无 filter 行为不变', () => {
    assert.deepEqual(aggregateStats(logs), aggregateStats(logs, undefined))
  })

  it('空 filter 对象行为不变', () => {
    assert.deepEqual(aggregateStats(logs), aggregateStats(logs, {}))
  })
})

describe('renderStatsMarkdown', () => {
  it('包含关键指标', () => {
    const md = renderStatsMarkdown(aggregateStats(logs))
    assert.ok(md.includes('生成统计'))
    assert.ok(md.includes('成功率'))
    assert.ok(md.includes('timeout'))
  })
})

describe('exportStatsCsv', () => {
  it('包含表头', () => {
    const csv = exportStatsCsv(aggregateStats(logs))
    assert.ok(csv.includes('指标,值'))
    assert.ok(csv.includes('日期,运行次数,成功率'))
    assert.ok(csv.includes('失败原因,次数'))
  })

  it('包含关键指标', () => {
    const csv = exportStatsCsv(aggregateStats(logs))
    assert.ok(csv.includes('总运行'))
    assert.ok(csv.includes('成功率'))
  })

  it('含逗号值用双引号包裹', () => {
    const logsComma: RunLogEntry[] = [
      { project: 'p1', provider: 'cf', success: false, wordCount: 0, durationMs: 1000, failReason: 'rate limit, retry exhausted', timestamp: '2026-10-01T08:00:00Z' },
    ]
    const csv = exportStatsCsv(aggregateStats(logsComma))
    assert.ok(csv.includes('"rate limit, retry exhausted"'))
  })

  it('包含每日趋势数据', () => {
    const csv = exportStatsCsv(aggregateStats(logs))
    assert.ok(csv.includes('2026-10-01'))
    assert.ok(csv.includes('2026-10-02'))
  })

  it('包含失败原因数据', () => {
    const csv = exportStatsCsv(aggregateStats(logs))
    assert.ok(csv.includes('timeout'))
  })
})

describe('exportStatsJson', () => {
  it('可被 JSON.parse 还原', () => {
    const summary = aggregateStats(logs)
    const json = exportStatsJson(summary)
    assert.deepEqual(JSON.parse(json), summary)
  })
})

describe('renderStatsHtml', () => {
  it('含导出按钮', () => {
    const html = renderStatsHtml(aggregateStats(logs))
    assert.ok(html.includes('导出 CSV'))
    assert.ok(html.includes('导出 JSON'))
    assert.ok(html.includes('download="stats.csv"'))
    assert.ok(html.includes('download="stats.json"'))
    assert.ok(html.includes('data:text/csv'))
    assert.ok(html.includes('data:text/json'))
  })

  it('含 meta refresh 自动刷新', () => {
    const html = renderStatsHtml(aggregateStats(logs))
    assert.ok(html.includes('http-equiv="refresh"'))
    assert.ok(html.includes('content="60"'))
  })

  it('含深色模式 media query', () => {
    const html = renderStatsHtml(aggregateStats(logs))
    assert.ok(html.includes('@media (prefers-color-scheme: dark)'))
    assert.ok(html.includes('#0f172a'))
  })

  it('传 alertInfo 含告警区', () => {
    const html = renderStatsHtml(aggregateStats(logs), '面板', {
      threshold: 0.9,
      webhookConfigured: true,
      lastTriggered: '2026-10-01T12:00:00Z',
    })
    assert.ok(html.includes('告警状态'))
    assert.ok(html.includes('90.0%'))
    assert.ok(html.includes('已配置'))
    assert.ok(html.includes('2026-10-01T12:00:00Z'))
  })

  it('未传 alertInfo 不含告警区', () => {
    const html = renderStatsHtml(aggregateStats(logs))
    assert.ok(!html.includes('告警状态'))
  })

  it('失败原因 title 属性显示完整原因并截断显示', () => {
    const longReason = 'a'.repeat(60)
    const logsLong: RunLogEntry[] = [
      { project: 'p1', provider: 'cf', success: false, wordCount: 0, durationMs: 1000, failReason: longReason, timestamp: '2026-10-01T08:00:00Z' },
    ]
    const html = renderStatsHtml(aggregateStats(logsLong))
    assert.ok(html.includes(`title="${longReason}"`))
    assert.ok(html.includes(`${'a'.repeat(50)}…`))
  })
})
