import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { aggregateStats, renderStatsMarkdown, type RunLogEntry } from '../src/stats.js'

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
})

describe('renderStatsMarkdown', () => {
  it('包含关键指标', () => {
    const md = renderStatsMarkdown(aggregateStats(logs))
    assert.ok(md.includes('生成统计'))
    assert.ok(md.includes('成功率'))
    assert.ok(md.includes('timeout'))
  })
})
