import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { fetchSearchConsoleTerms, injectSearchTerms, type SearchTerm } from '../src/search-terms.js'

// ---- fetch 手写 mock 基础设施 ----

const originalFetch = globalThis.fetch
let fetchCalls: { url: string; init: RequestInit }[] = []

interface MockResponse {
  ok: boolean
  status: number
  text: () => Promise<string>
  json: () => Promise<unknown>
}

function installFetch(handler: (url: string, init: RequestInit) => Promise<MockResponse>): void {
  fetchCalls = []
  globalThis.fetch = ((url: string, init: RequestInit) => {
    fetchCalls.push({ url, init })
    return handler(url, init)
  }) as unknown as typeof fetch
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch
}

function okResponse(json: unknown): MockResponse {
  return { ok: true, status: 200, text: () => Promise.resolve(''), json: () => Promise.resolve(json) }
}

function makeTerm(query: string, impressions = 100): SearchTerm {
  return { query, clicks: 10, impressions, ctr: 0.1, position: 1 }
}

// ---- fetchSearchConsoleTerms ----

describe('fetchSearchConsoleTerms', () => {
  afterEach(restoreFetch)

  it('成功返回映射后的搜索词列表', async () => {
    installFetch(async () =>
      okResponse({
        rows: [
          { keys: ['套餐推荐'], clicks: 5, impressions: 120, ctr: 0.04, position: 2 },
          { keys: ['流量卡对比'], clicks: 3, impressions: 80, ctr: 0.03, position: 3 },
        ],
      }),
    )

    const result = await fetchSearchConsoleTerms('https://example.com', 'token123')
    assert.equal(result.length, 2)
    assert.equal(result[0].query, '套餐推荐')
    assert.equal(result[0].clicks, 5)
    assert.equal(result[0].impressions, 120)
    assert.equal(result[0].ctr, 0.04)
    assert.equal(result[0].position, 2)
    assert.equal(result[1].query, '流量卡对比')
    assert.equal(result[1].impressions, 80)
  })

  it('使用默认 opts（days=28, limit=50）', async () => {
    installFetch(async () => okResponse({ rows: [] }))

    await fetchSearchConsoleTerms('https://example.com', 'token')
    assert.equal(fetchCalls.length, 1)
    const body = JSON.parse(fetchCalls[0].init.body as string)
    assert.equal(body.rowLimit, 50)
    assert.deepEqual(body.dimensions, ['query'])
    const start = new Date(body.startDate).getTime()
    const end = new Date(body.endDate).getTime()
    assert.ok(Math.abs((end - start) / 86400000 - 28) < 1, '默认天数应为 28')
  })

  it('自定义 opts（days=7, limit=10）', async () => {
    installFetch(async () => okResponse({ rows: [] }))

    await fetchSearchConsoleTerms('https://example.com', 'token', { days: 7, limit: 10 })
    const body = JSON.parse(fetchCalls[0].init.body as string)
    assert.equal(body.rowLimit, 10)
    const start = new Date(body.startDate).getTime()
    const end = new Date(body.endDate).getTime()
    assert.ok(Math.abs((end - start) / 86400000 - 7) < 1, '自定义天数应为 7')
  })

  it('验证请求 URL 编码、method 与 headers', async () => {
    installFetch(async () => okResponse({ rows: [] }))

    await fetchSearchConsoleTerms('https://example.com/路径', 'myToken')
    assert.ok(
      fetchCalls[0].url.includes(encodeURIComponent('https://example.com/路径')),
      'siteUrl 应被 encodeURIComponent 编码',
    )
    assert.equal(fetchCalls[0].init.method, 'POST')
    const headers = fetchCalls[0].init.headers as Record<string, string>
    assert.equal(headers.Authorization, 'Bearer myToken')
    assert.equal(headers['Content-Type'], 'application/json')
  })

  it('API 返回非 ok 时抛出包含状态码与响应体的错误', async () => {
    installFetch(async () => ({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
      json: () => Promise.resolve({}),
    }))

    await assert.rejects(fetchSearchConsoleTerms('https://example.com', 'token'), /Search Console API 403: Forbidden/)
  })

  it('API 错误且 resp.text() 抛错时错误消息体降级为空', async () => {
    installFetch(async () => ({
      ok: false,
      status: 500,
      text: () => Promise.reject(new Error('read failed')),
      json: () => Promise.resolve({}),
    }))

    await assert.rejects(fetchSearchConsoleTerms('https://example.com', 'token'), /Search Console API 500: $/)
  })

  it('rows 为空数组时返回空列表', async () => {
    installFetch(async () => okResponse({ rows: [] }))
    const result = await fetchSearchConsoleTerms('https://example.com', 'token')
    assert.deepEqual(result, [])
  })

  it('rows 为 undefined 时返回空列表', async () => {
    installFetch(async () => okResponse({}))
    const result = await fetchSearchConsoleTerms('https://example.com', 'token')
    assert.deepEqual(result, [])
  })
})

// ---- injectSearchTerms ----

describe('injectSearchTerms', () => {
  it('空搜索词列表返回原 prompt', () => {
    const prompt = '请生成主题'
    assert.equal(injectSearchTerms(prompt, []), prompt)
  })

  it('正常注入搜索词并包含搜索量提示', () => {
    const prompt = '请生成主题'
    const terms = [makeTerm('套餐推荐', 500), makeTerm('流量卡', 300)]
    const result = injectSearchTerms(prompt, terms)
    assert.ok(result.startsWith(prompt))
    assert.ok(result.includes('套餐推荐'))
    assert.ok(result.includes('流量卡'))
    assert.ok(result.includes('月搜500次'))
    assert.ok(result.includes('月搜300次'))
    assert.ok(result.includes('优先围绕这些出主题'))
  })

  it('按序号编号输出搜索词', () => {
    const terms = [makeTerm('a'), makeTerm('b'), makeTerm('c')]
    const result = injectSearchTerms('p', terms)
    assert.ok(result.includes('1. a'))
    assert.ok(result.includes('2. b'))
    assert.ok(result.includes('3. c'))
  })

  it('超过 limit 时只取前 limit 个', () => {
    const terms = [makeTerm('t1'), makeTerm('t2'), makeTerm('t3'), makeTerm('t4')]
    const result = injectSearchTerms('p', terms, 2)
    assert.ok(result.includes('t1'))
    assert.ok(result.includes('t2'))
    assert.ok(!result.includes('t3'))
    assert.ok(!result.includes('t4'))
  })

  it('limit 默认值为 20', () => {
    const terms: SearchTerm[] = Array.from({ length: 25 }, (_, i) => makeTerm(`term${i}`))
    const result = injectSearchTerms('p', terms)
    assert.ok(result.includes('term0'))
    assert.ok(result.includes('term19'))
    assert.ok(!result.includes('term20'))
    assert.ok(!result.includes('term24'))
  })

  it('重复 query 不去重正常输出', () => {
    const terms = [makeTerm('套餐推荐', 100), makeTerm('套餐推荐', 200)]
    const result = injectSearchTerms('p', terms)
    const matches = result.match(/套餐推荐/g)
    assert.ok(matches && matches.length === 2, '重复 query 应出现两次')
  })

  it('特殊字符 query 正常注入', () => {
    const terms = [makeTerm('5G套餐<>&"测试', 99)]
    const result = injectSearchTerms('p', terms)
    assert.ok(result.includes('5G套餐<>&"测试'))
    assert.ok(result.includes('月搜99次'))
  })

  it('prompt 含 HTML 标签时注入到末尾且不破坏原内容', () => {
    const prompt = '<div>原始内容</div>'
    const terms = [makeTerm('搜索词', 50)]
    const result = injectSearchTerms(prompt, terms)
    assert.ok(result.startsWith('<div>原始内容</div>'))
    assert.ok(result.includes('搜索词'))
    const injectStart = result.indexOf('以下是用户实际在搜的词')
    assert.ok(injectStart >= prompt.length, '注入内容应位于原 prompt 之后')
  })
})
