import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import { runScheduledGenerate, type SiteRunnerConfig } from '../src/runner.js'
import type { Seed } from '../src/types.js'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// —— 辅助构造 ——

function makeSeed(id: number, raw: string): Seed {
  return {
    id,
    raw,
    category: '优惠',
    template: 'auto',
    status: 'pending',
    publishAt: null,
    expiresAt: null,
    articleId: null,
    error: null,
    source: 'test',
    fp: '',
    createdAt: '',
    updatedAt: '',
  }
}

const LONG_RAW = '这是一段足够长的素材内容用于测试生成高质量文章'

const GOOD_ARTICLE_JSON = JSON.stringify({
  title: '套餐详解',
  summary: '月租29元包含100GB流量',
  content: [
    { type: 'h2', text: '资费' },
    {
      type: 'text',
      text: '月租29元包含100GB流量，合约期12个月。月租29元包含100GB流量，合约期12个月。月租29元包含100GB流量，合约期12个月。月租29元包含100GB流量，合约期12个月。月租29元包含100GB流量，合约期12个月。月租29元包含100GB流量，合约期12个月。',
    },
    { type: 'h2', text: '对比' },
    {
      type: 'text',
      text: '套餐A 29元100GB，套餐B 39元150GB。套餐A 29元100GB，套餐B 39元150GB。套餐A 29元100GB，套餐B 39元150GB。',
    },
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
    {
      type: 'text',
      text: '首先，随着时代的发展，我们不难发现，综上所述，赋能抓手闭环是底层逻辑。首先，随着时代的发展，我们不难发现，综上所述，赋能抓手闭环是底层逻辑。',
    },
    {
      type: 'text',
      text: '其次，值得注意的是，在当今的背景下，不仅而且，希望对你有所帮助。其次，值得注意的是，在当今的背景下，不仅而且，希望对你有所帮助。',
    },
    {
      type: 'text',
      text: '最后，总而言之，作为AI，人工智能时代的发展，天花板和抓手是关键。最后，总而言之，作为AI，人工智能时代的发展，天花板和抓手是关键。',
    },
  ],
  template: 'default',
  category: '优惠',
  tags: [],
  faq: [],
  links: [],
})

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const ADMIN_BASE = 'https://test.example.com'
const silentLogger = (..._a: unknown[]) => {}

// —— fetch mock 基础设施 ——

let fetchImpl: ((url: string, init: unknown) => Promise<Response>) | undefined

beforeEach(() => {
  fetchImpl = undefined
  mock.method(globalThis, 'fetch', async (url: string, init: unknown) => {
    if (fetchImpl) return fetchImpl(url, init)
    return jsonRes({})
  })
})

afterEach(() => {
  mock.restoreAll()
})

// —— 默认线上 API mock 工厂 ——

function defaultApi(seeds: Seed[] = [], publishedToday = 0): (url: string, init: unknown) => Promise<Response> {
  return async (url, init) => {
    const u = new URL(url)
    const path = u.pathname
    const method = (init as { method?: string })?.method || 'GET'

    // 本地网关（execute 内部检查）— 默认离线
    if (u.hostname === 'localhost') {
      if (path.includes('/health')) return jsonRes({ status: 'degraded' })
      if (path.includes('/models')) return jsonRes({ data: [] })
      return jsonRes({})
    }

    // 线上 API
    if (path === '/api/admin/seeds' && method === 'GET') return jsonRes({ list: seeds })
    if (path === '/api/admin/seeds' && method === 'POST') return jsonRes({ added: 1 })
    if (path.match(/\/api\/admin\/seeds\/\d+\/done/) && method === 'POST') return jsonRes({})
    if (path.match(/\/api\/admin\/seeds\/\d+\/fail/) && method === 'POST') return jsonRes({})
    if (path === '/api/admin/articles/batch' && method === 'POST')
      return jsonRes({ total: 1, created: 1, failed: 0, results: [{ id: '1', ok: true }] })
    if (path === '/api/admin/articles' && method === 'GET') return jsonRes({ list: Array(publishedToday).fill({}) })
    if (path === '/api/admin/publish-due' && method === 'POST') return jsonRes({ published: 0 })
    if (path === '/api/admin/run-logs' && method === 'POST') return jsonRes({})
    if (path === '/api/admin/run-daily-generate') return jsonRes({ ok: true, message: 'triggered' })
    return jsonRes({})
  }
}

function baseCfg(overrides: Partial<SiteRunnerConfig> = {}): SiteRunnerConfig {
  return {
    site: 'test-site',
    adminBase: ADMIN_BASE,
    adminKey: 'test-key',
    ai: { client: async () => GOOD_ARTICLE_JSON },
    dailyTarget: 1,
    logger: silentLogger,
    ...overrides,
  }
}

// ============================================================
// 配置校验
// ============================================================
describe('runner 配置校验', () => {
  it('未配置 adminKey 和 adminKeyFile 时抛错', async () => {
    fetchImpl = defaultApi([], 0)
    await assert.rejects(
      () =>
        runScheduledGenerate({
          site: 's',
          adminBase: ADMIN_BASE,
          ai: { client: async () => GOOD_ARTICLE_JSON },
          dailyTarget: 1,
          logger: silentLogger,
        }),
      /未配置/,
    )
  })

  it('adminKey 明文正常使用', async () => {
    fetchImpl = defaultApi([makeSeed(1, LONG_RAW)], 0)
    const result = await runScheduledGenerate(baseCfg({ adminKey: 'my-secret-key' }))
    assert.equal(result.mode, 'cloud')
    assert.equal(result.pipeline?.ok, 1)
  })

  it('adminKeyFile 读取并剥 MANAGE_KEY= 前缀', async () => {
    const tmpFile = join(tmpdir(), `runner-key-${Date.now()}-${Math.random()}.txt`)
    writeFileSync(tmpFile, 'MANAGE_KEY=file-secret')
    try {
      let capturedAuth = ''
      fetchImpl = async (url, init) => {
        const headers = (init as { headers?: Record<string, string> })?.headers || {}
        capturedAuth = headers.Authorization || ''
        return defaultApi([makeSeed(1, LONG_RAW)], 0)(url, init)
      }
      const result = await runScheduledGenerate({
        site: 'test-site',
        adminBase: ADMIN_BASE,
        adminKeyFile: tmpFile,
        ai: { client: async () => GOOD_ARTICLE_JSON },
        dailyTarget: 1,
        logger: silentLogger,
      })
      assert.equal(result.mode, 'cloud')
      assert.equal(capturedAuth, 'Bearer file-secret')
    } finally {
      rmSync(tmpFile, { force: true })
    }
  })

  it('adminKeyFile 无前缀时直接使用', async () => {
    const tmpFile = join(tmpdir(), `runner-key-${Date.now()}-${Math.random()}.txt`)
    writeFileSync(tmpFile, 'plain-key-123')
    try {
      let capturedAuth = ''
      fetchImpl = async (url, init) => {
        const headers = (init as { headers?: Record<string, string> })?.headers || {}
        capturedAuth = headers.Authorization || ''
        return defaultApi([makeSeed(1, LONG_RAW)], 0)(url, init)
      }
      const result = await runScheduledGenerate({
        site: 'test-site',
        adminBase: ADMIN_BASE,
        adminKeyFile: tmpFile,
        ai: { client: async () => GOOD_ARTICLE_JSON },
        dailyTarget: 1,
        logger: silentLogger,
      })
      assert.equal(result.mode, 'cloud')
      assert.equal(capturedAuth, 'Bearer plain-key-123')
    } finally {
      rmSync(tmpFile, { force: true })
    }
  })

  it('adminKey 优先于 adminKeyFile', async () => {
    const tmpFile = join(tmpdir(), `runner-key-${Date.now()}-${Math.random()}.txt`)
    writeFileSync(tmpFile, 'MANAGE_KEY=file-secret')
    try {
      let capturedAuth = ''
      fetchImpl = async (url, init) => {
        const headers = (init as { headers?: Record<string, string> })?.headers || {}
        capturedAuth = headers.Authorization || ''
        return defaultApi([makeSeed(1, LONG_RAW)], 0)(url, init)
      }
      await runScheduledGenerate(baseCfg({ adminKey: 'explicit-key', adminKeyFile: tmpFile }))
      assert.equal(capturedAuth, 'Bearer explicit-key')
    } finally {
      rmSync(tmpFile, { force: true })
    }
  })
})

// ============================================================
// 云端生成
// ============================================================
describe('runner 云端生成', () => {
  it('正常云端生成成功', async () => {
    fetchImpl = defaultApi([makeSeed(1, LONG_RAW)], 0)
    const result = await runScheduledGenerate(baseCfg())
    assert.equal(result.mode, 'cloud')
    assert.equal(result.pipeline?.ok, 1)
    assert.equal(result.pipeline?.fail, 0)
    assert.equal(result.pipeline?.total, 1)
  })

  it('请求携带 Authorization Bearer 头', async () => {
    let capturedAuth = ''
    fetchImpl = async (url, init) => {
      const headers = (init as { headers?: Record<string, string> })?.headers || {}
      capturedAuth = headers.Authorization || ''
      return defaultApi([makeSeed(1, LONG_RAW)], 0)(url, init)
    }
    await runScheduledGenerate(baseCfg({ adminKey: 'bearer-test' }))
    assert.equal(capturedAuth, 'Bearer bearer-test')
  })

  it('未传 logger 时使用默认日志不报错', async () => {
    fetchImpl = defaultApi([makeSeed(1, LONG_RAW)], 0)
    const result = await runScheduledGenerate({
      site: 'test-site',
      adminBase: ADMIN_BASE,
      adminKey: 'test-key',
      ai: { client: async () => GOOD_ARTICLE_JSON },
      dailyTarget: 1,
    })
    assert.equal(result.mode, 'cloud')
  })
})

// ============================================================
// 防重检查
// ============================================================
describe('runner 防重检查', () => {
  it('当天已发布达到目标时跳过', async () => {
    fetchImpl = defaultApi([], 3)
    const result = await runScheduledGenerate(baseCfg({ dailyTarget: 3 }))
    assert.equal(result.mode, 'skipped')
    assert.ok(result.reason?.includes('当天已发布 3 篇'))
  })

  it('当天已发布超过目标时跳过', async () => {
    fetchImpl = defaultApi([], 5)
    const result = await runScheduledGenerate(baseCfg({ dailyTarget: 2 }))
    assert.equal(result.mode, 'skipped')
  })

  it('getPublishedToday 返回 null list 时视为 0', async () => {
    const base = defaultApi([makeSeed(1, LONG_RAW)], 0)
    fetchImpl = async (url, init) => {
      const u = new URL(url)
      const method = (init as { method?: string })?.method || 'GET'
      if (u.pathname === '/api/admin/articles' && method === 'GET' && u.hostname !== 'localhost') {
        return jsonRes({ list: null })
      }
      return base(url, init)
    }
    const result = await runScheduledGenerate(baseCfg())
    assert.equal(result.mode, 'cloud')
    assert.equal(result.pipeline?.ok, 1)
  })
})

// ============================================================
// dryRun 模式
// ============================================================
describe('runner dryRun 模式', () => {
  it('dryRun 模式生成成功', async () => {
    fetchImpl = defaultApi([makeSeed(1, LONG_RAW)], 0)
    const result = await runScheduledGenerate(baseCfg({ dryRun: true }))
    assert.equal(result.mode, 'cloud')
    assert.equal(result.pipeline?.ok, 1)
  })

  it('dryRun 模式素材不足时选题落内存', async () => {
    let seedsGetCount = 0
    let aiCallCount = 0
    fetchImpl = async (url, init) => {
      const u = new URL(url)
      const path = u.pathname
      const method = (init as { method?: string })?.method || 'GET'
      if (u.hostname === 'localhost') return jsonRes({ status: 'degraded' })
      if (path === '/api/admin/seeds' && method === 'GET') {
        seedsGetCount++
        if (seedsGetCount === 1) return jsonRes({ list: [] })
        return jsonRes({ list: [makeSeed(1, LONG_RAW)] })
      }
      return defaultApi([], 0)(url, init)
    }
    const result = await runScheduledGenerate(
      baseCfg({
        dryRun: true,
        ai: {
          client: async () => {
            aiCallCount++
            if (aiCallCount === 1) {
              return JSON.stringify([
                { title: '测试选题标题内容足够长用于生成', angle: '从用户视角分析套餐资费对比优劣', category: '优惠' },
              ])
            }
            return GOOD_ARTICLE_JSON
          },
        },
      }),
    )
    assert.equal(result.mode, 'cloud')
    assert.ok(aiCallCount >= 2, 'AI 应至少调用两次（选题+生成）')
  })

  it('dryRun 模式生成失败时标记素材失败不调 API', async () => {
    let markFailCalled = false
    fetchImpl = async (url, init) => {
      const u = new URL(url)
      const path = u.pathname
      const method = (init as { method?: string })?.method || 'GET'
      if (u.hostname === 'localhost') return jsonRes({ status: 'degraded' })
      if (path === '/api/admin/seeds' && method === 'GET') return jsonRes({ list: [makeSeed(1, LONG_RAW)] })
      if (path.match(/\/api\/admin\/seeds\/\d+\/fail/) && method === 'POST') {
        markFailCalled = true
        return jsonRes({})
      }
      return defaultApi([], 0)(url, init)
    }
    const result = await runScheduledGenerate(
      baseCfg({
        dryRun: true,
        ai: { client: async () => CLICHE_ARTICLE_JSON },
        quality: { threshold: 60 },
      }),
    )
    assert.equal(result.mode, 'cloud')
    assert.equal(result.pipeline?.fail, 1)
    assert.ok(!markFailCalled, 'dryRun 时不应调 markSeedFailed API')
  })
})

// ============================================================
// 云端兜底
// ============================================================
describe('runner 云端兜底', () => {
  it('本地离线时触发云端兜底', async () => {
    let cloudCalled = false
    const base = defaultApi([], 0)
    fetchImpl = async (url, init) => {
      const u = new URL(url)
      if (u.pathname === '/api/admin/run-daily-generate') {
        cloudCalled = true
        return jsonRes({ ok: true, message: 'triggered' })
      }
      return base(url, init)
    }
    const result = await runScheduledGenerate({
      site: 'test-site',
      adminBase: ADMIN_BASE,
      adminKey: 'test-key',
      dailyTarget: 1,
      logger: silentLogger,
    })
    assert.equal(result.mode, 'cloud-fallback')
    assert.ok(cloudCalled)
    assert.ok(result.reason?.includes('云端兜底已触发'))
  })

  it('云端兜底触发失败时返回 ok=false', async () => {
    const base = defaultApi([], 0)
    fetchImpl = async (url, init) => {
      const u = new URL(url)
      if (u.pathname === '/api/admin/run-daily-generate') {
        return jsonRes({ error: 'cloud fail' }, 500)
      }
      return base(url, init)
    }
    const logs: string[] = []
    const result = await runScheduledGenerate({
      site: 'test-site',
      adminBase: ADMIN_BASE,
      adminKey: 'test-key',
      dailyTarget: 1,
      logger: (...args: unknown[]) => logs.push(args.join(' ')),
    })
    assert.equal(result.mode, 'cloud-fallback')
    assert.ok(result.reason?.includes('云端兜底触发失败'))
    assert.ok(logs.some((l) => l.includes('云端兜底触发失败')))
  })

  it('自定义 cloudEndpoint', async () => {
    let cloudCalled = false
    const base = defaultApi([], 0)
    fetchImpl = async (url, init) => {
      const u = new URL(url)
      if (u.pathname === '/api/custom-cloud') {
        cloudCalled = true
        return jsonRes({ ok: true })
      }
      return base(url, init)
    }
    const result = await runScheduledGenerate({
      site: 'test-site',
      adminBase: ADMIN_BASE,
      adminKey: 'test-key',
      dailyTarget: 1,
      cloudEndpoint: '/api/custom-cloud',
      logger: silentLogger,
    })
    assert.equal(result.mode, 'cloud-fallback')
    assert.ok(cloudCalled)
  })
})

// ============================================================
// 运行日志上报
// ============================================================
describe('runner 运行日志上报', () => {
  it('成功运行后上报 run-logs', async () => {
    let runLogsCalled = false
    let runLogsBody: unknown
    const base = defaultApi([makeSeed(1, LONG_RAW)], 0)
    fetchImpl = async (url, init) => {
      const u = new URL(url)
      const method = (init as { method?: string })?.method || 'GET'
      if (u.pathname === '/api/admin/run-logs' && method === 'POST') {
        runLogsCalled = true
        runLogsBody = JSON.parse((init as { body?: string })?.body || '{}')
        return jsonRes({})
      }
      return base(url, init)
    }
    const result = await runScheduledGenerate(baseCfg())
    assert.equal(result.mode, 'cloud')
    assert.ok(runLogsCalled, '应调用 run-logs API')
    assert.equal((runLogsBody as { ok: number }).ok, 1)
    assert.equal((runLogsBody as { fail: number }).fail, 0)
  })

  it('run-logs 上报失败不阻塞', async () => {
    const base = defaultApi([makeSeed(1, LONG_RAW)], 0)
    fetchImpl = async (url, init) => {
      const u = new URL(url)
      const method = (init as { method?: string })?.method || 'GET'
      if (u.pathname === '/api/admin/run-logs' && method === 'POST') {
        return jsonRes({ error: 'fail' }, 500)
      }
      return base(url, init)
    }
    const logs: string[] = []
    const result = await runScheduledGenerate(baseCfg({ logger: (...args: unknown[]) => logs.push(args.join(' ')) }))
    assert.equal(result.mode, 'cloud')
    assert.equal(result.pipeline?.ok, 1)
    assert.ok(logs.some((l) => l.includes('运行日志上报失败')))
  })
})

// ============================================================
// 草稿发布
// ============================================================
describe('runner 草稿发布', () => {
  it('默认调线上 publish-due API', async () => {
    let publishDueCalled = false
    const base = defaultApi([makeSeed(1, LONG_RAW)], 0)
    fetchImpl = async (url, init) => {
      const u = new URL(url)
      const method = (init as { method?: string })?.method || 'GET'
      if (u.pathname === '/api/admin/publish-due' && method === 'POST') {
        publishDueCalled = true
        return jsonRes({ published: 2 })
      }
      return base(url, init)
    }
    const logs: string[] = []
    const result = await runScheduledGenerate(baseCfg({ logger: (...args: unknown[]) => logs.push(args.join(' ')) }))
    assert.ok(publishDueCalled, '应调用 publish-due API')
    assert.ok(logs.some((l) => l.includes('优先发布到期草稿 2 篇')))
    assert.equal(result.mode, 'cloud')
  })

  it('自定义 publishDueDrafts 函数', async () => {
    fetchImpl = defaultApi([makeSeed(1, LONG_RAW)], 0)
    let customCalled = false
    const logs: string[] = []
    const result = await runScheduledGenerate(
      baseCfg({
        publishDueDrafts: async () => {
          customCalled = true
          return 3
        },
        logger: (...args: unknown[]) => logs.push(args.join(' ')),
      }),
    )
    assert.ok(customCalled, '自定义函数应被调用')
    assert.ok(logs.some((l) => l.includes('优先发布到期草稿 3 篇')))
    assert.equal(result.mode, 'cloud')
  })

  it('publishDueDrafts 为 false 时关闭', async () => {
    let publishDueCalled = false
    const base = defaultApi([makeSeed(1, LONG_RAW)], 0)
    fetchImpl = async (url, init) => {
      const u = new URL(url)
      const method = (init as { method?: string })?.method || 'GET'
      if (u.pathname === '/api/admin/publish-due' && method === 'POST') {
        publishDueCalled = true
        return jsonRes({ published: 0 })
      }
      return base(url, init)
    }
    const result = await runScheduledGenerate(baseCfg({ publishDueDrafts: false }))
    assert.ok(!publishDueCalled, 'false 时不应调用 publish-due API')
    assert.equal(result.mode, 'cloud')
  })

  it('自定义 publishDueEndpoint', async () => {
    let publishDueCalled = false
    const base = defaultApi([makeSeed(1, LONG_RAW)], 0)
    fetchImpl = async (url, init) => {
      const u = new URL(url)
      const method = (init as { method?: string })?.method || 'GET'
      if (u.pathname === '/api/custom-publish-due' && method === 'POST') {
        publishDueCalled = true
        return jsonRes({ published: 1 })
      }
      return base(url, init)
    }
    const logs: string[] = []
    const result = await runScheduledGenerate(
      baseCfg({
        publishDueEndpoint: '/api/custom-publish-due',
        logger: (...args: unknown[]) => logs.push(args.join(' ')),
      }),
    )
    assert.ok(publishDueCalled, '应调用自定义 publish-due 端点')
    assert.ok(logs.some((l) => l.includes('优先发布到期草稿 1 篇')))
    assert.equal(result.mode, 'cloud')
  })
})

// ============================================================
// API 错误处理
// ============================================================
describe('runner API 错误处理', () => {
  it('API 返回非 200 时抛错', async () => {
    const base = defaultApi([makeSeed(1, LONG_RAW)], 0)
    fetchImpl = async (url, init) => {
      const u = new URL(url)
      const method = (init as { method?: string })?.method || 'GET'
      if (u.pathname === '/api/admin/seeds' && method === 'GET' && u.hostname !== 'localhost') {
        return jsonRes({ error: 'server' }, 500)
      }
      return base(url, init)
    }
    await assert.rejects(() => runScheduledGenerate(baseCfg()), /API HTTP 500/)
  })

  it('API 返回非 JSON 时不崩溃', async () => {
    const base = defaultApi([], 0)
    fetchImpl = async (url, init) => {
      const u = new URL(url)
      const method = (init as { method?: string })?.method || 'GET'
      if (u.pathname === '/api/admin/seeds' && method === 'GET' && u.hostname !== 'localhost') {
        return new Response('not-json', { status: 200 })
      }
      return base(url, init)
    }
    const result = await runScheduledGenerate(baseCfg())
    assert.equal(result.mode, 'cloud')
    // 无素材，生成 0 篇
    assert.equal(result.pipeline?.ok, 0)
  })
})

// ============================================================
// 标记素材容错
// ============================================================
describe('runner 标记素材容错', () => {
  it('markSeedDone API 失败时不阻塞', async () => {
    const base = defaultApi([makeSeed(1, LONG_RAW)], 0)
    fetchImpl = async (url, init) => {
      const u = new URL(url)
      const method = (init as { method?: string })?.method || 'GET'
      if (u.pathname.match(/\/api\/admin\/seeds\/\d+\/done/) && method === 'POST') {
        return jsonRes({ error: 'fail' }, 500)
      }
      return base(url, init)
    }
    const logs: string[] = []
    const result = await runScheduledGenerate(baseCfg({ logger: (...args: unknown[]) => logs.push(args.join(' ')) }))
    assert.equal(result.mode, 'cloud')
    assert.equal(result.pipeline?.ok, 1)
    assert.ok(logs.some((l) => l.includes('标记素材完成失败')))
  })

  it('markSeedFailed API 失败时不阻塞', async () => {
    const base = defaultApi([makeSeed(1, LONG_RAW)], 0)
    fetchImpl = async (url, init) => {
      const u = new URL(url)
      const method = (init as { method?: string })?.method || 'GET'
      if (u.pathname.match(/\/api\/admin\/seeds\/\d+\/fail/) && method === 'POST') {
        return jsonRes({ error: 'fail' }, 500)
      }
      return base(url, init)
    }
    const logs: string[] = []
    const result = await runScheduledGenerate(
      baseCfg({
        ai: { client: async () => CLICHE_ARTICLE_JSON },
        quality: { threshold: 60 },
        logger: (...args: unknown[]) => logs.push(args.join(' ')),
      }),
    )
    assert.equal(result.mode, 'cloud')
    assert.equal(result.pipeline?.fail, 1)
    assert.ok(logs.some((l) => l.includes('标记素材失败失败')))
  })

  it('文章质量不达标时标记素材失败', async () => {
    let markFailCalled = false
    const base = defaultApi([makeSeed(1, LONG_RAW)], 0)
    fetchImpl = async (url, init) => {
      const u = new URL(url)
      const method = (init as { method?: string })?.method || 'GET'
      if (u.pathname.match(/\/api\/admin\/seeds\/\d+\/fail/) && method === 'POST') {
        markFailCalled = true
        return jsonRes({})
      }
      return base(url, init)
    }
    const result = await runScheduledGenerate(
      baseCfg({ ai: { client: async () => CLICHE_ARTICLE_JSON }, quality: { threshold: 60 } }),
    )
    assert.equal(result.mode, 'cloud')
    assert.equal(result.pipeline?.fail, 1)
    assert.ok(markFailCalled, '应调用 markSeedFailed API')
  })
})

// ============================================================
// 素材不足选题补足
// ============================================================
describe('runner 素材不足选题补足', () => {
  it('素材不足时触发 AI 选题补足并插入新素材', async () => {
    let seedsGetCount = 0
    let insertSeedsCalled = false
    let aiCallCount = 0
    fetchImpl = async (url, init) => {
      const u = new URL(url)
      const path = u.pathname
      const method = (init as { method?: string })?.method || 'GET'
      if (u.hostname === 'localhost') return jsonRes({ status: 'degraded' })
      if (path === '/api/admin/seeds' && method === 'GET') {
        seedsGetCount++
        if (seedsGetCount === 1) return jsonRes({ list: [] })
        return jsonRes({ list: [makeSeed(1, LONG_RAW)] })
      }
      if (path === '/api/admin/seeds' && method === 'POST') {
        insertSeedsCalled = true
        return jsonRes({ added: 1 })
      }
      return defaultApi([], 0)(url, init)
    }
    const result = await runScheduledGenerate(
      baseCfg({
        ai: {
          client: async () => {
            aiCallCount++
            if (aiCallCount === 1) {
              return JSON.stringify([
                { title: '测试选题标题内容足够长用于生成', angle: '从用户视角分析套餐资费对比优劣', category: '优惠' },
              ])
            }
            return GOOD_ARTICLE_JSON
          },
        },
      }),
    )
    assert.equal(result.mode, 'cloud')
    assert.ok(insertSeedsCalled, '应调用 insertSeeds API')
    assert.ok(aiCallCount >= 2, 'AI 应至少调用两次（选题+生成）')
  })
})

// ============================================================
// 连续运行
// ============================================================
describe('runner 连续运行', () => {
  it('多次调用不互相干扰', async () => {
    fetchImpl = defaultApi([makeSeed(1, LONG_RAW)], 0)
    const r1 = await runScheduledGenerate(baseCfg())
    const r2 = await runScheduledGenerate(baseCfg())
    assert.equal(r1.mode, 'cloud')
    assert.equal(r2.mode, 'cloud')
    assert.equal(r1.pipeline?.ok, 1)
    assert.equal(r2.pipeline?.ok, 1)
  })
})
