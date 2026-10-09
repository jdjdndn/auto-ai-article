import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeRelatedArticles } from '../src/related.js'

describe('computeRelatedArticles', () => {
  const article = { title: '联通 29 元大流量套餐攻略', summary: '月租便宜', category: '号卡', tags: ['联通', '流量'] }

  it('同分类同标签候选排最前', () => {
    const cands = [
      { id: 'b', title: '信用卡分期活动', category: '信用卡', tags: ['分期'] },
      { id: 'a', title: '联通套餐办理攻略', category: '号卡', tags: ['联通', '流量'] },
    ]
    assert.equal(computeRelatedArticles(article, cands)[0], 'a')
  })

  it('完全无关联候选被过滤', () => {
    const cands = [{ id: 'z', title: '天气不错', category: '其它', tags: ['生活'] }]
    assert.deepEqual(computeRelatedArticles(article, cands), [])
  })

  it('limit 生效', () => {
    const cands = Array.from({ length: 10 }, (_, i) => ({
      id: `id${i}`,
      title: '联通套餐攻略',
      category: '号卡',
      tags: ['联通'],
    }))
    assert.equal(computeRelatedArticles(article, cands, { limit: 3 }).length, 3)
  })

  it('空候选返回空数组', () => {
    assert.deepEqual(computeRelatedArticles(article, []), [])
  })

  it('缺失 id 的候选被忽略', () => {
    const cands = [{ id: '', title: '联通套餐', category: '号卡', tags: ['联通'] }]
    assert.deepEqual(computeRelatedArticles(article, cands), [])
  })
})
