import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  FREE_TEXT_MODELS,
  OPENROUTER_FREE_MODELS,
  FALLBACK_PROVIDERS,
  SITE_DEFAULT_MODELS,
  getSiteDefaultModel,
} from '../src/ai-config.js'
import type { AiModel, FallbackProvider } from '../src/ai-config.js'

// —— 类型守卫工厂：避免裸 any，复用断言 ——
function assertIsAiModel(m: unknown): asserts m is AiModel {
  const o = m as Record<string, unknown>
  assert.ok(typeof o.id === 'string' && o.id.length > 0, 'id 应为非空字符串')
  assert.ok(typeof o.provider === 'string' && o.provider.length > 0, 'provider 应为非空字符串')
  assert.ok(typeof o.priority === 'number' && Number.isFinite(o.priority), 'priority 应为有限数字')
  assert.ok(typeof o.description === 'string' && o.description.length > 0, 'description 应为非空字符串')
  assert.ok(typeof o.chineseOptimized === 'boolean', 'chineseOptimized 应为布尔')
}

function assertIsFallbackProvider(p: unknown): asserts p is FallbackProvider {
  const o = p as Record<string, unknown>
  assert.ok(typeof o.name === 'string' && o.name.length > 0, 'name 应为非空字符串')
  assert.ok(typeof o.envKey === 'string' && o.envKey.length > 0, 'envKey 应为非空字符串')
  assert.ok(typeof o.baseUrl === 'string' && o.baseUrl.length > 0, 'baseUrl 应为非空字符串')
  assert.ok(Array.isArray(o.models) && o.models.length > 0, 'models 应为非空数组')
}

// ============================================================
// FREE_TEXT_MODELS
// ============================================================
describe('FREE_TEXT_MODELS', () => {
  it('是非空数组', () => {
    assert.ok(Array.isArray(FREE_TEXT_MODELS))
    assert.ok(FREE_TEXT_MODELS.length > 0)
  })

  it('每个元素包含必需字段且类型正确', () => {
    for (const m of FREE_TEXT_MODELS) {
      assertIsAiModel(m)
    }
  })

  it('id 唯一（无重复模型）', () => {
    const ids = FREE_TEXT_MODELS.map((m) => m.id)
    const unique = new Set(ids)
    assert.equal(unique.size, ids.length, '模型 id 不应重复')
  })

  it('所有 id 以 @cf/ 开头（Cloudflare Workers AI 命名规范）', () => {
    for (const m of FREE_TEXT_MODELS) {
      assert.ok(m.id.startsWith('@cf/'), `id 应以 @cf/ 开头: ${m.id}`)
    }
  })

  it('同时包含中文优化和非中文优化模型', () => {
    const cn = FREE_TEXT_MODELS.filter((m) => m.chineseOptimized)
    const nonCn = FREE_TEXT_MODELS.filter((m) => !m.chineseOptimized)
    assert.ok(cn.length > 0, '应存在中文优化模型')
    assert.ok(nonCn.length > 0, '应存在非中文优化模型')
  })

  it('priority 均为非负整数', () => {
    for (const m of FREE_TEXT_MODELS) {
      assert.ok(m.priority >= 0, `priority 应 >= 0: ${m.id}`)
      assert.ok(Number.isInteger(m.priority), `priority 应为整数: ${m.id}`)
    }
  })

  it('noThinking 字段未定义或为布尔', () => {
    for (const m of FREE_TEXT_MODELS) {
      if (m.noThinking !== undefined) {
        assert.ok(typeof m.noThinking === 'boolean', `noThinking 应为布尔: ${m.id}`)
      }
    }
  })

  it('存在 noThinking=true 与 noThinking=false 两种模型', () => {
    const trueCnt = FREE_TEXT_MODELS.filter((m) => m.noThinking === true).length
    const falseCnt = FREE_TEXT_MODELS.filter((m) => m.noThinking === false).length
    assert.ok(trueCnt > 0, '应存在 noThinking=true 模型')
    assert.ok(falseCnt > 0, '应存在 noThinking=false 模型')
  })

  it('priority=0 的模型存在（Free 计划最高优先级）', () => {
    const top = FREE_TEXT_MODELS.filter((m) => m.priority === 0)
    assert.ok(top.length >= 1, '应存在 priority=0 模型')
  })
})

// ============================================================
// OPENROUTER_FREE_MODELS
// ============================================================
describe('OPENROUTER_FREE_MODELS', () => {
  it('是非空字符串数组', () => {
    assert.ok(Array.isArray(OPENROUTER_FREE_MODELS))
    assert.ok(OPENROUTER_FREE_MODELS.length > 0)
    for (const id of OPENROUTER_FREE_MODELS) {
      assert.ok(typeof id === 'string' && id.length > 0, '模型 id 应为非空字符串')
    }
  })

  it('包含 :free 后缀的免费模型', () => {
    const free = OPENROUTER_FREE_MODELS.filter((id) => id.endsWith(':free'))
    assert.ok(free.length > 0, '应存在 :free 后缀模型')
  })

  it('模型名唯一', () => {
    const unique = new Set(OPENROUTER_FREE_MODELS)
    assert.equal(unique.size, OPENROUTER_FREE_MODELS.length, '模型名不应重复')
  })

  it('每个模型名包含供应商前缀（含 / 分隔符）', () => {
    for (const id of OPENROUTER_FREE_MODELS) {
      assert.ok(id.includes('/'), `模型名应含 / 分隔符: ${id}`)
    }
  })
})

// ============================================================
// FALLBACK_PROVIDERS
// ============================================================
describe('FALLBACK_PROVIDERS', () => {
  it('是非空数组且每个元素包含必需字段', () => {
    assert.ok(Array.isArray(FALLBACK_PROVIDERS))
    assert.ok(FALLBACK_PROVIDERS.length >= 2, '应至少有 2 个降级 provider')
    for (const p of FALLBACK_PROVIDERS) {
      assertIsFallbackProvider(p)
    }
  })

  it('envKey 唯一（API key 读取键不冲突）', () => {
    const keys = FALLBACK_PROVIDERS.map((p) => p.envKey)
    const unique = new Set(keys)
    assert.equal(unique.size, keys.length, 'envKey 不应重复')
  })

  it('name 唯一', () => {
    const names = FALLBACK_PROVIDERS.map((p) => p.name)
    const unique = new Set(names)
    assert.equal(unique.size, names.length, 'name 不应重复')
  })

  it('第一个是 OpenRouter（最高优先级）', () => {
    assert.equal(FALLBACK_PROVIDERS[0].name, 'OpenRouter')
    assert.equal(FALLBACK_PROVIDERS[0].envKey, 'OPENROUTER_API_KEY')
  })

  it('provider 顺序符合预期降级链', () => {
    const names = FALLBACK_PROVIDERS.map((p) => p.name)
    assert.deepEqual(names, ['OpenRouter', '阿里百炼', 'Google Gemini', 'Mistral', 'Cerebras', '自定义 OpenAI 兼容'])
  })

  it('每个 provider 的 envKey 符合预期（API key 读取映射）', () => {
    const expected: Record<string, string> = {
      OpenRouter: 'OPENROUTER_API_KEY',
      阿里百炼: 'DASHSCOPE_API_KEY',
      'Google Gemini': 'GEMINI_API_KEY',
      Mistral: 'MISTRAL_API_KEY',
      Cerebras: 'CEREBRAS_API_KEY',
      '自定义 OpenAI 兼容': 'LLM_API_KEY',
    }
    for (const p of FALLBACK_PROVIDERS) {
      assert.equal(p.envKey, expected[p.name], `${p.name} envKey 不符`)
    }
  })

  it('多 provider 降级配置：每个 provider 有可用 models', () => {
    for (const p of FALLBACK_PROVIDERS) {
      assert.ok(p.models.length > 0, `${p.name} 应有降级模型`)
      for (const m of p.models) {
        assert.ok(typeof m === 'string' && m.length > 0, `${p.name} 模型应为非空字符串`)
      }
    }
  })

  it('OpenRouter 的 models 引用 OPENROUTER_FREE_MODELS', () => {
    const openRouter = FALLBACK_PROVIDERS[0]
    assert.deepEqual(openRouter.models, OPENROUTER_FREE_MODELS)
  })

  it('非自定义 provider 的 baseUrl 是有效 https URL', () => {
    for (const p of FALLBACK_PROVIDERS) {
      if (p.name === '自定义 OpenAI 兼容') continue
      assert.ok(p.baseUrl.startsWith('https://'), `${p.name} baseUrl 应为 https URL`)
    }
  })

  it('自定义 provider 的 baseUrl 为环境变量占位符 LLM_BASE_URL', () => {
    const custom = FALLBACK_PROVIDERS.find((p) => p.name === '自定义 OpenAI 兼容')
    assert.ok(custom)
    assert.equal(custom!.baseUrl, 'LLM_BASE_URL')
    assert.equal(custom!.models[0], 'LLM_MODEL')
  })

  it('环境变量优先级：所有 key 设置时，数组顺序即优先级（首个命中=最高优先级）', () => {
    const envKeys = FALLBACK_PROVIDERS.map((p) => p.envKey)
    const saved: Record<string, string | undefined> = {}
    for (const key of envKeys) {
      saved[key] = process.env[key]
      process.env[key] = 'test-key'
    }
    try {
      const firstWithKey = FALLBACK_PROVIDERS.find((p) => process.env[p.envKey])
      assert.ok(firstWithKey, '应找到配置了 key 的 provider')
      assert.equal(firstWithKey!.name, FALLBACK_PROVIDERS[0].name, '首个命中应为最高优先级')
    } finally {
      for (const key of envKeys) {
        if (saved[key] === undefined) delete process.env[key]
        else process.env[key] = saved[key]
      }
    }
  })

  it('环境变量优先级：仅设置低优先级 key 时返回低优先级 provider', () => {
    const last = FALLBACK_PROVIDERS[FALLBACK_PROVIDERS.length - 1]
    const saved: Record<string, string | undefined> = {}
    for (const p of FALLBACK_PROVIDERS) {
      saved[p.envKey] = process.env[p.envKey]
      delete process.env[p.envKey]
    }
    try {
      process.env[last.envKey] = 'low-priority-key'
      const found = FALLBACK_PROVIDERS.find((p) => process.env[p.envKey])
      assert.ok(found, '应找到低优先级 provider')
      assert.equal(found!.name, last.name, '应命中最低优先级 provider')
    } finally {
      for (const p of FALLBACK_PROVIDERS) {
        if (saved[p.envKey] === undefined) delete process.env[p.envKey]
        else process.env[p.envKey] = saved[p.envKey]
      }
    }
  })

  it('环境变量优先级：无任何 key 设置时无 provider 可用', () => {
    const saved: Record<string, string | undefined> = {}
    for (const p of FALLBACK_PROVIDERS) {
      saved[p.envKey] = process.env[p.envKey]
      delete process.env[p.envKey]
    }
    try {
      const found = FALLBACK_PROVIDERS.find((p) => process.env[p.envKey])
      assert.equal(found, undefined, '无 key 时应无可用 provider')
    } finally {
      for (const p of FALLBACK_PROVIDERS) {
        if (saved[p.envKey] === undefined) delete process.env[p.envKey]
        else process.env[p.envKey] = saved[p.envKey]
      }
    }
  })

  it('无效配置检测：所有非自定义 provider 的 baseUrl 可被 new URL 解析', () => {
    for (const p of FALLBACK_PROVIDERS) {
      if (p.name === '自定义 OpenAI 兼容') continue
      // 不抛错即通过
      const u = new URL(p.baseUrl)
      assert.ok(u.protocol === 'https:', `${p.name} 协议应为 https`)
    }
  })
})

// ============================================================
// SITE_DEFAULT_MODELS
// ============================================================
describe('SITE_DEFAULT_MODELS', () => {
  it('包含 default 键且值为非空字符串', () => {
    assert.ok('default' in SITE_DEFAULT_MODELS)
    assert.ok(typeof SITE_DEFAULT_MODELS.default === 'string')
    assert.ok(SITE_DEFAULT_MODELS.default.length > 0)
  })

  it('default 值是有效的 Cloudflare 模型 ID（@cf/ 前缀）', () => {
    assert.ok(SITE_DEFAULT_MODELS.default.startsWith('@cf/'))
  })

  it('default 值存在于 FREE_TEXT_MODELS 中', () => {
    const ids = FREE_TEXT_MODELS.map((m) => m.id)
    assert.ok(ids.includes(SITE_DEFAULT_MODELS.default), 'default 模型应在免费模型清单内')
  })
})

// ============================================================
// getSiteDefaultModel
// ============================================================
describe('getSiteDefaultModel', () => {
  it('无参数返回 default（配置缺失走默认值）', () => {
    assert.equal(getSiteDefaultModel(), SITE_DEFAULT_MODELS.default)
  })

  it('undefined 返回 default', () => {
    assert.equal(getSiteDefaultModel(undefined), SITE_DEFAULT_MODELS.default)
  })

  it('未知 key 返回 default（配置缺失降级）', () => {
    assert.equal(getSiteDefaultModel('不存在的站点'), SITE_DEFAULT_MODELS.default)
  })

  it('空字符串返回 default', () => {
    assert.equal(getSiteDefaultModel(''), SITE_DEFAULT_MODELS.default)
  })

  it('default key 命中显式分支返回对应值', () => {
    assert.equal(getSiteDefaultModel('default'), SITE_DEFAULT_MODELS.default)
  })

  it('返回值始终是有效的 @cf/ 模型 ID', () => {
    assert.ok(getSiteDefaultModel().startsWith('@cf/'))
    assert.ok(getSiteDefaultModel('任意').startsWith('@cf/'))
    assert.ok(getSiteDefaultModel('default').startsWith('@cf/'))
  })

  it('相同输入多次调用结果一致（纯函数）', () => {
    const a = getSiteDefaultModel('default')
    const b = getSiteDefaultModel('default')
    assert.equal(a, b)
  })
})
