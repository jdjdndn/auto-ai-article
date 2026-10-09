import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import {
  runCommand,
  createLocalGatewayClient,
  acquireLock,
  releaseLock,
  probeLocalGateway,
} from '../src/local-gateway.js'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// —— 辅助函数 ——

/** 获取原始 child_process 模块对象（import * as 在 CJS 下 spawn 不可枚举） */
const childProcessModule = createRequire(__filename)('node:child_process') as {
  spawn: (...args: unknown[]) => { on: (event: string, cb: (...args: unknown[]) => void) => void; kill: () => void }
}

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

/** mock setTimeout 让所有定时器立即触发，用于加速 withRetry 重试等待 */
function useFastTimers(): void {
  const fakeTimer: unknown = {
    ref: () => fakeTimer,
    unref: () => fakeTimer,
    hasRef: () => false,
    refresh: () => fakeTimer,
  }
  mock.method(globalThis, 'setTimeout', ((fn: (...args: unknown[]) => void) => {
    if (typeof fn === 'function') fn()
    return fakeTimer
  }) as unknown as typeof globalThis.setTimeout)
}

/** 创建唯一临时锁目录路径 */
let lockCounter = 0
function uniqueLockDir(): string {
  lockCounter++
  return join(tmpdir(), `lg-test-${process.pid}-${lockCounter}`)
}

const silentLogger = (..._args: unknown[]): void => {}

// ============================================================
// runCommand 自愈命令
// ============================================================
describe('runCommand 自愈命令', () => {
  it('空命令时跳过并记录日志', async () => {
    const logs: string[] = []
    await runCommand('', (...args) => logs.push(args.join(' ')))
    assert.ok(logs.some((l) => l.includes('自愈命令为空，跳过')))
  })

  it('空白字符串命令时跳过', async () => {
    const logs: string[] = []
    await runCommand('   ', (...args) => logs.push(args.join(' ')))
    assert.ok(logs.some((l) => l.includes('自愈命令为空，跳过')))
  })

  it('非字符串命令时跳过', async () => {
    const logs: string[] = []
    await runCommand(undefined as unknown as string, (...args) => logs.push(args.join(' ')))
    assert.ok(logs.some((l) => l.includes('自愈命令为空，跳过')))
  })

  it('正常命令执行完成', async () => {
    const logs: string[] = []
    await runCommand('echo test', (...args) => logs.push(args.join(' ')))
    assert.ok(logs.some((l) => l.includes('执行自愈命令: echo test')))
  })

  it('命令不存在时通过 exit 事件正常 resolve', async () => {
    const logs: string[] = []
    await runCommand('nonexistent-cmd-xyz-12345', (...args) => logs.push(args.join(' ')))
    assert.ok(logs.some((l) => l.includes('执行自愈命令')))
  })

  it('spawn 启动失败时记录日志并 resolve', async () => {
    mock.method(childProcessModule, 'spawn', () => {
      throw new Error('spawn 启动失败')
    })
    const logs: string[] = []
    await runCommand('echo test', (...args) => logs.push(args.join(' ')))
    assert.ok(logs.some((l) => l.includes('自愈命令启动失败')))
  })

  it('子进程 error 事件时正常 resolve', async () => {
    const fakeChild = {
      on(event: string, cb: (...args: unknown[]) => void) {
        if (event === 'error') cb(new Error('子进程错误'))
      },
      kill() {},
    }
    mock.method(childProcessModule, 'spawn', () => fakeChild)
    const logs: string[] = []
    await runCommand('echo test', (...args) => logs.push(args.join(' ')))
    assert.ok(logs.some((l) => l.includes('执行自愈命令')))
  })

  it('命令超时时 kill 并 resolve', async () => {
    useFastTimers()
    const fakeChild = {
      on(_event: string, _cb: (...args: unknown[]) => void) {},
      kill() {},
    }
    mock.method(childProcessModule, 'spawn', () => fakeChild)
    const logs: string[] = []
    await runCommand('echo test', (...args) => logs.push(args.join(' ')))
    assert.ok(logs.some((l) => l.includes('执行自愈命令')))
  })

  it('超时 kill 抛错时仍正常 resolve', async () => {
    useFastTimers()
    const fakeChild = {
      on(_event: string, _cb: (...args: unknown[]) => void) {},
      kill() {
        throw new Error('kill failed')
      },
    }
    mock.method(childProcessModule, 'spawn', () => fakeChild)
    const logs: string[] = []
    await runCommand('echo test', (...args) => logs.push(args.join(' ')))
    assert.ok(logs.some((l) => l.includes('执行自愈命令')))
  })
})

// ============================================================
// createLocalGatewayClient 本地网关客户端
// ============================================================
describe('createLocalGatewayClient 本地网关客户端', () => {
  it('正常请求返回内容', async () => {
    fetchImpl = async (url: string) => {
      if (url.includes('/chat/completions')) return jsonRes({ choices: [{ message: { content: '这是 AI 回复' } }] })
      return jsonRes({})
    }
    const client = createLocalGatewayClient({
      gateway: 'http://localhost:8080',
      models: ['deepseek-chat'],
      timeoutMs: 5000,
      logger: silentLogger,
    })
    const result = await client([{ role: 'user', content: '你好' }])
    assert.equal(result, '这是 AI 回复')
  })

  it('空模型列表时使用默认模型 deepseek-chat', async () => {
    let capturedModel = ''
    fetchImpl = async (url: string, init: unknown) => {
      if (url.includes('/chat/completions')) {
        capturedModel = JSON.parse((init as { body: string }).body).model
        return jsonRes({ choices: [{ message: { content: '回复' } }] })
      }
      return jsonRes({})
    }
    const client = createLocalGatewayClient({
      gateway: 'http://localhost:8080',
      models: [],
      timeoutMs: 5000,
      logger: silentLogger,
    })
    await client([{ role: 'user', content: '你好' }])
    assert.equal(capturedModel, 'deepseek-chat')
  })

  it('多模型时按 attempt 轮换', async () => {
    useFastTimers()
    const capturedModels: string[] = []
    let attempt = 0
    fetchImpl = async (url: string, init: unknown) => {
      if (url.includes('/chat/completions')) {
        const body = JSON.parse((init as { body: string }).body)
        capturedModels.push(body.model)
        attempt++
        if (attempt < 3) return jsonRes({}, 500)
        return jsonRes({ choices: [{ message: { content: '成功' } }] })
      }
      return jsonRes({})
    }
    const client = createLocalGatewayClient({
      gateway: 'http://localhost:8080',
      models: ['model-a', 'model-b'],
      timeoutMs: 5000,
      logger: silentLogger,
    })
    const result = await client([{ role: 'user', content: '你好' }])
    assert.equal(result, '成功')
    assert.equal(capturedModels[0], 'model-a')
    assert.equal(capturedModels[1], 'model-b')
    assert.equal(capturedModels[2], 'model-a')
  })

  it('HTTP 错误时记录失败日志并重试至失败', async () => {
    useFastTimers()
    fetchImpl = async () => jsonRes({}, 500)
    const logs: string[] = []
    const client = createLocalGatewayClient({
      gateway: 'http://localhost:8080',
      models: ['deepseek-chat'],
      timeoutMs: 5000,
      logger: (...args) => logs.push(args.join(' ')),
    })
    await assert.rejects(client([{ role: 'user', content: '你好' }]))
    assert.ok(logs.some((l) => l.includes('HTTP 500')))
    assert.ok(logs.length >= 3)
  })

  it('返回空内容时抛错并重试', async () => {
    useFastTimers()
    fetchImpl = async (url: string) => {
      if (url.includes('/chat/completions')) return jsonRes({ choices: [{ message: { content: '' } }] })
      return jsonRes({})
    }
    const logs: string[] = []
    const client = createLocalGatewayClient({
      gateway: 'http://localhost:8080',
      models: ['deepseek-chat'],
      timeoutMs: 5000,
      logger: (...args) => logs.push(args.join(' ')),
    })
    await assert.rejects(client([{ role: 'user', content: '你好' }]), /AI 网关没有返回内容/)
    assert.ok(logs.some((l) => l.includes('AI 网关没有返回内容')))
  })

  it('fetch 抛错时记录日志并重试', async () => {
    useFastTimers()
    fetchImpl = async () => {
      throw new Error('网络错误')
    }
    const logs: string[] = []
    const client = createLocalGatewayClient({
      gateway: 'http://localhost:8080',
      models: ['deepseek-chat'],
      timeoutMs: 5000,
      logger: (...args) => logs.push(args.join(' ')),
    })
    await assert.rejects(client([{ role: 'user', content: '你好' }]), /网络错误/)
    assert.ok(logs.some((l) => l.includes('网络错误')))
  })

  it('未提供 logger 时使用默认 console.log 不报错', async () => {
    fetchImpl = async (url: string) => {
      if (url.includes('/chat/completions')) return jsonRes({ choices: [{ message: { content: '回复' } }] })
      return jsonRes({})
    }
    const client = createLocalGatewayClient({
      gateway: 'http://localhost:8080',
      models: ['deepseek-chat'],
      timeoutMs: 5000,
    })
    const result = await client([{ role: 'user', content: '你好' }])
    assert.equal(result, '回复')
  })
})

// ============================================================
// acquireLock 互斥锁
// ============================================================
describe('acquireLock 互斥锁', () => {
  it('新锁获取成功并写入 owner.json', async () => {
    const dir = uniqueLockDir()
    try {
      const acquired = await acquireLock(dir, 0, 60_000, silentLogger)
      assert.equal(acquired, true)
      assert.ok(existsSync(join(dir, 'owner.json')))
    } finally {
      releaseLock(dir)
    }
  })

  it('锁存在且过期时强制接管', async () => {
    const dir = uniqueLockDir()
    try {
      mkdirSync(dir)
      writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid: 12345, ts: Date.now() - 120_000 }))
      const logs: string[] = []
      const acquired = await acquireLock(dir, 0, 60_000, (...args) => logs.push(args.join(' ')))
      assert.equal(acquired, true)
      assert.ok(logs.some((l) => l.includes('互斥锁已过期')))
    } finally {
      releaseLock(dir)
    }
  })

  it('锁存在且未过期且 waitMs=0 时返回 false', async () => {
    const dir = uniqueLockDir()
    try {
      mkdirSync(dir)
      writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid: 12345, ts: Date.now() }))
      const acquired = await acquireLock(dir, 0, 60_000, silentLogger)
      assert.equal(acquired, false)
    } finally {
      releaseLock(dir)
    }
  })

  it('锁存在且 owner.json 损坏时不接管', async () => {
    const dir = uniqueLockDir()
    try {
      mkdirSync(dir)
      writeFileSync(join(dir, 'owner.json'), 'not-json')
      const acquired = await acquireLock(dir, 0, 60_000, silentLogger)
      assert.equal(acquired, false)
    } finally {
      releaseLock(dir)
    }
  })

  it('锁存在且 owner.json 缺失时不接管', async () => {
    const dir = uniqueLockDir()
    try {
      mkdirSync(dir)
      const acquired = await acquireLock(dir, 0, 60_000, silentLogger)
      assert.equal(acquired, false)
    } finally {
      releaseLock(dir)
    }
  })

  it('owner.json 有 BOM 且过期时接管', async () => {
    const dir = uniqueLockDir()
    try {
      mkdirSync(dir)
      const bomJson = `\uFEFF${JSON.stringify({ pid: 12345, ts: Date.now() - 120_000 })}`
      writeFileSync(join(dir, 'owner.json'), bomJson)
      const logs: string[] = []
      const acquired = await acquireLock(dir, 0, 60_000, (...args) => logs.push(args.join(' ')))
      assert.equal(acquired, true)
      assert.ok(logs.some((l) => l.includes('互斥锁已过期')))
    } finally {
      releaseLock(dir)
    }
  })

  it('owner.ts 不是数字时不接管', async () => {
    const dir = uniqueLockDir()
    try {
      mkdirSync(dir)
      writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid: 12345, ts: 'not-a-number' }))
      const acquired = await acquireLock(dir, 0, 60_000, silentLogger)
      assert.equal(acquired, false)
    } finally {
      releaseLock(dir)
    }
  })

  it('锁存在且未过期时等待并最终获取', async () => {
    const dir = uniqueLockDir()
    try {
      mkdirSync(dir)
      writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid: 12345, ts: Date.now() }))
      // mock setTimeout：在 sleep 回调中删除锁目录，模拟其他进程释放锁
      mock.method(globalThis, 'setTimeout', ((fn: (...args: unknown[]) => void) => {
        rmSync(dir, { recursive: true, force: true })
        if (typeof fn === 'function') fn()
        return {} as unknown
      }) as unknown as typeof globalThis.setTimeout)
      const logs: string[] = []
      const acquired = await acquireLock(dir, 10_000, 60_000, (...args) => logs.push(args.join(' ')))
      assert.equal(acquired, true)
      assert.ok(logs.some((l) => l.includes('本地网关正被其他站点占用')))
    } finally {
      releaseLock(dir)
    }
  })
})

// ============================================================
// releaseLock 释放锁
// ============================================================
describe('releaseLock 释放锁', () => {
  it('释放存在的锁目录', () => {
    const dir = uniqueLockDir()
    mkdirSync(dir)
    writeFileSync(join(dir, 'owner.json'), '{}')
    assert.ok(existsSync(dir))
    releaseLock(dir)
    assert.ok(!existsSync(dir))
  })

  it('释放不存在的锁目录不抛错', () => {
    const dir = uniqueLockDir()
    assert.ok(!existsSync(dir))
    releaseLock(dir)
  })
})

// ============================================================
// probeLocalGateway 网关探测
// ============================================================
describe('probeLocalGateway 网关探测', () => {
  it('health ok 且 browser connected 时在线', async () => {
    fetchImpl = async (url: string) => {
      if (url.includes('/health')) return jsonRes({ status: 'ok', browser: 'connected' })
      if (url.includes('/models')) return jsonRes({ data: [{ id: 'deepseek-chat' }] })
      return jsonRes({})
    }
    const probe = await probeLocalGateway('http://localhost:8080')
    assert.equal(probe.online, true)
    assert.equal(probe.degraded, false)
    assert.equal(probe.sessionExpired, false)
    assert.deepEqual(probe.models, ['deepseek-chat'])
  })

  it('health ok 且 browser disconnected 时降级', async () => {
    fetchImpl = async (url: string) => {
      if (url.includes('/health')) return jsonRes({ status: 'ok', browser: 'disconnected' })
      if (url.includes('/models')) return jsonRes({ data: [{ id: 'deepseek-chat' }] })
      return jsonRes({})
    }
    const probe = await probeLocalGateway('http://localhost:8080')
    assert.equal(probe.online, false)
    assert.equal(probe.degraded, true)
  })

  it('health ok 且 browser 缺失时降级', async () => {
    fetchImpl = async (url: string) => {
      if (url.includes('/health')) return jsonRes({ status: 'ok' })
      if (url.includes('/models')) return jsonRes({ data: [] })
      return jsonRes({})
    }
    const probe = await probeLocalGateway('http://localhost:8080')
    assert.equal(probe.online, false)
    assert.equal(probe.degraded, true)
  })

  it('health degraded 时降级', async () => {
    fetchImpl = async (url: string) => {
      if (url.includes('/health')) return jsonRes({ status: 'degraded' })
      if (url.includes('/models')) return jsonRes({ data: [] })
      return jsonRes({})
    }
    const probe = await probeLocalGateway('http://localhost:8080')
    assert.equal(probe.online, false)
    assert.equal(probe.degraded, true)
    assert.equal(probe.sessionExpired, false)
  })

  it('health session_expired 时会话过期', async () => {
    fetchImpl = async (url: string) => {
      if (url.includes('/health')) return jsonRes({ status: 'session_expired' })
      if (url.includes('/models')) return jsonRes({ data: [] })
      return jsonRes({})
    }
    const probe = await probeLocalGateway('http://localhost:8080')
    assert.equal(probe.online, false)
    assert.equal(probe.sessionExpired, true)
    assert.equal(probe.degraded, false)
  })

  it('health 其它 status 时回退 /models 判断', async () => {
    fetchImpl = async (url: string) => {
      if (url.includes('/health')) return jsonRes({ status: 'unknown' })
      if (url.includes('/models')) return jsonRes({ data: [{ id: 'model-x' }] })
      return jsonRes({})
    }
    const probe = await probeLocalGateway('http://localhost:8080')
    assert.equal(probe.online, true)
    assert.deepEqual(probe.models, ['model-x'])
  })

  it('/health 返回 null 时回退 /models 判断', async () => {
    fetchImpl = async (url: string) => {
      if (url.includes('/health')) return jsonRes(null)
      if (url.includes('/models')) return jsonRes({ data: [{ id: 'model-x' }] })
      return jsonRes({})
    }
    const probe = await probeLocalGateway('http://localhost:8080')
    assert.equal(probe.online, true)
  })

  it('/health fetch 失败时回退 /models 判断', async () => {
    fetchImpl = async (url: string) => {
      if (url.includes('/health')) throw new Error('连接失败')
      if (url.includes('/models')) return jsonRes({ data: [{ id: 'model-x' }] })
      return jsonRes({})
    }
    const probe = await probeLocalGateway('http://localhost:8080')
    assert.equal(probe.online, true)
  })

  it('/health 非 200 时回退 /models 判断', async () => {
    fetchImpl = async (url: string) => {
      if (url.includes('/health')) return jsonRes({}, 404)
      if (url.includes('/models')) return jsonRes({ data: [{ id: 'model-x' }] })
      return jsonRes({})
    }
    const probe = await probeLocalGateway('http://localhost:8080')
    assert.equal(probe.online, true)
  })

  it('/models 返回空列表时会话过期', async () => {
    fetchImpl = async (url: string) => {
      if (url.includes('/health')) return jsonRes({}, 404)
      if (url.includes('/models')) return jsonRes({ data: [] })
      return jsonRes({})
    }
    const probe = await probeLocalGateway('http://localhost:8080')
    assert.equal(probe.online, false)
    assert.equal(probe.sessionExpired, true)
  })

  it('/models 返回非数组时为空列表', async () => {
    fetchImpl = async (url: string) => {
      if (url.includes('/health')) return jsonRes({}, 404)
      if (url.includes('/models')) return jsonRes({ data: 'not-array' })
      return jsonRes({})
    }
    const probe = await probeLocalGateway('http://localhost:8080')
    assert.equal(probe.online, false)
    assert.equal(probe.sessionExpired, true)
    assert.deepEqual(probe.models, [])
  })

  it('/models fetch 失败时为空列表', async () => {
    fetchImpl = async (url: string) => {
      if (url.includes('/health')) return jsonRes({}, 404)
      if (url.includes('/models')) throw new Error('连接失败')
      return jsonRes({})
    }
    const probe = await probeLocalGateway('http://localhost:8080')
    assert.equal(probe.online, false)
    assert.equal(probe.sessionExpired, true)
    assert.deepEqual(probe.models, [])
  })

  it('/models 模型无 id 或空 id 时被过滤', async () => {
    fetchImpl = async (url: string) => {
      if (url.includes('/health')) return jsonRes({ status: 'ok', browser: 'connected' })
      if (url.includes('/models'))
        return jsonRes({ data: [{ id: 'model-a' }, { name: 'no-id' }, { id: '' }, { id: '  ' }] })
      return jsonRes({})
    }
    const probe = await probeLocalGateway('http://localhost:8080')
    assert.deepEqual(probe.models, ['model-a'])
    assert.equal(probe.online, true)
  })

  it('/models 无 data 字段时为空列表', async () => {
    fetchImpl = async (url: string) => {
      if (url.includes('/health')) return jsonRes({ status: 'ok', browser: 'connected' })
      if (url.includes('/models')) return jsonRes({})
      return jsonRes({})
    }
    const probe = await probeLocalGateway('http://localhost:8080')
    assert.deepEqual(probe.models, [])
    assert.equal(probe.online, true)
  })

  it('自定义 timeoutMs 传参不报错', async () => {
    fetchImpl = async (url: string) => {
      if (url.includes('/health')) return jsonRes({ status: 'ok', browser: 'connected' })
      if (url.includes('/models')) return jsonRes({ data: [{ id: 'm1' }] })
      return jsonRes({})
    }
    const probe = await probeLocalGateway('http://localhost:8080', 3_000)
    assert.equal(probe.online, true)
    assert.deepEqual(probe.models, ['m1'])
  })
})
