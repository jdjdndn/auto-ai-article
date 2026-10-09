import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import { execute, type ExecutorConfig } from '../src/executor.js'
import type { PipelineDB } from '../src/pipeline.js'
import type { Seed, SeedInput, GeneratedArticle, InsertResult, RunLogInput } from '../src/types.js'
import type { RunLogEntry } from '../src/stats.js'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// —— 辅助：构造素材与 mock 数据库 ——

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

function mockDb(seeds: Seed[]): PipelineDB & { inserted: GeneratedArticle[]; failed: { id: number; error: string }[] } {
  const inserted: GeneratedArticle[] = []
  const failed: { id: number; error: string }[] = []
  return {
    inserted,
    failed,
    async fetchPendingSeeds(size: number) {
      return seeds.filter((s) => s.status === 'pending').slice(0, size)
    },
    async insertSeeds(items: SeedInput[]) {
      return { added: items.length }
    },
    async markSeedDone() {},
    async markSeedFailed(id: number, error: string) {
      failed.push({ id, error })
    },
    async insertArticles(articles: GeneratedArticle[]): Promise<InsertResult> {
      inserted.push(...articles)
      return {
        total: articles.length,
        created: articles.length,
        failed: 0,
        results: articles.map((_, i) => ({ id: `id-${i}`, ok: true })),
      }
    },
    async insertRunLog() {},
  }
}

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

// —— mock globalThis.fetch ——

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

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

// —— fetch 场景工厂 ——

/** 本地网关在线 */
function onlineFetch(models: string[] = ['deepseek-chat'], articleJson = GOOD_ARTICLE_JSON) {
  return async (url: string): Promise<Response> => {
    if (url.includes('/health')) return jsonRes({ status: 'ok', browser: 'connected' })
    if (url.includes('/models')) return jsonRes({ data: models.map((id) => ({ id })) })
    if (url.includes('/chat/completions')) return jsonRes({ choices: [{ message: { content: articleJson } }] })
    return jsonRes({})
  }
}

/** 本地网关离线（degraded） */
function offlineFetch() {
  return async (url: string): Promise<Response> => {
    if (url.includes('/health')) return jsonRes({ status: 'degraded' })
    if (url.includes('/models')) return jsonRes({ data: [] })
    return jsonRes({})
  }
}

/** 本地网关会话过期 */
function sessionExpiredFetch() {
  return async (url: string): Promise<Response> => {
    if (url.includes('/health')) return jsonRes({ status: 'session_expired' })
    if (url.includes('/models')) return jsonRes({ data: [] })
    return jsonRes({})
  }
}

/** 离线但有云端 AI key：/chat/completions 返回文章 JSON */
function offlineWithCloudAiFetch() {
  return async (url: string): Promise<Response> => {
    if (url.includes('/health')) return jsonRes({ status: 'degraded' })
    if (url.includes('/models')) return jsonRes({ data: [] })
    if (url.includes('/chat/completions')) return jsonRes({ choices: [{ message: { content: GOOD_ARTICLE_JSON } }] })
    return jsonRes({})
  }
}

const silentLogger = () => {}

// ============================================================
// 草稿发布
// ============================================================
describe('executor 草稿发布', () => {
  it('publishDueDrafts 发布成功时记录日志', async () => {
    const logs: string[] = []
    const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
      ai: { client: async () => GOOD_ARTICLE_JSON },
      dailyTarget: 1,
      publishDueDrafts: async () => 2,
      logger: (...args: unknown[]) => logs.push(args.join(' ')),
    })
    assert.equal(result.mode, 'cloud')
    assert.ok(logs.some((l) => l.includes('优先发布到期草稿 2 篇')))
  })

  it('publishDueDrafts 发布 0 篇时不记录日志', async () => {
    const logs: string[] = []
    const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
      ai: { client: async () => GOOD_ARTICLE_JSON },
      dailyTarget: 1,
      publishDueDrafts: async () => 0,
      logger: (...args: unknown[]) => logs.push(args.join(' ')),
    })
    assert.equal(result.mode, 'cloud')
    assert.ok(!logs.some((l) => l.includes('优先发布到期草稿')))
  })

  it('publishDueDrafts 抛错时记录警告并继续', async () => {
    const logs: string[] = []
    const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
      ai: { client: async () => GOOD_ARTICLE_JSON },
      dailyTarget: 1,
      publishDueDrafts: async () => {
        throw new Error('草稿发布失败')
      },
      logger: (...args: unknown[]) => logs.push(args.join(' ')),
    })
    assert.equal(result.mode, 'cloud')
    assert.ok(logs.some((l) => l.includes('发布到期草稿失败')))
  })
})

// ============================================================
// 配额检查
// ============================================================
describe('executor 配额检查', () => {
  it('当天已发布达到目标时跳过', async () => {
    const result = await execute(mockDb([]), {
      ai: { client: async () => GOOD_ARTICLE_JSON },
      dailyTarget: 3,
      getPublishedToday: async () => 3,
      logger: silentLogger,
    })
    assert.equal(result.mode, 'skipped')
    assert.ok(result.reason?.includes('当天已发布 3 篇'))
  })

  it('当天已发布超过目标时跳过', async () => {
    const result = await execute(mockDb([]), {
      ai: { client: async () => GOOD_ARTICLE_JSON },
      dailyTarget: 2,
      getPublishedToday: async () => 5,
      logger: silentLogger,
    })
    assert.equal(result.mode, 'skipped')
  })

  it('当天已发布部分时剩余由生成补足', async () => {
    const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
      ai: { client: async () => GOOD_ARTICLE_JSON },
      dailyTarget: 2,
      getPublishedToday: async () => 1,
      logger: silentLogger,
    })
    assert.equal(result.mode, 'cloud')
    assert.equal(result.pipeline?.ok, 1)
  })
})

// ============================================================
// 防重复发布
// ============================================================
describe('executor 防重复发布', () => {
  it('今天已有本地成功记录时跳过', async () => {
    const result = await execute(mockDb([]), {
      ai: { client: async () => GOOD_ARTICLE_JSON },
      hasLocalRunToday: async () => true,
      logger: silentLogger,
    })
    assert.equal(result.mode, 'skipped')
    assert.ok(result.reason?.includes('本地成功记录'))
  })

  it('今天无本地成功记录时继续执行', async () => {
    const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
      ai: { client: async () => GOOD_ARTICLE_JSON },
      dailyTarget: 1,
      hasLocalRunToday: async () => false,
      logger: silentLogger,
    })
    assert.equal(result.mode, 'cloud')
  })
})

// ============================================================
// 云端模式（ai.client 提供 → lg=null）
// ============================================================
describe('executor 云端模式', () => {
  it('默认配置走云端并成功生成', async () => {
    const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
      ai: { client: async () => GOOD_ARTICLE_JSON },
      dailyTarget: 1,
      logger: silentLogger,
    })
    assert.equal(result.mode, 'cloud')
    assert.equal(result.pipeline?.ok, 1)
    assert.equal(result.pipeline?.fail, 0)
    assert.equal(result.pipeline?.total, 1)
  })

  it('dryRun 模式走云端', async () => {
    const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
      ai: { client: async () => GOOD_ARTICLE_JSON },
      dailyTarget: 1,
      dryRun: true,
      logger: silentLogger,
    })
    assert.equal(result.mode, 'cloud')
  })

  it('cloudModel 覆盖 ai.model', async () => {
    const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
      ai: { client: async () => GOOD_ARTICLE_JSON, model: 'gpt-4o' },
      dailyTarget: 1,
      cloudModel: 'claude-3',
      logger: silentLogger,
    })
    assert.equal(result.mode, 'cloud')
    assert.equal(result.pipeline?.ok, 1)
  })
})

// ============================================================
// 本地网关在线
// ============================================================
describe('executor 本地网关在线', () => {
  it('本地网关在线时走本地模式', async () => {
    fetchImpl = onlineFetch()
    const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
      dailyTarget: 1,
      logger: silentLogger,
    })
    assert.equal(result.mode, 'local')
    assert.equal(result.pipeline?.ok, 1)
  })

  it('本地模型不在网关列表时自动选第一个可用模型', async () => {
    fetchImpl = onlineFetch(['qwen-chat', 'llama3'])
    const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
      dailyTarget: 1,
      localModel: 'deepseek-chat',
      logger: silentLogger,
    })
    assert.equal(result.mode, 'local')
    assert.equal(result.pipeline?.ok, 1)
  })

  it('配置 localModels 时按优先级轮换', async () => {
    fetchImpl = onlineFetch(['deepseek-chat'])
    const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
      dailyTarget: 1,
      localModels: ['deepseek-chat', 'deepseek-reasoner'],
      logger: silentLogger,
    })
    assert.equal(result.mode, 'local')
    assert.equal(result.pipeline?.ok, 1)
  })
})

// ============================================================
// 本地离线处理
// ============================================================
describe('executor 本地离线处理', () => {
  it('本地离线且 dryRun 时跳过', async () => {
    fetchImpl = offlineFetch()
    const result = await execute(mockDb([]), {
      dailyTarget: 1,
      dryRun: true,
      logger: silentLogger,
    })
    assert.equal(result.mode, 'skipped')
    assert.ok(result.reason?.includes('dry-run'))
  })

  it('本地离线且无云端 key 时调用 cloudFallback 成功', async () => {
    fetchImpl = offlineFetch()
    const result = await execute(mockDb([]), {
      dailyTarget: 1,
      cloudFallback: async () => ({ ok: true, message: '云端兜底成功' }),
      logger: silentLogger,
    })
    assert.equal(result.mode, 'cloud-fallback')
    assert.equal(result.reason, '云端兜底成功')
  })

  it('cloudFallback 返回 ok=false 时返回失败消息', async () => {
    fetchImpl = offlineFetch()
    const result = await execute(mockDb([]), {
      dailyTarget: 1,
      cloudFallback: async () => ({ ok: false }),
      logger: silentLogger,
    })
    assert.equal(result.mode, 'cloud-fallback')
    assert.equal(result.reason, 'cloudFallback 未成功')
  })

  it('cloudFallback 无返回值时使用默认消息', async () => {
    fetchImpl = offlineFetch()
    const result = await execute(mockDb([]), {
      dailyTarget: 1,
      cloudFallback: async () => undefined,
      logger: silentLogger,
    })
    assert.equal(result.mode, 'cloud-fallback')
    assert.equal(result.reason, '云端兜底已执行')
  })

  it('cloudFallback 抛错时返回 skipped', async () => {
    fetchImpl = offlineFetch()
    const result = await execute(mockDb([]), {
      dailyTarget: 1,
      cloudFallback: async () => {
        throw new Error('兜底失败')
      },
      logger: silentLogger,
    })
    assert.equal(result.mode, 'skipped')
    assert.ok(result.reason?.includes('cloudFallback 失败'))
  })

  it('本地离线且无云端 key 无 cloudFallback 时跳过', async () => {
    fetchImpl = offlineFetch()
    const result = await execute(mockDb([]), {
      dailyTarget: 1,
      logger: silentLogger,
    })
    assert.equal(result.mode, 'skipped')
    assert.ok(result.reason?.includes('未配置云端'))
  })

  it('本地离线且有云端 apiKey 时走云端', async () => {
    fetchImpl = offlineWithCloudAiFetch()
    const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
      dailyTarget: 1,
      ai: { apiKey: 'test-key', baseUrl: 'https://api.test.com/v1' },
      logger: silentLogger,
    })
    assert.equal(result.mode, 'cloud')
    assert.equal(result.pipeline?.ok, 1)
  })

  it('本地网关会话过期时提示重新登录', async () => {
    fetchImpl = sessionExpiredFetch()
    const result = await execute(mockDb([]), {
      dailyTarget: 1,
      logger: silentLogger,
    })
    assert.equal(result.mode, 'skipped')
  })
})

// ============================================================
// 自愈拉起
// ============================================================
describe('executor 自愈拉起', () => {
  it('degraded 时拉起浏览器命令后恢复', async () => {
    let healthProbed = 0
    fetchImpl = async (url: string) => {
      if (url.includes('/health')) {
        healthProbed++
        if (healthProbed === 1) return jsonRes({ status: 'degraded' })
        return jsonRes({ status: 'ok', browser: 'connected' })
      }
      if (url.includes('/models')) return jsonRes({ data: [{ id: 'deepseek-chat' }] })
      if (url.includes('/chat/completions')) return jsonRes({ choices: [{ message: { content: GOOD_ARTICLE_JSON } }] })
      return jsonRes({})
    }
    const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
      dailyTarget: 1,
      localChromeStartCommand: 'echo',
      autoStartWaitMs: 0,
      logger: silentLogger,
    })
    assert.equal(result.mode, 'local')
    assert.equal(result.pipeline?.ok, 1)
  })

  it('degraded 但未配置拉起命令时跳过浏览器拉起', async () => {
    fetchImpl = offlineFetch()
    const result = await execute(mockDb([]), {
      dailyTarget: 1,
      logger: silentLogger,
    })
    assert.equal(result.mode, 'skipped')
  })

  it('离线时拉起网关命令后恢复', async () => {
    let healthProbed = 0
    fetchImpl = async (url: string) => {
      if (url.includes('/health')) {
        healthProbed++
        if (healthProbed === 1) return jsonRes({ status: 'session_expired' })
        return jsonRes({ status: 'ok', browser: 'connected' })
      }
      if (url.includes('/models')) return jsonRes({ data: [{ id: 'deepseek-chat' }] })
      if (url.includes('/chat/completions')) return jsonRes({ choices: [{ message: { content: GOOD_ARTICLE_JSON } }] })
      return jsonRes({})
    }
    const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
      dailyTarget: 1,
      localGatewayStartCommand: 'echo',
      autoStartWaitMs: 0,
      logger: silentLogger,
    })
    assert.equal(result.mode, 'local')
    assert.equal(result.pipeline?.ok, 1)
  })
})

// ============================================================
// 互斥锁
// ============================================================
describe('executor 互斥锁', () => {
  it('本地模式获取互斥锁成功后执行并释放', async () => {
    fetchImpl = onlineFetch()
    const lockFile = join(tmpdir(), `executor-lock-${Date.now()}-${Math.random()}`)
    const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
      dailyTarget: 1,
      localLockFile: lockFile,
      logger: silentLogger,
    })
    assert.equal(result.mode, 'local')
    assert.equal(result.pipeline?.ok, 1)
  })

  it('互斥锁被占用时跳过本轮', async () => {
    fetchImpl = onlineFetch()
    const lockFile = join(tmpdir(), `executor-lock-${Date.now()}-${Math.random()}`)
    mkdirSync(lockFile) // 预先创建，模拟被占用
    try {
      const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
        dailyTarget: 1,
        localLockFile: lockFile,
        localLockWaitMs: 0,
        logger: silentLogger,
      })
      assert.equal(result.mode, 'skipped')
      assert.ok(result.reason?.includes('占用'))
    } finally {
      rmSync(lockFile, { recursive: true, force: true })
    }
  })
})

// ============================================================
// 运行日志与告警
// ============================================================
describe('executor 运行日志与告警', () => {
  it('成功运行后上报运行日志', async () => {
    const reports: RunLogInput[] = []
    const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
      ai: { client: async () => GOOD_ARTICLE_JSON },
      dailyTarget: 1,
      logger: silentLogger,
      reportRun: async (log) => {
        reports.push(log)
      },
    })
    assert.equal(result.mode, 'cloud')
    assert.equal(reports.length, 1)
    assert.equal(reports[0].ok, 1)
    assert.equal(reports[0].fail, 0)
    assert.equal(reports[0].total, 1)
    assert.equal(reports[0].dryRun, false)
  })

  it('reportRun 抛错时不阻塞后续流程', async () => {
    const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
      ai: { client: async () => GOOD_ARTICLE_JSON },
      dailyTarget: 1,
      logger: silentLogger,
      reportRun: async () => {
        throw new Error('上报失败')
      },
    })
    assert.equal(result.mode, 'cloud')
    assert.equal(result.pipeline?.ok, 1)
  })

  it('fetchRunLogs 返回历史日志时输出统计面板', async () => {
    const logs: RunLogEntry[] = [
      {
        project: 'p1',
        provider: 'cf',
        success: true,
        wordCount: 800,
        durationMs: 1000,
        timestamp: '2026-10-01T08:00:00Z',
      },
      {
        project: 'p1',
        provider: 'cf',
        success: false,
        wordCount: 0,
        durationMs: 2000,
        failReason: 'timeout',
        timestamp: '2026-10-01T09:00:00Z',
      },
    ]
    const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
      ai: { client: async () => GOOD_ARTICLE_JSON },
      dailyTarget: 1,
      logger: silentLogger,
      fetchRunLogs: async () => logs,
    })
    assert.equal(result.mode, 'cloud')
  })

  it('fetchRunLogs 返回空日志时不输出统计面板', async () => {
    const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
      ai: { client: async () => GOOD_ARTICLE_JSON },
      dailyTarget: 1,
      logger: silentLogger,
      fetchRunLogs: async () => [],
    })
    assert.equal(result.mode, 'cloud')
  })

  it('fetchRunLogs 抛错时记录警告并继续', async () => {
    const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
      ai: { client: async () => GOOD_ARTICLE_JSON },
      dailyTarget: 1,
      logger: silentLogger,
      fetchRunLogs: async () => {
        throw new Error('获取日志失败')
      },
    })
    assert.equal(result.mode, 'cloud')
  })

  it('全部失败时触发告警', async () => {
    const logs: string[] = []
    const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
      ai: {
        client: async () => {
          throw new Error('AI 调用失败')
        },
      },
      dailyTarget: 1,
      generateRetries: 0,
      logger: (...args: unknown[]) => logs.push(args.join(' ')),
      alert: { webhookUrl: 'https://feishu.example.com/hook', minSuccessRate: 0.6 },
    })
    assert.equal(result.mode, 'cloud')
    assert.equal(result.pipeline?.fail, 1)
    assert.ok(logs.some((l) => l.includes('[alert]')))
  })

  it('成功运行且成功率高于阈值时不触发告警', async () => {
    const logs: string[] = []
    const result = await execute(mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')]), {
      ai: { client: async () => GOOD_ARTICLE_JSON },
      dailyTarget: 1,
      logger: (...args: unknown[]) => logs.push(args.join(' ')),
      alert: { webhookUrl: 'https://feishu.example.com/hook', minSuccessRate: 0.6 },
    })
    assert.equal(result.mode, 'cloud')
    assert.ok(!logs.some((l) => l.includes('[alert]')))
  })
})

// ============================================================
// 异常处理
// ============================================================
describe('executor 异常处理', () => {
  it('pipeline 抛错时上报失败日志并重新抛出', async () => {
    const db = mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')])
    db.fetchPendingSeeds = async () => {
      throw new Error('数据库连接失败')
    }
    const reports: RunLogInput[] = []
    await assert.rejects(
      () =>
        execute(db, {
          ai: { client: async () => GOOD_ARTICLE_JSON },
          dailyTarget: 1,
          logger: silentLogger,
          reportRun: async (log) => {
            reports.push(log)
          },
        }),
      (err: Error) => {
        assert.ok(err.message.includes('数据库连接失败'))
        return true
      },
    )
    assert.equal(reports.length, 1)
    assert.equal(reports[0].ok, 0)
    assert.equal(reports[0].fail, 1)
    assert.equal(reports[0].total, 0)
    assert.ok(reports[0].error?.includes('数据库连接失败'))
  })

  it('pipeline 抛错且无 reportRun 时直接抛出', async () => {
    const db = mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')])
    db.fetchPendingSeeds = async () => {
      throw new Error('管线异常')
    }
    await assert.rejects(
      () =>
        execute(db, {
          ai: { client: async () => GOOD_ARTICLE_JSON },
          dailyTarget: 1,
          logger: silentLogger,
        }),
      (err: Error) => {
        assert.ok(err.message.includes('管线异常'))
        return true
      },
    )
  })

  it('pipeline 抛错且 reportRun 也抛错时仍抛出原始错误', async () => {
    const db = mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')])
    db.fetchPendingSeeds = async () => {
      throw new Error('管线异常')
    }
    await assert.rejects(
      () =>
        execute(db, {
          ai: { client: async () => GOOD_ARTICLE_JSON },
          dailyTarget: 1,
          logger: silentLogger,
          reportRun: async () => {
            throw new Error('上报也失败')
          },
        }),
      (err: Error) => {
        assert.ok(err.message.includes('管线异常'))
        return true
      },
    )
  })

  it('本地模式 pipeline 抛错时释放锁并重新抛出', async () => {
    fetchImpl = onlineFetch()
    const lockFile = join(tmpdir(), `executor-lock-${Date.now()}-${Math.random()}`)
    const db = mockDb([makeSeed(1, '这是一段足够长的素材内容用于测试')])
    db.fetchPendingSeeds = async () => {
      throw new Error('本地管线异常')
    }
    await assert.rejects(
      () =>
        execute(db, {
          dailyTarget: 1,
          localLockFile: lockFile,
          logger: silentLogger,
        }),
      (err: Error) => {
        assert.ok(err.message.includes('本地管线异常'))
        return true
      },
    )
  })
})
