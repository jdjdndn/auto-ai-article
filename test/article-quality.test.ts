import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { scoreArticle } from '../src/article-quality.js'

describe('scoreArticle', () => {
  it('结构化 + 含数据的长文得分较高', () => {
    const content = [
      '# 套餐详解',
      '## 资费',
      '月租29元包含100GB流量，合约期12个月。',
      '## 对比',
      '- 套餐A 29元 100GB',
      '- 套餐B 39元 150GB',
      '补充说明内容。'.repeat(60),
    ].join('\n')
    const r = scoreArticle(content)
    assert.ok(r.details.structure > 0)
    assert.ok(r.details.infoDensity > 0)
    assert.equal(r.total, r.details.infoDensity + r.details.clicheDensity + r.details.structure + r.details.originality)
  })

  it('套话多则命中且 clicheDensity 下降', () => {
    const r = scoreArticle('首先，综上所述，随着时代的发展，赋能抓手闭环。')
    assert.ok(r.clicheHits.length > 0)
    assert.ok(r.details.clicheDensity < 25)
  })

  it('无近期文章时原创性给满分', () => {
    assert.equal(scoreArticle('随便内容').details.originality, 25)
  })

  it('与近期文章高度相似时原创性低', () => {
    const text = '月租29元包含100GB流量合约期12个月定向流量30GB'
    const r = scoreArticle(text, { recentArticles: [text] })
    assert.ok(r.details.originality < 10)
  })

  it('阈值极高时 pass=false', () => {
    assert.equal(scoreArticle('短内容', { threshold: 999 }).pass, false)
  })
})
