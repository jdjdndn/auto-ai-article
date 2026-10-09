import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateConfig } from '../src/config-check.js'

describe('config-check 必需项', () => {
  it('全空配置 → valid=false 且 errors 含"未配置任何 AI 提供方"', () => {
    const r = validateConfig({})
    assert.equal(r.valid, false)
    assert.ok(r.errors.some((e) => e.includes('未配置任何 AI 提供方')))
  })

  it('仅 OPENROUTER_API_KEY 非空 → valid=true 且 errors 为空', () => {
    const r = validateConfig({ OPENROUTER_API_KEY: 'sk-xxx' })
    assert.equal(r.valid, true)
    assert.equal(r.errors.length, 0)
  })

  it('AI_API_KEY 非空（无 fallback key）→ valid=true', () => {
    const r = validateConfig({ AI_API_KEY: 'sk-ai' })
    assert.equal(r.valid, true)
  })

  it('DASHSCOPE_API_KEY 非空 → valid=true', () => {
    const r = validateConfig({ DASHSCOPE_API_KEY: 'sk-ds' })
    assert.equal(r.valid, true)
  })

  it('LOCAL_GATEWAY_URL 合法 http:// → valid=true', () => {
    const r = validateConfig({ LOCAL_GATEWAY_URL: 'http://localhost:3456/v1' })
    assert.equal(r.valid, true)
  })
})

describe('config-check 警告项', () => {
  it('仅 OPENROUTER_API_KEY 非空时 warnings 含告警 webhook 警告但不含 OpenRouter 警告', () => {
    const r = validateConfig({ OPENROUTER_API_KEY: 'sk-xxx' })
    assert.ok(r.warnings.some((w) => w.includes('告警 webhook')))
    assert.ok(!r.warnings.some((w) => w.includes('OpenRouter')))
  })

  it('全配齐 → valid=true 且 warnings 为空', () => {
    const r = validateConfig({
      OPENROUTER_API_KEY: 'sk',
      ALERT_WEBHOOK_URL: 'https://hook.example.cc',
      ALERT_MIN_SUCCESS_RATE: '0.6',
      LOCAL_GATEWAY_URL: 'http://localhost:3456/v1',
    })
    assert.equal(r.valid, true)
    assert.equal(r.warnings.length, 0)
  })

  it('嵌套 alert.webhookUrl 配置时不产生告警 webhook 警告', () => {
    const r = validateConfig({ OPENROUTER_API_KEY: 'sk', alert: { webhookUrl: 'https://hook' } })
    assert.ok(!r.warnings.some((w) => w.includes('告警 webhook')))
  })
})

describe('config-check 非法项', () => {
  it('ALERT_MIN_SUCCESS_RATE=1.5 → valid=false 且 errors 含范围错误', () => {
    const r = validateConfig({ OPENROUTER_API_KEY: 'sk', ALERT_MIN_SUCCESS_RATE: '1.5' })
    assert.equal(r.valid, false)
    assert.ok(r.errors.some((e) => e.includes('ALERT_MIN_SUCCESS_RATE')))
  })

  it('ALERT_MIN_SUCCESS_RATE=0.6 → valid=true', () => {
    const r = validateConfig({ OPENROUTER_API_KEY: 'sk', ALERT_MIN_SUCCESS_RATE: '0.6' })
    assert.equal(r.valid, true)
  })

  it('ALERT_MIN_SUCCESS_RATE=0 → valid=false（不在 (0,1]）', () => {
    const r = validateConfig({ OPENROUTER_API_KEY: 'sk', ALERT_MIN_SUCCESS_RATE: '0' })
    assert.equal(r.valid, false)
    assert.ok(r.errors.some((e) => e.includes('ALERT_MIN_SUCCESS_RATE')))
  })

  it('LOCAL_GATEWAY_URL=ftp://x → valid=false', () => {
    const r = validateConfig({ LOCAL_GATEWAY_URL: 'ftp://x' })
    assert.equal(r.valid, false)
    assert.ok(r.errors.some((e) => e.includes('http://')))
  })
})
