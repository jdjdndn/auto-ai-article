// ============================================================
// 性能基准测试 — 测量关键操作的耗时
// 运行：npm run build && node bench/benchmark.mjs
// ============================================================

import {
  aggregateStats,
  renderStatsMarkdown,
  renderStatsHtml,
  extractJson,
  scoreArticle,
  computeRelatedArticles,
} from '../dist/index.js'

function bench(label, fn, iterations = 1000) {
  // warmup
  for (let i = 0; i < 10; i++) fn()

  const start = process.hrtime.bigint()
  for (let i = 0; i < iterations; i++) fn()
  const end = process.hrtime.bigint()

  const totalMs = Number(end - start) / 1e6
  const avgMs = totalMs / iterations
  const opsPerSec = Math.round(1000 / avgMs)
  console.log(`  ${label}: ${avgMs.toFixed(4)}ms/op (${opsPerSec} ops/s, ${iterations} iterations)`)
  return { label, avgMs, opsPerSec, iterations }
}

function generateLogs(n) {
  const logs = []
  const providers = ['cloudflare-binding', 'openrouter', 'local']
  const projects = ['172', 'hm', 'yk', 'kd', 'article-site']
  const reasons = ['timeout', 'quota_exceeded', 'server_error', 'invalid_request', 'unknown']
  for (let i = 0; i < n; i++) {
    logs.push({
      project: projects[i % projects.length],
      provider: providers[i % providers.length],
      success: i % 5 !== 0,
      wordCount: 800 + (i % 1200),
      durationMs: 5000 + (i % 30000),
      tokensUsed: 1000 + (i % 4000),
      failReason: i % 5 === 0 ? reasons[i % reasons.length] : undefined,
      timestamp: new Date(Date.now() - i * 3600000).toISOString(),
    })
  }
  return logs
}

function generateArticleText() {
  let text = '# 如何选择合适的号卡套餐\n\n'
  for (let i = 0; i < 20; i++) {
    text += `## 第${i + 1}节\n这是第${i + 1}段内容，包含足够的信息密度和实质性内容，用于测试质量评分性能。2024年市场上有超过100种号卡套餐，月租从19元到99元不等。\n\n`
  }
  return text
}

function generateCandidates(n) {
  const candidates = []
  for (let i = 0; i < n; i++) {
    candidates.push({
      id: i + 1,
      title: `文章标题${i}`,
      category: i % 3 === 0 ? '号卡' : '信用卡',
      tags: i % 2 === 0 ? ['流量卡', '性价比'] : ['优惠', '推荐'],
      publishedAt: new Date(Date.now() - i * 86400000).toISOString(),
    })
  }
  return candidates
}

console.log('=== ai-article-pipeline 性能基准测试 ===\n')

// 1. 统计聚合
console.log('📊 统计聚合 (aggregateStats)')
for (const n of [100, 1000, 10000]) {
  const logs = generateLogs(n)
  bench(`  ${n} 条日志`, () => aggregateStats(logs), n > 1000 ? 100 : 1000)
}

// 2. Markdown 面板渲染
console.log('\n📝 Markdown 面板渲染 (renderStatsMarkdown)')
for (const n of [100, 1000, 10000]) {
  const summary = aggregateStats(generateLogs(n))
  bench(`  ${n} 条日志聚合结果`, () => renderStatsMarkdown(summary), 1000)
}

// 3. HTML 面板渲染
console.log('\n🌐 HTML 面板渲染 (renderStatsHtml)')
for (const n of [100, 1000, 10000]) {
  const summary = aggregateStats(generateLogs(n))
  bench(`  ${n} 条日志聚合结果`, () => renderStatsHtml(summary), 1000)
}

// 4. JSON 解析
console.log('\n🔍 JSON 解析 (extractJson)')
const jsonInputs = [
  '{"title":"test","content":"hello"}',
  '```json\n{"title":"test","blocks":[]}\n```',
  '<think>reasoning</think>\n{"result":"ok"}',
  JSON.stringify({ a: 1, b: [2, 3], c: { d: 'e' } }),
]
bench('  小 JSON', () => { for (const j of jsonInputs) extractJson(j) }, 10000)

const largeJson = JSON.stringify({ blocks: Array.from({ length: 50 }, (_, i) => ({ type: 'p', text: `段落${i}` })) })
bench('  大 JSON (50 blocks)', () => extractJson(largeJson), 10000)

// 5. 质量评分
console.log('\n⭐ 质量评分 (scoreArticle)')
const articleText = generateArticleText()
const recent = Array.from({ length: 10 }, (_, i) => `近期文章${i}的内容，这是一段测试文本。`)
bench('  单篇文章', () => scoreArticle(articleText, { recentArticles: recent }), 1000)

// 6. 相关文章计算
console.log('\n🔗 相关文章计算 (computeRelatedArticles)')
const article = { title: '测试文章标题：如何选择合适的号卡套餐', category: '号卡', tags: ['流量卡', '性价比'] }
for (const n of [50, 200, 1000]) {
  const candidates = generateCandidates(n)
  bench(`  ${n} 候选`, () => computeRelatedArticles(article, candidates, { limit: 5 }), n > 200 ? 100 : 1000)
}

console.log('\n✅ 基准测试完成')
