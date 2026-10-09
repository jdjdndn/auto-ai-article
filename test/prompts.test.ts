import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { aiSuggestPrompt, aiSystemPrompt, dateContext } from '../src/prompts.js'

// 中国时间(UTC+8) y年m月d日 12:00 对应的 Date.now() 时间戳
function cstNoon(y: number, m: number, d: number): number {
  // 12:00 CST == 04:00 UTC
  return Date.UTC(y, m - 1, d, 4, 0, 0)
}

// 临时固定 Date.now，执行回调后恢复
function withFixedNow(timestamp: number, fn: () => string): string {
  const real = Date.now
  Date.now = () => timestamp
  try {
    return fn()
  } finally {
    Date.now = real
  }
}

describe('dateContext', () => {
  it('返回包含日期与节日时令的格式化字符串', () => {
    const ctx = dateContext()
    assert.ok(ctx.startsWith('今天是 '))
    assert.ok(ctx.includes('年'))
    assert.ok(ctx.includes('月'))
    assert.ok(ctx.includes('日'))
    assert.ok(ctx.includes('近 45 天的重要节日/节气'))
    assert.ok(ctx.includes('当前时令话题'))
  })

  it('国庆前能列出近 45 天节日与 9 月时令', () => {
    const ctx = withFixedNow(cstNoon(2026, 9, 20), dateContext)
    assert.ok(ctx.includes('2026 年 9 月 20 日'))
    assert.ok(ctx.includes('国庆'))
    assert.ok(ctx.includes('霜降'))
    assert.ok(ctx.includes('万圣节'))
    assert.ok(ctx.includes('秋季时令'))
    assert.ok(ctx.includes('秋装换季'))
    assert.ok(ctx.includes('国庆出行准备'))
  })

  it('无近 45 天节日时显示"无"', () => {
    // 6 月 15 日：最近节日 8 月 1 日建军节距今约 46 天，超出 45 天窗口
    const ctx = withFixedNow(cstNoon(2026, 6, 15), dateContext)
    assert.ok(ctx.includes('2026 年 6 月 15 日'))
    assert.ok(ctx.includes('近 45 天的重要节日/节气：无'))
    assert.ok(ctx.includes('年中大促'))
    assert.ok(ctx.includes('夏季防晒'))
  })

  it('1 月时令包含年货采买与冬季保暖', () => {
    const ctx = withFixedNow(cstNoon(2026, 1, 15), dateContext)
    assert.ok(ctx.includes('2026 年 1 月 15 日'))
    assert.ok(ctx.includes('年货采买'))
    assert.ok(ctx.includes('冬季保暖'))
    assert.ok(ctx.includes('元旦假期'))
  })

  it('12 月时令包含双十二与圣诞跨年', () => {
    const ctx = withFixedNow(cstNoon(2026, 12, 15), dateContext)
    assert.ok(ctx.includes('2026 年 12 月 15 日'))
    assert.ok(ctx.includes('双十二'))
    assert.ok(ctx.includes('圣诞跨年'))
  })

  it('时令话题含中文标点与斜杠分隔的特殊字符', () => {
    const ctx = withFixedNow(cstNoon(2026, 9, 20), dateContext)
    assert.ok(ctx.includes('、'))
    assert.ok(ctx.includes('（') && ctx.includes('）'))
    assert.ok(ctx.includes('大闸蟹/柚子/板栗/柿子'))
  })

  it('节日列表含距今天数提示', () => {
    const ctx = withFixedNow(cstNoon(2026, 9, 20), dateContext)
    assert.ok(ctx.includes('还有'))
    assert.ok(ctx.includes('天)'))
  })
})

describe('aiSystemPrompt', () => {
  it('返回非空且包含核心指令的字符串', () => {
    const prompt = aiSystemPrompt()
    assert.ok(prompt.length > 0)
    assert.ok(prompt.includes('去 AI 味'))
    assert.ok(prompt.includes('JSON'))
    assert.ok(prompt.includes('category'))
    assert.ok(prompt.includes('template'))
    assert.ok(prompt.includes('content'))
    assert.ok(prompt.includes('links'))
    assert.ok(prompt.includes('合规红线'))
    assert.ok(prompt.includes('干货组织'))
  })

  it('多次调用返回相同结果（纯静态）', () => {
    const a = aiSystemPrompt()
    const b = aiSystemPrompt()
    assert.equal(a, b)
  })

  it('包含块对象类型与链接规则说明', () => {
    const prompt = aiSystemPrompt()
    assert.ok(prompt.includes('text'))
    assert.ok(prompt.includes('h2'))
    assert.ok(prompt.includes('list'))
    assert.ok(prompt.includes('quote'))
    assert.ok(prompt.includes('ad'))
    assert.ok(prompt.includes('price'))
    assert.ok(prompt.includes('编造'))
  })
})

describe('aiSuggestPrompt', () => {
  it('返回非空且包含时间背景与选题指令', () => {
    const prompt = aiSuggestPrompt()
    assert.ok(prompt.length > 0)
    assert.ok(prompt.includes('今天是'))
    assert.ok(prompt.includes('时间背景'))
    assert.ok(prompt.includes('选题'))
    assert.ok(prompt.includes('angle'))
    assert.ok(prompt.includes('category'))
    assert.ok(prompt.includes('省钱'))
  })

  it('内嵌 dateContext 的日期信息（模板变量替换）', () => {
    const ts = cstNoon(2026, 9, 20)
    const prompt = withFixedNow(ts, aiSuggestPrompt)
    const ctx = withFixedNow(ts, dateContext)
    assert.ok(prompt.includes(ctx), '选题提示词应包含完整 dateContext 输出')
  })

  it('包含三个不同 category 的要求', () => {
    const prompt = aiSuggestPrompt()
    assert.ok(prompt.includes('3 个不同 category'))
    assert.ok(prompt.includes('优惠/攻略/好物/副业'))
  })

  it('包含避免强时效词与合规要求', () => {
    const prompt = aiSuggestPrompt()
    assert.ok(prompt.includes('避免'))
    assert.ok(prompt.includes('倒计时'))
    assert.ok(prompt.includes('合法合规'))
    assert.ok(prompt.includes('医疗功效'))
  })
})
