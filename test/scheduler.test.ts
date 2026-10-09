import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  getNextAlarmTime,
  applyWorkerEnv,
  initDoAlarm,
  rescheduleDoAlarm,
  ArticleScheduler,
  startScheduler,
  createDailyAlarmPlugin,
  createScheduledPlugin,
} from '../src/scheduler.js'
import type { Seed } from '../src/types.js'

// ============================================================
// mock 工具函数
// ============================================================

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

interface MockStorage {
  getAlarm(): Promise<number | null>
  setAlarm(ts: number): Promise<void>
  _getAlarm(): number | null
}

function mockStorage(opts: { alarm?: number | null } = {}): MockStorage {
  let alarm: number | null = opts.alarm ?? null
  return {
    async getAlarm() {
      return alarm
    },
    async setAlarm(ts: number) {
      alarm = ts
    },
    _getAlarm() {
      return alarm
    },
  }
}

interface MockDrizzleDb {
  select(): unknown
  insert(): unknown
  update(): unknown
}

function mockDrizzleDb(opts: { pendingSeeds?: Seed[]; insertError?: Error; selectError?: Error } = {}): MockDrizzleDb {
  const pendingSeeds = opts.pendingSeeds || []
  const queryable = {
    from: () => queryable,
    where: () => queryable,
    orderBy: () => queryable,
    limit: () => {
      if (opts.selectError) return Promise.reject(opts.selectError)
      return Promise.resolve(pendingSeeds)
    },
  }
  const insertable = {
    values: () => {
      if (opts.insertError) return Promise.reject(opts.insertError)
      return Promise.resolve()
    },
  }
  const updatable = {
    set: () => updatable,
    where: () => Promise.resolve(),
  }
  return {
    select: () => queryable,
    insert: () => insertable,
    update: () => updatable,
  }
}

interface MockNitroApp {
  hooks: { hook(name: string, fn: (...args: unknown[]) => unknown): void }
  _hooks: Record<string, (...args: unknown[]) => unknown>
}

function mockNitroApp(): MockNitroApp {
  const hooks: Record<string, (...args: unknown[]) => unknown> = {}
  return {
    hooks: {
      hook(name: string, fn: (...args: unknown[]) => unknown) {
        hooks[name] = fn
      },
    },
    _hooks: hooks,
  }
}

function setSchedulerConfig(scheduler: ArticleScheduler, config: unknown): void {
  Object.assign(scheduler, { _config: config })
}

// 高质量文章 JSON（通过质量门控）
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

// 选题数组 JSON
const TOPICS_JSON = JSON.stringify([{ title: '测试选题', angle: '测试角度', category: '优惠' }])

// ============================================================
// getNextAlarmTime
// ============================================================

describe('getNextAlarmTime', () => {
  it('目标时间在未来时返回当天时间', () => {
    // UTC 23:00 = 北京 07:00，目标 08:00 在未来
    const from = new Date('2026-01-15T23:00:00Z')
    const result = getNextAlarmTime('08:00', from)
    // 北京 08:00 = UTC 00:00 次日
    assert.equal(result, Date.parse('2026-01-16T00:00:00Z'))
  })

  it('目标时间已过时返回次日时间', () => {
    // UTC 06:00 = 北京 14:00，目标 08:00 已过
    const from = new Date('2026-01-15T06:00:00Z')
    const result = getNextAlarmTime('08:00', from)
    assert.equal(result, Date.parse('2026-01-16T00:00:00Z'))
  })

  it('目标时间刚好等于当前时间时返回次日（边界 <=）', () => {
    // UTC 00:00 = 北京 08:00，目标 08:00 刚好等于当前
    const from = new Date('2026-01-15T00:00:00Z')
    const result = getNextAlarmTime('08:00', from)
    // target <= now（相等），加一天
    assert.equal(result, Date.parse('2026-01-16T00:00:00Z'))
  })

  it('带分钟的时间正确计算', () => {
    // UTC 00:00 = 北京 08:00，目标 08:30 在未来
    const from = new Date('2026-01-15T00:00:00Z')
    const result = getNextAlarmTime('08:30', from)
    // 北京 08:30 = UTC 00:30
    assert.equal(result, Date.parse('2026-01-15T00:30:00Z'))
  })

  it('时区偏移 UTC+8 正确处理', () => {
    // UTC 20:00 = 北京 04:00，目标 08:00 在未来
    const from = new Date('2026-01-15T20:00:00Z')
    const result = getNextAlarmTime('08:00', from)
    assert.equal(result, Date.parse('2026-01-16T00:00:00Z'))
  })

  it('夏季日期正确计算（中国无夏令时）', () => {
    // UTC 06:00 = 北京 14:00，目标 08:00 已过
    const from = new Date('2026-07-15T06:00:00Z')
    const result = getNextAlarmTime('08:00', from)
    assert.equal(result, Date.parse('2026-07-16T00:00:00Z'))
  })

  it('跨月计算正确', () => {
    // UTC 06:00 = 北京 14:00，目标 08:00 已过，次日跨月
    const from = new Date('2026-01-31T06:00:00Z')
    const result = getNextAlarmTime('08:00', from)
    assert.equal(result, Date.parse('2026-02-01T00:00:00Z'))
  })

  it('不传 from 时使用当前时间且返回合理时间戳', () => {
    const result = getNextAlarmTime('08:00')
    assert.ok(typeof result === 'number')
    assert.ok(result > Date.now())
  })
})

// ============================================================
// applyWorkerEnv
// ============================================================

describe('applyWorkerEnv', () => {
  it('env 为 null 时直接返回不设置任何东西', () => {
    const before = (globalThis as unknown as { __env__?: unknown }).__env__
    applyWorkerEnv(null)
    assert.equal((globalThis as unknown as { __env__?: unknown }).__env__, before)
  })

  it('env 为 undefined 时直接返回', () => {
    const before = (globalThis as unknown as { __env__?: unknown }).__env__
    applyWorkerEnv(undefined)
    assert.equal((globalThis as unknown as { __env__?: unknown }).__env__, before)
  })

  it('env 含 DB 和 AI 时全部注入', () => {
    const env = { DB: 'db-binding', AI: 'ai-binding' }
    applyWorkerEnv(env)
    assert.equal((globalThis as unknown as { __env__: unknown }).__env__, env)
    assert.equal((process.env as unknown as { DB: string }).DB, 'db-binding')
    assert.equal((process.env as unknown as { AI: string }).AI, 'ai-binding')
  })

  it('env 仅含 DB 时只注入 DB', () => {
    const env = { DB: 'db-only' }
    applyWorkerEnv(env)
    assert.equal((globalThis as unknown as { __env__: unknown }).__env__, env)
    assert.equal((process.env as unknown as { DB: string }).DB, 'db-only')
  })

  it('env 为空对象时只设置 __env__', () => {
    const env = {}
    applyWorkerEnv(env)
    assert.equal((globalThis as unknown as { __env__: unknown }).__env__, env)
  })
})

// ============================================================
// initDoAlarm
// ============================================================

describe('initDoAlarm', () => {
  it('已有 alarm 时返回 null 且不调用 setAlarm', async () => {
    const storage = mockStorage({ alarm: 1234567890 })
    const result = await initDoAlarm(storage, '08:00')
    assert.equal(result, null)
    assert.equal(storage._getAlarm(), 1234567890)
  })

  it('无 alarm 时设置并返回时间戳', async () => {
    const storage = mockStorage({ alarm: null })
    const result = await initDoAlarm(storage, '08:00')
    assert.ok(typeof result === 'number')
    assert.ok(result! > 0)
    assert.equal(storage._getAlarm(), result)
  })
})

// ============================================================
// rescheduleDoAlarm
// ============================================================

describe('rescheduleDoAlarm', () => {
  it('总是设置 alarm 并返回时间戳', async () => {
    const storage = mockStorage({ alarm: null })
    const result = await rescheduleDoAlarm(storage, '08:00')
    assert.ok(typeof result === 'number')
    assert.ok(result > 0)
    assert.equal(storage._getAlarm(), result)
  })

  it('覆盖已有 alarm 时间戳', async () => {
    const storage = mockStorage({ alarm: 1234567890 })
    const result = await rescheduleDoAlarm(storage, '10:30')
    assert.ok(typeof result === 'number')
    assert.equal(storage._getAlarm(), result)
    assert.notEqual(result, 1234567890)
  })
})

// ============================================================
// ArticleScheduler
// ============================================================

describe('ArticleScheduler', () => {
  it('start 无已有 alarm 时设置首次 alarm', async () => {
    const storage = mockStorage({ alarm: null })
    const scheduler = new ArticleScheduler({ storage }, {})
    const result = await scheduler.start()
    assert.ok(result.scheduled)
    assert.ok(storage._getAlarm() !== null)
  })

  it('start 已有 alarm 时返回已有时间', async () => {
    const existing = 1234567890
    const storage = mockStorage({ alarm: existing })
    const scheduler = new ArticleScheduler({ storage }, {})
    const result = await scheduler.start()
    assert.equal(result.scheduled, new Date(existing).toISOString())
    assert.equal(storage._getAlarm(), existing)
  })

  it('start 带自定义 time', async () => {
    const storage = mockStorage({ alarm: null })
    const scheduler = new ArticleScheduler({ storage }, {})
    const result = await scheduler.start({ time: '10:30' })
    assert.ok(result.scheduled)
    assert.ok(storage._getAlarm()! > 0)
  })

  it('start 默认 time 为 08:00', async () => {
    const storage = mockStorage({ alarm: null })
    const scheduler = new ArticleScheduler({ storage }, {})
    const result = await scheduler.start({})
    assert.ok(result.scheduled)
  })

  it('getStatus 有 alarm 时返回 hasAlarm=true', async () => {
    const storage = mockStorage({ alarm: 1234567890 })
    const scheduler = new ArticleScheduler({ storage }, {})
    const status = await scheduler.getStatus()
    assert.equal(status.hasAlarm, true)
    assert.equal(status.nextAlarm, new Date(1234567890).toISOString())
  })

  it('getStatus 无 alarm 时返回 hasAlarm=false', async () => {
    const storage = mockStorage({ alarm: null })
    const scheduler = new ArticleScheduler({ storage }, {})
    const status = await scheduler.getStatus()
    assert.equal(status.hasAlarm, false)
    assert.equal(status.nextAlarm, null)
  })

  it('alarm 执行成功后设置下次 alarm', async () => {
    const storage = mockStorage({ alarm: null })
    const db = mockDrizzleDb({
      pendingSeeds: [makeSeed(1, '这是一段足够长的素材内容用于测试')],
    })
    const scheduler = new ArticleScheduler({ storage }, { DB: db })
    setSchedulerConfig(scheduler, {
      executorConfig: {
        ai: { client: async () => GOOD_ARTICLE_JSON },
        dailyTarget: 1,
        quality: { threshold: 60 },
      },
    })
    await scheduler.alarm()
    assert.ok(storage._getAlarm() !== null, 'scheduleNext 应被调用')
  })

  it('alarm 入库失败后仍设置下次 alarm', async () => {
    const storage = mockStorage({ alarm: null })
    const db = mockDrizzleDb({
      pendingSeeds: [makeSeed(1, '这是一段足够长的素材内容用于测试')],
      insertError: new Error('insert failed'),
    })
    const scheduler = new ArticleScheduler({ storage }, { DB: db })
    setSchedulerConfig(scheduler, {
      executorConfig: {
        ai: { client: async () => GOOD_ARTICLE_JSON },
        dailyTarget: 1,
        quality: { threshold: 60 },
      },
    })
    await scheduler.alarm()
    assert.ok(storage._getAlarm() !== null, '即使入库失败也应设置下次 alarm')
  })

  it('alarm 空种子时触发 AI 选题补足', async () => {
    const storage = mockStorage({ alarm: null })
    const db = mockDrizzleDb({ pendingSeeds: [] })
    const scheduler = new ArticleScheduler({ storage }, { DB: db })
    setSchedulerConfig(scheduler, {
      executorConfig: {
        ai: { client: async () => TOPICS_JSON },
        dailyTarget: 1,
      },
    })
    await scheduler.alarm()
    assert.ok(storage._getAlarm() !== null, '选题后仍应设置下次 alarm')
  })

  it('alarm execute 异常时捕获错误并仍设置下次 alarm', async () => {
    const storage = mockStorage({ alarm: null })
    const db = mockDrizzleDb({ selectError: new Error('select failed') })
    const scheduler = new ArticleScheduler({ storage }, { DB: db })
    setSchedulerConfig(scheduler, {
      executorConfig: {
        ai: { client: async () => GOOD_ARTICLE_JSON },
        dailyTarget: 1,
      },
    })
    await scheduler.alarm()
    assert.ok(storage._getAlarm() !== null, '即使执行异常也应设置下次 alarm')
  })
})

// ============================================================
// startScheduler
// ============================================================

describe('startScheduler', () => {
  it('返回 start 和 getStatus 方法并调用 DO stub', async () => {
    let startCalled = false
    let getStatusCalled = false
    const mockStub = {
      start: async (_config: unknown) => {
        startCalled = true
        return { scheduled: '2026-01-16T00:00:00.000Z' }
      },
      getStatus: async () => {
        getStatusCalled = true
        return { hasAlarm: true, nextAlarm: '2026-01-16T00:00:00.000Z' }
      },
    }
    const mockEnv = {
      ARTICLE_SCHEDULER: {
        idFromName: () => 'mock-id',
        get: () => mockStub,
      },
    }
    const scheduler = startScheduler(mockEnv, { time: '08:00' })
    const startResult = await scheduler.start()
    assert.ok(startCalled, 'stub.start 应被调用')
    assert.equal(startResult.scheduled, '2026-01-16T00:00:00.000Z')
    const statusResult = await scheduler.getStatus()
    assert.ok(getStatusCalled, 'stub.getStatus 应被调用')
    assert.equal(statusResult.hasAlarm, true)
  })

  it('默认 config 为空对象', async () => {
    const mockStub = {
      start: async (config: unknown) => ({ scheduled: '2026-01-16T00:00:00.000Z', config }),
      getStatus: async () => ({ hasAlarm: false, nextAlarm: null }),
    }
    const mockEnv = {
      ARTICLE_SCHEDULER: {
        idFromName: () => 'mock-id',
        get: () => mockStub,
      },
    }
    const scheduler = startScheduler(mockEnv)
    await scheduler.start()
    assert.ok(true, '默认 config 不报错')
  })
})

// ============================================================
// createDailyAlarmPlugin
// ============================================================

describe('createDailyAlarmPlugin', () => {
  it('返回函数并注册 init 和 alarm hooks', () => {
    const nitroApp = mockNitroApp()
    const plugin = createDailyAlarmPlugin({ generate: async () => ({ ok: true }) })
    plugin(nitroApp)
    assert.ok(typeof nitroApp._hooks['cloudflare:durable:init'] === 'function')
    assert.ok(typeof nitroApp._hooks['cloudflare:durable:alarm'] === 'function')
  })

  it('默认 alarmTime 为 08:00', async () => {
    const nitroApp = mockNitroApp()
    const plugin = createDailyAlarmPlugin({ generate: async () => ({ ok: true }) })
    plugin(nitroApp)
    const storage = mockStorage({ alarm: null })
    await nitroApp._hooks['cloudflare:durable:init']({}, { state: { storage } })
    assert.ok(storage._getAlarm() !== null, 'init hook 应设置 alarm')
  })

  it('自定义 alarmTime 生效', async () => {
    const nitroApp = mockNitroApp()
    const plugin = createDailyAlarmPlugin({
      alarmTime: '10:30',
      generate: async () => ({ ok: true }),
    })
    plugin(nitroApp)
    const storage = mockStorage({ alarm: null })
    await nitroApp._hooks['cloudflare:durable:init']({}, { state: { storage } })
    assert.ok(storage._getAlarm() !== null, '自定义 alarmTime 应设置 alarm')
  })

  it('alarm hook 正常路径：onAlarm + generate + reschedule', async () => {
    const nitroApp = mockNitroApp()
    let generateCalled = false
    let onAlarmCalled = false
    const plugin = createDailyAlarmPlugin({
      generate: async () => {
        generateCalled = true
        return { ok: true }
      },
      onAlarm: async () => {
        onAlarmCalled = true
      },
    })
    plugin(nitroApp)
    const storage = mockStorage({ alarm: null })
    const durable = { env: {}, ctx: { storage } }
    await nitroApp._hooks['cloudflare:durable:alarm'](durable)
    assert.ok(onAlarmCalled, 'onAlarm 应被调用')
    assert.ok(generateCalled, 'generate 应被调用')
    assert.ok(storage._getAlarm() !== null, 'reschedule 应被调用')
  })

  it('alarm hook 无 onAlarm 时正常执行', async () => {
    const nitroApp = mockNitroApp()
    let generateCalled = false
    const plugin = createDailyAlarmPlugin({
      generate: async () => {
        generateCalled = true
        return { ok: true }
      },
    })
    plugin(nitroApp)
    const storage = mockStorage({ alarm: null })
    const durable = { env: {}, ctx: { storage } }
    await nitroApp._hooks['cloudflare:durable:alarm'](durable)
    assert.ok(generateCalled)
    assert.ok(storage._getAlarm() !== null)
  })

  it('alarm hook onAlarm 失败时仍继续 generate', async () => {
    const nitroApp = mockNitroApp()
    let generateCalled = false
    const plugin = createDailyAlarmPlugin({
      generate: async () => {
        generateCalled = true
        return { ok: true }
      },
      onAlarm: async () => {
        throw new Error('onAlarm failed')
      },
    })
    plugin(nitroApp)
    const storage = mockStorage({ alarm: null })
    const durable = { env: {}, ctx: { storage } }
    await nitroApp._hooks['cloudflare:durable:alarm'](durable)
    assert.ok(generateCalled, 'onAlarm 失败后 generate 仍应执行')
    assert.ok(storage._getAlarm() !== null)
  })

  it('alarm hook generate 失败时仍 reschedule', async () => {
    const nitroApp = mockNitroApp()
    const plugin = createDailyAlarmPlugin({
      generate: async () => {
        throw new Error('generate failed')
      },
    })
    plugin(nitroApp)
    const storage = mockStorage({ alarm: null })
    const durable = { env: {}, ctx: { storage } }
    await nitroApp._hooks['cloudflare:durable:alarm'](durable)
    assert.ok(storage._getAlarm() !== null, 'generate 失败后仍应 reschedule')
  })

  it('alarm hook reschedule 失败时不抛出异常', async () => {
    const nitroApp = mockNitroApp()
    const plugin = createDailyAlarmPlugin({
      generate: async () => ({ ok: true }),
    })
    plugin(nitroApp)
    const storage = {
      async getAlarm() {
        return null
      },
      async setAlarm() {
        throw new Error('setAlarm failed')
      },
    }
    const durable = { env: {}, ctx: { storage } }
    // 不应抛出异常
    await nitroApp._hooks['cloudflare:durable:alarm'](durable)
    assert.ok(true, 'reschedule 失败被捕获')
  })
})

// ============================================================
// createScheduledPlugin
// ============================================================

describe('createScheduledPlugin', () => {
  it('返回函数并注册 scheduled hook', () => {
    const nitroApp = mockNitroApp()
    const plugin = createScheduledPlugin({ generate: async () => ({ ok: true }) })
    plugin(nitroApp)
    assert.ok(typeof nitroApp._hooks['cloudflare:scheduled'] === 'function')
  })

  it('scheduled hook 正常路径返回 generate 结果', async () => {
    const nitroApp = mockNitroApp()
    const plugin = createScheduledPlugin({
      generate: async () => ({ ok: true, count: 3 }),
    })
    plugin(nitroApp)
    const result = await nitroApp._hooks['cloudflare:scheduled']({ env: {} })
    assert.deepEqual(result, { ok: true, count: 3 })
  })

  it('scheduled hook generate 失败时返回错误对象', async () => {
    const nitroApp = mockNitroApp()
    const plugin = createScheduledPlugin({
      generate: async () => {
        throw new Error('generate failed')
      },
    })
    plugin(nitroApp)
    const result = (await nitroApp._hooks['cloudflare:scheduled']({ env: {} })) as { ok: boolean; error: string }
    assert.equal(result.ok, false)
    assert.equal(result.error, 'generate failed')
  })

  it('scheduled hook 注入 env 到全局', async () => {
    const nitroApp = mockNitroApp()
    const plugin = createScheduledPlugin({ generate: async () => ({ ok: true }) })
    plugin(nitroApp)
    const env = { DB: 'test-db', AI: 'test-ai' }
    await nitroApp._hooks['cloudflare:scheduled']({ env })
    assert.equal((globalThis as unknown as { __env__: unknown }).__env__, env)
    assert.equal((process.env as unknown as { DB: string }).DB, 'test-db')
    assert.equal((process.env as unknown as { AI: string }).AI, 'test-ai')
  })

  it('scheduled hook payload 为空时不崩溃', async () => {
    const nitroApp = mockNitroApp()
    const plugin = createScheduledPlugin({ generate: async () => ({ ok: true }) })
    plugin(nitroApp)
    const result = await nitroApp._hooks['cloudflare:scheduled'](undefined)
    assert.deepEqual(result, { ok: true })
  })
})
