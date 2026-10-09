import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseArgs, usage, createDemoDB, main } from '../src/cli.js'

// ============================================================
// parseArgs — 参数解析
// ============================================================
describe('cli parseArgs 参数解析', () => {
  it('空参数返回空对象', () => {
    assert.deepEqual(parseArgs(['node', 'cli.js']), {})
  })

  it('解析 --dry-run 标志为 true', () => {
    assert.deepEqual(parseArgs(['node', 'cli.js', '--dry-run']), { dryRun: true })
  })

  it('解析 --key=value 形式', () => {
    assert.deepEqual(parseArgs(['node', 'cli.js', '--remote=https://example.cc']), {
      remote: 'https://example.cc',
    })
  })

  it('解析 --key 无等号时为 true', () => {
    assert.deepEqual(parseArgs(['node', 'cli.js', '--help']), { help: true })
  })

  it('忽略非 -- 开头的位置参数', () => {
    assert.deepEqual(parseArgs(['node', 'cli.js', 'positional', '--dry-run']), { dryRun: true })
  })

  it('解析多个参数组合', () => {
    const args = parseArgs(['node', 'cli.js', '--remote=https://x', '--site=172', '--dry-run', '--target=5'])
    assert.equal(args.remote, 'https://x')
    assert.equal(args.site, '172')
    assert.equal(args.dryRun, true)
    assert.equal(args.target, '5')
  })
})

// ============================================================
// usage — 帮助输出
// ============================================================
describe('cli usage 帮助输出', () => {
  it('输出包含关键用法信息', () => {
    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.join(' '))
    try {
      usage()
    } finally {
      console.log = origLog
    }
    const output = logs.join('\n')
    assert.ok(output.includes('用法'), '应包含"用法"标题')
    assert.ok(output.includes('--remote'), '应包含 --remote 选项')
    assert.ok(output.includes('--help'), '应包含 --help 选项')
    assert.ok(output.includes('--site'), '应包含 --site 选项')
    assert.ok(output.includes('--dry-run'), '应包含 --dry-run 选项')
    assert.ok(output.includes('--alert-webhook'), '应包含 --alert-webhook 选项')
  })
})

// ============================================================
// createDemoDB — 内存数据库
// ============================================================
describe('cli createDemoDB 内存数据库', () => {
  it('insertSeeds 添加素材并返回 added 计数', async () => {
    const db = createDemoDB()
    const result = await db.insertSeeds(
      [
        { raw: '素材1', category: '优惠', template: 'auto' },
        { raw: '素材2', category: '优惠', template: 'auto' },
      ],
      'test',
    )
    assert.equal(result.added, 2)
  })

  it('fetchPendingSeeds 返回 pending 状态的素材', async () => {
    const db = createDemoDB()
    await db.insertSeeds(
      [
        { raw: '素材1', category: '优惠', template: 'auto' },
        { raw: '素材2', category: '优惠', template: 'auto' },
      ],
      'test',
    )
    const pending = await db.fetchPendingSeeds(10)
    assert.equal(pending.length, 2)
    assert.equal(pending[0].status, 'pending')
    assert.equal(pending[0].source, 'ai')
  })

  it('fetchPendingSeeds 受 size 参数限制', async () => {
    const db = createDemoDB()
    await db.insertSeeds(
      [
        { raw: '素材1', category: '优惠', template: 'auto' },
        { raw: '素材2', category: '优惠', template: 'auto' },
        { raw: '素材3', category: '优惠', template: 'auto' },
      ],
      'test',
    )
    const pending = await db.fetchPendingSeeds(2)
    assert.equal(pending.length, 2)
  })

  it('markSeedDone 标记素材为 done', async () => {
    const db = createDemoDB()
    await db.insertSeeds([{ raw: '素材1', category: '优惠', template: 'auto' }], 'test')
    const pending = await db.fetchPendingSeeds(10)
    await db.markSeedDone(pending[0].id, 'art-1')
    const remaining = await db.fetchPendingSeeds(10)
    assert.equal(remaining.length, 0)
  })

  it('markSeedFailed 标记素材为 failed 并记录错误', async () => {
    const db = createDemoDB()
    await db.insertSeeds([{ raw: '素材1', category: '优惠', template: 'auto' }], 'test')
    const pending = await db.fetchPendingSeeds(10)
    await db.markSeedFailed(pending[0].id, '生成失败')
    const remaining = await db.fetchPendingSeeds(10)
    assert.equal(remaining.length, 0)
  })

  it('insertArticles 返回正确的结果', async () => {
    const db = createDemoDB()
    const result = await db.insertArticles([{ title: '文章1', articleId: 'a1' } as never])
    assert.equal(result.total, 1)
    assert.equal(result.created, 1)
    assert.equal(result.failed, 0)
    assert.equal(result.results[0].ok, true)
    assert.ok(result.results[0].id)
  })

  it('insertRunLog 不抛错', async () => {
    const db = createDemoDB()
    await db.insertRunLog({} as never)
  })

  it('insertSeeds 使用默认 category 和 template', async () => {
    const db = createDemoDB()
    await db.insertSeeds([{ raw: '素材1' }], 'test')
    const pending = await db.fetchPendingSeeds(10)
    assert.equal(pending[0].category, 'auto')
    assert.equal(pending[0].template, 'auto')
  })
})

// ============================================================
// main — 主入口（mock 底层模块导出 + 全局状态）
// ============================================================

// 修改 executor.js / runner.js 的导出，index.js 的 getter（live binding）会返回 mock，
// cli.js 通过属性访问 index_js_1.execute 自动拿到 mock 版本。
const executorPath = require.resolve('../src/executor.js')
const runnerPath = require.resolve('../src/runner.js')

class ExitSignal extends Error {
  code: number
  constructor(code: number) {
    super(`process.exit(${code})`)
    this.code = code
    this.name = 'ExitSignal'
  }
}

interface RunOpts {
  execute?: (db: unknown, config: unknown) => Promise<unknown>
  runScheduledGenerate?: (config: unknown) => Promise<unknown>
  env?: Record<string, string>
  fetchImpl?: (...args: unknown[]) => Promise<unknown>
}

interface RunResult {
  stdout: string[]
  stderr: string[]
  exitCode: number | null
}

async function runMain(argv: string[], opts: RunOpts = {}): Promise<RunResult> {
  const stdout: string[] = []
  const stderr: string[] = []
  let exitCode: number | null = null

  const origArgv = process.argv
  const origExit = process.exit
  const origLog = console.log
  const origError = console.error
  const origFetch = globalThis.fetch
  const origEnv: Record<string, string | undefined> = {}

  process.argv = ['node', 'cli.js', ...argv]
  ;(process as { exit: (code?: number) => never }).exit = (code?: number) => {
    exitCode = code ?? 0
    throw new ExitSignal(exitCode)
  }
  console.log = (...args: unknown[]) => stdout.push(args.map(String).join(' '))
  console.error = (...args: unknown[]) => stderr.push(args.map(String).join(' '))
  if (opts.fetchImpl) {
    ;(globalThis as { fetch: typeof fetch }).fetch = opts.fetchImpl as never
  }
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      origEnv[k] = process.env[k]
      process.env[k] = v
    }
  }

  const executorMod = require(executorPath) as Record<string, unknown>
  const runnerMod = require(runnerPath) as Record<string, unknown>
  const origExec = executorMod.execute
  const origRun = runnerMod.runScheduledGenerate
  if (opts.execute) executorMod.execute = opts.execute
  if (opts.runScheduledGenerate) runnerMod.runScheduledGenerate = opts.runScheduledGenerate

  try {
    await main()
  } catch (e) {
    if (!(e instanceof ExitSignal)) throw e
  }

  process.argv = origArgv
  ;(process as { exit: (code?: number) => never }).exit = origExit
  console.log = origLog
  console.error = origError
  ;(globalThis as { fetch: typeof fetch }).fetch = origFetch
  executorMod.execute = origExec
  runnerMod.runScheduledGenerate = origRun
  for (const [k, v] of Object.entries(origEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }

  return { stdout, stderr, exitCode }
}

function emptyPipeline() {
  return { ok: 0, fail: 0, total: 0, articles: [], errors: [] }
}

/** 捕获 execute 的 config 参数并返回标准成功结果 */
function captureExecute(spy: { config: Record<string, unknown> | null }) {
  return async (_db: unknown, config: unknown): Promise<unknown> => {
    spy.config = config as Record<string, unknown>
    return { mode: 'cloud', pipeline: emptyPipeline() }
  }
}

describe('cli main --help 帮助', () => {
  it('--help 显示用法并退出码 0', async () => {
    const { stdout, exitCode } = await runMain(['--help'])
    assert.equal(exitCode, 0)
    const output = stdout.join('\n')
    assert.ok(output.includes('用法'))
    assert.ok(output.includes('--remote'))
  })
})

describe('cli main 远程模式', () => {
  it('--remote 缺少 --site 时退出码 1 且输出错误', async () => {
    const { stderr, exitCode } = await runMain(['--remote=https://example.cc'])
    assert.equal(exitCode, 1)
    assert.ok(stderr.join('\n').includes('需要 --site'))
  })

  it('--remote --site 成功时输出远程结果', async () => {
    const { stdout, exitCode } = await runMain(['--remote=https://example.cc', '--site=172', '--remote-key=secret'], {
      runScheduledGenerate: async () => ({
        mode: 'remote',
        reason: '测试原因',
        pipeline: { ok: 3, fail: 1 },
      }),
    })
    assert.equal(exitCode, null)
    const output = stdout.join('\n')
    assert.ok(output.includes('远程模式'))
    assert.ok(output.includes('站点: 172'))
    assert.ok(output.includes('https://example.cc'))
    assert.ok(output.includes('成功: 3'))
    assert.ok(output.includes('失败: 1'))
    assert.ok(output.includes('原因: 测试原因'))
  })

  it('--remote --site runScheduledGenerate 抛错时退出码 1', async () => {
    const { stderr, exitCode } = await runMain(['--remote=https://example.cc', '--site=172'], {
      runScheduledGenerate: async () => {
        throw new Error('远程执行失败')
      },
    })
    assert.equal(exitCode, 1)
    assert.ok(stderr.join('\n').includes('执行失败'))
  })

  it('--remote --site 结果无 pipeline 时只输出模式', async () => {
    const { stdout, exitCode } = await runMain(['--remote=https://example.cc', '--site=hm'], {
      runScheduledGenerate: async () => ({ mode: 'skipped', reason: '当天已发布' }),
    })
    assert.equal(exitCode, null)
    const output = stdout.join('\n')
    assert.ok(output.includes('模式: skipped'))
    assert.ok(output.includes('原因: 当天已发布'))
    assert.ok(!output.includes('成功:'))
  })
})

describe('cli main 本地模式', () => {
  it('默认参数 execute 成功时输出 dry-run/normal 模式', async () => {
    const { stdout, exitCode } = await runMain(['--dry-run', '--target=2'], {
      execute: async () => ({ mode: 'cloud', pipeline: { ...emptyPipeline(), ok: 2, total: 2 } }),
    })
    assert.equal(exitCode, null)
    const output = stdout.join('\n')
    assert.ok(output.includes('dry-run'))
    assert.ok(output.includes('目标: 2 篇'))
    assert.ok(output.includes('成功: 2'))
  })

  it('normal 模式输出 normal 标识', async () => {
    const { stdout } = await runMain(['--target=1'], {
      execute: async () => ({ mode: 'cloud', pipeline: emptyPipeline() }),
    })
    assert.ok(stdout.join('\n').includes('normal'))
  })

  it('execute 抛错时退出码 1', async () => {
    const { stderr, exitCode } = await runMain([], {
      execute: async () => {
        throw new Error('本地执行失败')
      },
    })
    assert.equal(exitCode, 1)
    assert.ok(stderr.join('\n').includes('执行失败'))
  })

  it('结果包含文章列表时输出文章标题与 ID', async () => {
    const { stdout } = await runMain([], {
      execute: async () => ({
        mode: 'cloud',
        pipeline: {
          ok: 1,
          fail: 0,
          total: 1,
          articles: [{ title: '测试文章', articleId: 'art-1' }],
          errors: [],
        },
      }),
    })
    const output = stdout.join('\n')
    assert.ok(output.includes('文章:'))
    assert.ok(output.includes('测试文章'))
    assert.ok(output.includes('art-1'))
  })

  it('结果包含错误列表时输出错误', async () => {
    const { stdout } = await runMain([], {
      execute: async () => ({
        mode: 'cloud',
        pipeline: {
          ok: 0,
          fail: 1,
          total: 1,
          articles: [],
          errors: ['素材质量不达标'],
        },
      }),
    })
    const output = stdout.join('\n')
    assert.ok(output.includes('错误:'))
    assert.ok(output.includes('素材质量不达标'))
  })

  it('结果无 pipeline 时只输出模式和原因', async () => {
    const { stdout } = await runMain([], {
      execute: async () => ({ mode: 'skipped', reason: '当天已发布' }),
    })
    const output = stdout.join('\n')
    assert.ok(output.includes('模式: skipped'))
    assert.ok(output.includes('原因: 当天已发布'))
    assert.ok(!output.includes('成功:'))
  })
})

describe('cli main 环境变量与参数映射', () => {
  it('读取 OPENROUTER_API_KEY 环境变量到 openrouter 配置', async () => {
    const spy: { config: Record<string, unknown> | null } = { config: null }
    await runMain([], {
      env: { OPENROUTER_API_KEY: 'env-key' },
      execute: captureExecute(spy),
    })
    const ai = (spy.config as Record<string, unknown>).ai as { openrouter?: { apiKey: string } }
    assert.ok(ai.openrouter)
    assert.equal(ai.openrouter?.apiKey, 'env-key')
  })

  it('--openrouter-key 参数优先于环境变量', async () => {
    const spy: { config: Record<string, unknown> | null } = { config: null }
    await runMain(['--openrouter-key=arg-key'], {
      env: { OPENROUTER_API_KEY: 'env-key' },
      execute: captureExecute(spy),
    })
    const ai = (spy.config as Record<string, unknown>).ai as { openrouter?: { apiKey: string } }
    assert.equal(ai.openrouter?.apiKey, 'arg-key')
  })

  it('无 openrouter key 时 openrouter 为 undefined', async () => {
    const spy: { config: Record<string, unknown> | null } = { config: null }
    await runMain([], { execute: captureExecute(spy) })
    const ai = (spy.config as Record<string, unknown>).ai as { openrouter?: unknown }
    assert.equal(ai.openrouter, undefined)
  })

  it('解析 --local-models 逗号分隔为数组', async () => {
    const spy: { config: Record<string, unknown> | null } = { config: null }
    await runMain(['--local-models=a,b,c'], { execute: captureExecute(spy) })
    assert.deepEqual((spy.config as Record<string, unknown>).localModels, ['a', 'b', 'c'])
  })

  it('解析告警 webhook 与阈值', async () => {
    const spy: { config: Record<string, unknown> | null } = { config: null }
    await runMain(['--alert-webhook=https://hook.example.cc', '--alert-rate=0.8'], {
      execute: captureExecute(spy),
    })
    const alert = (spy.config as Record<string, unknown>).alert as {
      webhookUrl: string
      minSuccessRate: number
    }
    assert.ok(alert)
    assert.equal(alert.webhookUrl, 'https://hook.example.cc')
    assert.equal(alert.minSuccessRate, 0.8)
  })

  it('无告警 webhook 时 alert 为 undefined', async () => {
    const spy: { config: Record<string, unknown> | null } = { config: null }
    await runMain([], { execute: captureExecute(spy) })
    assert.equal((spy.config as Record<string, unknown>).alert, undefined)
  })

  it('解析本地模式各参数到 config', async () => {
    const spy: { config: Record<string, unknown> | null } = { config: null }
    await runMain(
      [
        '--gateway=http://gw:1234/v1',
        '--model=my-model',
        '--target=7',
        '--api-key=ak',
        '--api-base=https://api.test.com/v1',
        '--ai-model=gpt-4',
        '--cloud-model=claude',
        '--local-timeout=5000',
        '--local-lock-file=/tmp/lock',
        '--gateway-start-cmd=echo start',
        '--gateway-chrome-start-cmd=echo chrome',
      ],
      { execute: captureExecute(spy) },
    )
    const cfg = spy.config as Record<string, unknown>
    assert.equal(cfg.localGateway, 'http://gw:1234/v1')
    assert.equal(cfg.localModel, 'my-model')
    assert.equal(cfg.dailyTarget, 7)
    assert.equal(cfg.cloudModel, 'claude')
    assert.equal(cfg.localTimeoutMs, 5000)
    assert.equal(cfg.localLockFile, '/tmp/lock')
    assert.equal(cfg.localGatewayStartCommand, 'echo start')
    assert.equal(cfg.localChromeStartCommand, 'echo chrome')
    const ai = cfg.ai as { apiKey: string; baseUrl: string; model: string }
    assert.equal(ai.apiKey, 'ak')
    assert.equal(ai.baseUrl, 'https://api.test.com/v1')
    assert.equal(ai.model, 'gpt-4')
  })
})

/** 在 execute 内部调用 cloudFallback 并捕获结果（此时 fetch 仍为 mock） */
function captureAndInvokeFallback(spy: { config: Record<string, unknown> | null; result: unknown }, dryRun: boolean) {
  return async (_db: unknown, config: unknown): Promise<unknown> => {
    spy.config = config as Record<string, unknown>
    const cb = (spy.config as Record<string, unknown>).cloudFallback as (ctx: { dryRun: boolean }) => Promise<unknown>
    if (cb) spy.result = await cb({ dryRun })
    return { mode: 'cloud', pipeline: emptyPipeline() }
  }
}

describe('cli main cloud-fallback 兜底', () => {
  it('--cloud-fallback-url 配置 cloudFallback 函数且 HTTP 成功', async () => {
    const spy: { config: Record<string, unknown> | null; result: unknown } = {
      config: null,
      result: null,
    }
    await runMain(['--cloud-fallback-url=https://fallback.example.cc'], {
      fetchImpl: async () =>
        new Response(JSON.stringify({ message: '兜底成功' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      execute: captureAndInvokeFallback(spy, true),
    })
    assert.equal(typeof (spy.config as Record<string, unknown>).cloudFallback, 'function')
    const result = spy.result as { ok: boolean; message: string }
    assert.equal(result.ok, true)
    assert.equal(result.message, '兜底成功')
  })

  it('cloudFallback 在 HTTP 失败时返回 ok=false', async () => {
    const spy: { config: Record<string, unknown> | null; result: unknown } = {
      config: null,
      result: null,
    }
    await runMain(['--cloud-fallback-url=https://fallback.example.cc'], {
      fetchImpl: async () => new Response('error', { status: 500 }),
      execute: captureAndInvokeFallback(spy, false),
    })
    const result = spy.result as { ok: boolean; message: string }
    assert.equal(result.ok, false)
    assert.ok(result.message.includes('500'))
  })

  it('cloudFallback 在响应无 message 时使用默认消息', async () => {
    const spy: { config: Record<string, unknown> | null; result: unknown } = {
      config: null,
      result: null,
    }
    await runMain(['--cloud-fallback-url=https://fallback.example.cc'], {
      fetchImpl: async () => new Response(JSON.stringify({}), { status: 200 }),
      execute: captureAndInvokeFallback(spy, true),
    })
    const result = spy.result as { ok: boolean; message: string }
    assert.equal(result.ok, true)
    assert.equal(result.message, '云端兜底已执行')
  })
})
