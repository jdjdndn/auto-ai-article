import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createPipeline, type PipelineDB } from '../src/pipeline.js'
import type { AiMessage, GeneratedArticle, InsertResult, RunLogInput, Seed, SeedInput } from '../src/types.js'

function makeSeed(id: number, raw: string): Seed {
  return { id, raw, category: '优惠', template: 'auto', status: 'pending', publishAt: null, expiresAt: null, articleId: null, error: null, source: 'test', fp: '', createdAt: '', updatedAt: '' }
}

function mockDb(seeds: Seed[]): PipelineDB & { inserted: GeneratedArticle[]; failed: { id: number; error: string }[] } {
  const inserted: GeneratedArticle[] = []
  const failed: { id: number; error: string }[] = []
  return {
    inserted,
    failed,
    async fetchPendingSeeds(size) { return seeds.filter((s) => s.status === 'pending').slice(0, size) },
    async insertSeeds(items: SeedInput[]) { return { added: items.length } },
    async markSeedDone() {},
    async markSeedFailed(id, error) { failed.push({ id, error }) },
    async insertArticles(articles: GeneratedArticle[]): Promise<InsertResult> {
      inserted.push(...articles)
      return { total: articles.length, created: articles.length, failed: 0, results: articles.map((_, i) => ({ id: `id-${i}`, ok: true })) }
    },
    async insertRunLog() {},
  }
}

const GOOD_ARTICLE_JSON = JSON.stringify({
  title: '套餐详解',
  summary: '月租29元包含100GB流量',
  content: [
    { type: 'h2', text: '资费' },
    { type: 'text', text: '月租29元包含100GB流量，合约期12个月。月租29元包含100GB流量，合约期12个月。月租29元包含100GB流量，合约期12个月。月租29元包含100GB流量，合约期12个月。月租29元包含100GB流量，合约期12个月。月租29元包含100GB流量，合约期12个月。' },
    { type: 'h2', text: '对比' },
    { type: 'text', text: '套餐A 29元100GB，套餐B 39元150GB。套餐A 29元100GB，套餐B 39元150GB。套餐A 29元100GB，套餐B 39元150GB。' },
  ],
  template: 'deal',
  category: '优惠',
  tags: [],
  faq: [],
  links: [],
})

const CLICHE_ARTICLE_JSON = JSON.stringify({
  title: '浅谈发展',
  summary: '随着时代的发展',
  content: [
    { type: 'text', text: '首先，随着时代的发展，我们不难发现，综上所述，赋能抓手闭环是底层逻辑。首先，随着时代的发展，我们不难发现，综上所述，赋能抓手闭环是底层逻辑。' },
    { type: 'text', text: '其次，值得注意的是，在当今的背景下，不仅而且，希望对你有所帮助。其次，值得注意的是，在当今的背景下，不仅而且，希望对你有所帮助。' },
    { type: 'text', text: '最后，总而言之，作为AI，人工智能时代的发展，天花板和抓手是关键。最后，总而言之，作为AI，人工智能时代的发展，天花板和抓手是关键。' },
  ],
  template: 'default',
  category: '优惠',
  tags: [],
  faq: [],
  links: [],
})

describe('pipeline 质量门控', () => {
  it('低分文章跳过入库并标记素材失败', async () => {
    const db = mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')])
    const pipeline = createPipeline(db, {
      ai: { client: async () => CLICHE_ARTICLE_JSON },
      target: 1,
      quality: { threshold: 60 },
    })
    const result = await pipeline.run()
    assert.equal(result.ok, 0)
    assert.equal(result.fail, 1)
    assert.equal(db.inserted.length, 0)
    assert.ok(db.failed.length === 1)
    assert.ok(db.failed[0].error.includes('质量不达标'))
  })

  it('高分文章正常入库', async () => {
    const db = mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')])
    const pipeline = createPipeline(db, {
      ai: { client: async () => GOOD_ARTICLE_JSON },
      target: 1,
      quality: { threshold: 60 },
    })
    const result = await pipeline.run()
    assert.equal(result.ok, 1)
    assert.equal(db.inserted.length, 1)
    assert.equal(db.failed.length, 0)
  })
})

describe('pipeline 搜索词注入', () => {
  it('suggestTopics 的 user content 包含搜索词', async () => {
    let captured: AiMessage[] = []
    const pipeline = createPipeline(mockDb([]), {
      ai: { client: async (msgs) => { captured = msgs; return JSON.stringify([{ title: 't', angle: 'a', category: '优惠' }]) } },
      searchTerms: [{ query: '套餐推荐', clicks: 10, impressions: 100, ctr: 0.1, position: 1 }],
    })
    await pipeline.suggestTopics()
    const userContent = captured[1]?.content || ''
    assert.ok(userContent.includes('套餐推荐'), 'user content 应包含搜索词')
    assert.ok(userContent.includes('月搜'), 'user content 应包含搜索量提示')
  })

  it('无搜索词时 user content 不注入', async () => {
    let captured: AiMessage[] = []
    const pipeline = createPipeline(mockDb([]), {
      ai: { client: async (msgs) => { captured = msgs; return JSON.stringify([{ title: 't', angle: 'a', category: '优惠' }]) } },
    })
    await pipeline.suggestTopics()
    const userContent = captured[1]?.content || ''
    assert.ok(!userContent.includes('月搜'))
  })
})
