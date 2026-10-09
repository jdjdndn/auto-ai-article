import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// 1. executor.ts 用 require('./local-gateway.js') 惰性加载（CJS）。
//    vitest ESM 环境下 Node 原生 require 无法解析 .js→.ts，这里在 transform 阶段
//    将 src 下的 require('./xxx.js') 替换为 (await import('./xxx.js'))，由 vite 解析。
// 2. cli.test.ts 顶层 require.resolve('../src/executor.js') 依赖编译产物，vitest 下找不到。
//    替换为占位路径使文件可加载（parseArgs/usage/createDemoDB 测试可运行），
//    main 部分依赖 CJS require+改导出的 mock 方式，与 vitest ESM 不兼容，会失败。
const transformPlugin = {
  name: 'vitest-compat-transform',
  transform(code: string, id: string) {
    const normId = id.replace(/\\/g, '/')
    // cli.test.ts: require.resolve 占位
    if (normId.endsWith('test/cli.test.ts')) {
      const replaced = code
        .replace(/require\.resolve\(['"]\.\.\/src\/executor\.js['"]\)/g, "'__executor_placeholder__'")
        .replace(/require\.resolve\(['"]\.\.\/src\/runner\.js['"]\)/g, "'__runner_placeholder__'")
      return replaced !== code ? replaced : null
    }
    // src 下的 require('./xxx.js') → await import
    if (normId.includes('/src/') && normId.endsWith('.ts') && code.includes('require(')) {
      const replaced = code.replace(
        /require\(['"](\.[^'"]*\.js)['"]\)/g,
        'await import("$1")',
      )
      return replaced !== code ? replaced : null
    }
    return null
  },
}

export default defineConfig({
  plugins: [transformPlugin],
  resolve: {
    alias: {
      'node:test': resolve(__dirname, 'vitest-shims/node-test.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['dist-test/**', 'third_party/**', 'node_modules/**'],
    deps: {
      inline: ['src/**'],
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json'],
      include: ['src/**'],
      exclude: ['src/types.ts', 'src/index.ts'],
      // 有少量测试失败时仍生成覆盖率报告
      reportOnFailure: true,
    },
  },
})
