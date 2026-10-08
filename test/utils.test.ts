import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { articleJsonLd, escapeHtml, extractJson, firstNonEmpty, flattenFaq, flattenToStrings } from '../src/utils.js'

describe('firstNonEmpty', () => {
  it('返回首个非空字符串', () => {
    assert.equal(firstNonEmpty('', '  ', 'x', 'y'), 'x')
  })
  it('全空返回空串', () => {
    assert.equal(firstNonEmpty('', null, undefined, 123), '')
  })
})

describe('extractJson', () => {
  it('直接解析 JSON', () => {
    assert.deepEqual(extractJson('{"a":1}'), { a: 1 })
  })
  it('剥离 markdown 代码块', () => {
    assert.deepEqual(extractJson('```json\n{"b":2}\n```'), { b: 2 })
  })
  it('剥离 think 标签', () => {
    assert.deepEqual(extractJson('```think\n忽略\n```\n{"c":3}'), { c: 3 })
  })
  it('无效输入返回 null', () => {
    assert.equal(extractJson('not json at all'), null)
  })
})

describe('escapeHtml', () => {
  it('转义标签与 &', () => {
    assert.ok(!escapeHtml('<b>x</b>').includes('<b>'))
    assert.ok(escapeHtml('a&b').includes('&amp;'))
  })
})

describe('articleJsonLd', () => {
  it('转义 < 防止 </script> 提前闭合（XSS）', () => {
    const out = articleJsonLd(
      { id: 'a1', title: '</script><img src=x>', summary: 's', createdAt: '2026-01-01' },
      { name: '站点', url: 'https://example.com' },
    )
    assert.ok(!out.includes('</script>'))
    assert.ok(out.includes('\\u003c'))
    assert.doesNotThrow(() => JSON.parse(out))
  })

  it('含 FAQ 时输出 FAQPage', () => {
    const out = articleJsonLd(
      { id: 'a2', title: 't', summary: 's', createdAt: '2026-01-01', faq: [{ q: 'q', a: 'a' }] },
      { name: '站点', url: 'https://example.com' },
    )
    assert.ok(out.includes('FAQPage'))
  })
})

describe('flatten 系列', () => {
  it('flattenToStrings 解析 JSON 字符串', () => {
    assert.deepEqual(flattenToStrings('[1,2,3]'), [1, 2, 3])
    assert.deepEqual(flattenToStrings('bad'), [])
  })
  it('flattenFaq 过滤无效项', () => {
    assert.deepEqual(flattenFaq([{ q: 'a', a: 'b' }, { q: 'x' }]), [{ q: 'a', a: 'b' }])
  })
})
