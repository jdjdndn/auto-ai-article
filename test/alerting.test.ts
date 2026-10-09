import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { checkAndAlert, type AlertConfig, type AlertContext } from '../src/alerting.js'

interface FetchCall {
  url: string
  method: string
  body: string
}

const originalFetch = globalThis.fetch
let calls: FetchCall[] = []
let mockOk = true
let mockStatus = 200
let mockError: Error | null = null

beforeEach(() => {
  calls = []
  mockOk = true
  mockStatus = 200
  mockError = null
  globalThis.fetch = ((url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? '', body: init?.body ? String(init.body) : '' })
    if (mockError) return Promise.reject(mockError)
    return Promise.resolve({ ok: mockOk, status: mockStatus } as unknown as Response)
  }) as typeof globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

function ctx(over: Partial<AlertContext> = {}): AlertContext {
  return { ok: 0, fail: 0, total: 0, mode: 'test', ...over }
}

function cfg(over: Partial<AlertConfig> = {}): AlertConfig {
  return { webhookUrl: 'https://hook.example.com/generic', ...over }
}

describe('alerting 告警触发条件', () => {
  it('成功率高于阈值时不告警', async () => {
    const res = await checkAndAlert(ctx({ ok: 9, fail: 1, total: 10 }), cfg())
    assert.equal(res.triggered, false)
    assert.equal(res.reason, undefined)
    assert.equal(calls.length, 0)
  })

  it('total 为 0 且无失败时不告警', async () => {
    const res = await checkAndAlert(ctx({ ok: 0, fail: 0, total: 0 }), cfg())
    assert.equal(res.triggered, false)
    assert.equal(calls.length, 0)
  })

  it('alertOnAllFail 为 false 时不触发全部失败告警', async () => {
    const res = await checkAndAlert(ctx({ ok: 0, fail: 5, total: 0 }), cfg({ alertOnAllFail: false }))
    assert.equal(res.triggered, false)
    assert.equal(calls.length, 0)
  })
})

describe('alerting 告警触发与通知渠道', () => {
  it('成功率低于阈值触发告警并通过 feishu 渠道发送', async () => {
    const res = await checkAndAlert(
      ctx({ ok: 1, fail: 9, total: 10, mode: 'batch' }),
      cfg({ webhookUrl: 'https://open.feishu.cn/hook/xxx' }),
    )
    assert.equal(res.triggered, true)
    assert.ok(res.reason?.includes('低于阈值'))
    assert.equal(res.message, '告警已发送')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://open.feishu.cn/hook/xxx')
    assert.equal(calls[0].method, 'POST')
    const payload = JSON.parse(calls[0].body) as Record<string, unknown>
    assert.equal(payload.msg_type, 'text')
    assert.ok(String((payload.content as { text: string }).text).includes('batch'))
    assert.ok(String((payload.content as { text: string }).text).includes('成功率 10%'))
  })

  it('通过 dingtalk 渠道发送', async () => {
    const res = await checkAndAlert(
      ctx({ ok: 0, fail: 10, total: 10 }),
      cfg({ webhookUrl: 'https://oapi.dingtalk.com/robot/send' }),
    )
    assert.equal(res.triggered, true)
    assert.equal(res.message, '告警已发送')
    const payload = JSON.parse(calls[0].body) as Record<string, unknown>
    assert.equal(payload.msgtype, 'text')
    assert.ok(String((payload.text as { content: string }).content).includes('AI 文章生成告警'))
  })

  it('通过 generic 渠道发送', async () => {
    const res = await checkAndAlert(
      ctx({ ok: 2, fail: 8, total: 10 }),
      cfg({ webhookUrl: 'https://hook.example.com/notify' }),
    )
    assert.equal(res.triggered, true)
    const payload = JSON.parse(calls[0].body) as Record<string, unknown>
    assert.ok(typeof payload.text === 'string')
    assert.ok(String(payload.text).includes('成功率 20%'))
  })

  it('显式指定 channel 时跳过自动检测', async () => {
    const res = await checkAndAlert(
      ctx({ ok: 1, fail: 9, total: 10 }),
      cfg({ webhookUrl: 'https://hook.example.com/notify', channel: 'feishu' }),
    )
    assert.equal(res.triggered, true)
    const payload = JSON.parse(calls[0].body) as Record<string, unknown>
    assert.equal(payload.msg_type, 'text')
  })

  it('channel 为 auto 时自动检测渠道', async () => {
    const res = await checkAndAlert(
      ctx({ ok: 1, fail: 9, total: 10 }),
      cfg({ webhookUrl: 'https://open.feishu.cn/hook', channel: 'auto' }),
    )
    assert.equal(res.triggered, true)
    const payload = JSON.parse(calls[0].body) as Record<string, unknown>
    assert.equal(payload.msg_type, 'text')
  })
})

describe('alerting 全部失败与降级', () => {
  it('total 为 0 且全部失败时触发全部失败告警', async () => {
    const res = await checkAndAlert(
      ctx({ ok: 0, fail: 5, total: 0 }),
      cfg({ webhookUrl: 'https://hook.example.com/notify' }),
    )
    assert.equal(res.triggered, true)
    assert.equal(res.reason, '全部失败')
    assert.equal(res.message, '告警已发送')
  })

  it('webhook 返回 HTTP 错误时降级返回状态码', async () => {
    mockOk = false
    mockStatus = 500
    const res = await checkAndAlert(ctx({ ok: 1, fail: 9, total: 10 }), cfg())
    assert.equal(res.triggered, true)
    assert.equal(res.message, 'webhook HTTP 500')
  })

  it('webhook 抛出异常时降级返回错误信息', async () => {
    mockError = new Error('network down')
    const res = await checkAndAlert(ctx({ ok: 1, fail: 9, total: 10 }), cfg())
    assert.equal(res.triggered, true)
    assert.equal(res.message, 'webhook 发送失败: network down')
  })
})

describe('alerting 消息格式化', () => {
  it('包含站点标签、阈值、历史成功率与错误信息', async () => {
    const res = await checkAndAlert(
      ctx({
        ok: 3,
        fail: 7,
        total: 10,
        mode: 'cron',
        historicalSuccessRate: 0.85,
        errors: ['e1', 'e2', 'e3', 'e4'],
      }),
      cfg({ webhookUrl: 'https://hook.example.com/notify', siteLabel: '站点A', minSuccessRate: 0.8 }),
    )
    assert.equal(res.triggered, true)
    const payload = JSON.parse(calls[0].body) as Record<string, unknown>
    const text = String(payload.text)
    assert.ok(text.includes('[站点A]'))
    assert.ok(text.includes('阈值: 成功率 < 80%'))
    assert.ok(text.includes('历史成功率: 85%'))
    assert.ok(text.includes('错误: e1; e2; e3'))
  })

  it('lark URL 识别为 feishu 渠道', async () => {
    const res = await checkAndAlert(
      ctx({ ok: 1, fail: 9, total: 10 }),
      cfg({ webhookUrl: 'https://open.larksuite.com/hook' }),
    )
    assert.equal(res.triggered, true)
    const payload = JSON.parse(calls[0].body) as Record<string, unknown>
    assert.equal(payload.msg_type, 'text')
  })

  it('dingtalk URL 识别为 dingtalk 渠道', async () => {
    const res = await checkAndAlert(
      ctx({ ok: 1, fail: 9, total: 10 }),
      cfg({ webhookUrl: 'https://dingtalk.example.com/hook' }),
    )
    assert.equal(res.triggered, true)
    const payload = JSON.parse(calls[0].body) as Record<string, unknown>
    assert.equal(payload.msgtype, 'text')
  })

  it('minSuccessRate 为 0 时不输出阈值行', async () => {
    const res = await checkAndAlert(
      ctx({ ok: 0, fail: 10, total: 10 }),
      cfg({ webhookUrl: 'https://hook.example.com/notify', minSuccessRate: 0 }),
    )
    assert.equal(res.triggered, true)
    assert.equal(res.reason, '全部失败')
    const payload = JSON.parse(calls[0].body) as Record<string, unknown>
    assert.ok(!String(payload.text).includes('阈值'))
  })
})
