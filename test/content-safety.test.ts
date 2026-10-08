import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { checkArticleSafety, replaceViolatingWords, scanText } from '../src/content-safety.js'

describe('scanText', () => {
  it('命中默认违规词', () => {
    const hits = scanText('这里有赌博网站')
    assert.ok(hits.some((h) => h.word === '赌博'))
  })

  it('豁免正面提醒（不要/远离）', () => {
    assert.deepEqual(scanText('不要赌博'), [])
    assert.equal(scanText('远离刷单返利').length, 0)
  })

  it('空文本返回空数组', () => {
    assert.deepEqual(scanText(''), [])
  })

  it('同类别最多记一个命中词', () => {
    const hits = scanText('赌博 博彩 六合彩')
    assert.equal(hits.filter((h) => h.cat === 'gambling').length, 1)
  })
})

describe('checkArticleSafety', () => {
  it('安全文章 ok=true 且无命中', () => {
    const r = checkArticleSafety({ title: '正规套餐推荐', content: [{ type: 'text', text: '这是正常内容' }] })
    assert.equal(r.ok, true)
    assert.deepEqual(r.hits, [])
  })

  it('扫描标题命中违规词', () => {
    const r = checkArticleSafety({ title: '澳门赌场攻略' })
    assert.equal(r.ok, false)
    assert.ok(r.hits.some((h) => h.cat === 'gambling'))
  })

  it('扫描 content 的 JSON 字符串', () => {
    const r = checkArticleSafety({ content: JSON.stringify([{ type: 'text', text: '教你自制炸药' }]) })
    assert.equal(r.ok, false)
  })

  it('追加自定义规则生效', () => {
    const r = checkArticleSafety({ title: '本店特惠' }, [{ cat: 'custom', label: '自定义', words: ['特惠'] }])
    assert.equal(r.ok, false)
    assert.ok(r.hits.some((h) => h.cat === 'custom'))
  })
})

describe('replaceViolatingWords', () => {
  it('替换违规词为掩码', () => {
    const r = replaceViolatingWords('这是赌博内容')
    assert.equal(r.replaced, true)
    assert.ok(r.text.includes('赌*'))
    assert.ok(!r.text.includes('赌博'))
  })

  it('豁免词不替换', () => {
    const r = replaceViolatingWords('不要赌博')
    assert.equal(r.replaced, false)
    assert.equal(r.text, '不要赌博')
  })

  it('空文本原样返回', () => {
    assert.deepEqual(replaceViolatingWords(''), { text: '', replaced: false })
  })
})
