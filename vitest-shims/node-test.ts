// node:test → vitest 兼容层
// 现有测试文件使用 `import { describe, it, mock } from 'node:test'`，
// vitest 2.1.9 不自动拦截 node:test，导致测试不被收集、覆盖率无法生成。
// 本 shim 将 node:test 的 API 映射到 vitest 等价实现，配合 resolve.alias 使用。
import { describe, it, beforeEach, afterEach, vi } from 'vitest'

type AnyFn = (...args: any[]) => any

// node:test 的 mock API 与 vitest 的 vi API 不同，这里做适配：
// - mock.method(obj, prop, impl)  → vi.spyOn(obj, prop).mockImplementation(impl)
// - mock.fn(impl)                 → vi.fn(impl)
// - mock.restoreAll()             → vi.restoreAllMocks()
// 返回的 mock 对象均含 .mock.calls，与 node:test 结构一致。
const mock = {
  fn(impl?: AnyFn) {
    return vi.fn(impl ?? (() => undefined))
  },
  method(obj: any, methodName: string, impl?: AnyFn) {
    const spy = vi.spyOn(obj, methodName)
    if (impl) spy.mockImplementation(impl)
    else spy.mockImplementation(() => undefined)
    return spy
  },
  restoreAll() {
    vi.restoreAllMocks()
  },
  reset() {
    vi.resetAllMocks()
  },
}

export { describe, it, beforeEach, afterEach, mock }
