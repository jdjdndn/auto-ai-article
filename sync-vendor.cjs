#!/usr/bin/env node
/**
 * 同步 dist/ 到所有消费项目的 vendor/ 目录
 *
 * 用法：cd auto-ai-article && npm run build && node sync-vendor.cjs
 *      node sync-vendor.cjs --exclude=local-gateway.js,local-gateway.d.ts
 */
const fs = require('fs')
const path = require('path')
const PKG = require('./package.json')
const EXCLUDE = (() => {
  const arg = process.argv.find((a) => a.startsWith('--exclude='))
  return arg ? arg.slice(9).split(',').map((s) => s.trim()).filter(Boolean) : []
})()

const SRC = path.join(__dirname, 'dist')
const ROOT = path.resolve(__dirname, '../..')
const TARGETS = [
  ['172', 'vendor/ai-article-pipeline'],
  ['hm', 'vendor/ai-article-pipeline'],
  ['yk', 'vendor/ai-article-pipeline'],
  ['kd', 'vendor/ai-article-pipeline'],
  ['hk', 'vendor/ai-article-pipeline'],
  ['ksj', 'vendor/ai-article-pipeline'],
  ['gc', 'vendor/ai-article-pipeline'],
  ['kahe', 'vendor/ai-article-pipeline'],
  ['suishou', 'vendor/ai-article-pipeline'],
  ['zhangshang', 'vendor/ai-article-pipeline'],
  ['chaoneng-wifi', 'vendor/ai-article-pipeline'],
  ['feilimao-wifi', 'vendor/ai-article-pipeline'],
  ['gexing-wifi', 'vendor/ai-article-pipeline'],
  ['liantong-wifi', 'vendor/ai-article-pipeline'],
  ['article-site', 'vendor/ai-article-pipeline'],
  ['github-auto-article/template', 'vendor/ai-article-pipeline'],
  ['_share/seo-optimizer', 'vendor/ai-article-pipeline'],
]

const VENDOR_PKG = {
  name: 'ai-article-pipeline',
  version: PKG.version,
  type: 'commonjs',
  main: './dist/index.js',
  types: './dist/index.d.ts',
  exports: {
    '.': { types: './dist/index.d.ts', import: './dist/index.js', require: './dist/index.js' },
    './client': { types: './dist/client.d.ts', import: './dist/client.js', require: './dist/client.js' },
    './ai-config': { types: './dist/ai-config.d.ts', require: './dist/ai-config.js' },
    './ai-fallback': { types: './dist/ai-fallback.d.ts', require: './dist/ai-fallback.js' },
  },
}

if (!fs.existsSync(SRC)) {
  console.error('❌ dist/ 不存在，请先运行 npm run build')
  process.exit(1)
}

if (EXCLUDE.length) console.log(`⏭  排除产物: ${EXCLUDE.join(', ')}`)
let ok = 0
let fail = 0

// retry：处理 Windows 文件锁定（EPERM）
function withRetry(fn, retries = 5, delay = 500) {
  for (let i = 0; i < retries; i++) {
    try { return fn() } catch (e) {
      if (e.code !== 'EPERM' && e.code !== 'EBUSY') throw e
      if (i === retries - 1) throw e
      const start = Date.now(); while (Date.now() - start < delay);
    }
  }
}

for (const [proj, vendorRel] of TARGETS) {
  const projDir = path.join(ROOT, proj)
  const vendorDir = path.join(projDir, vendorRel)
  const distDir = path.join(vendorDir, 'dist')

  if (!fs.existsSync(projDir)) {
    console.log(`⏭  ${proj}: 项目不存在，跳过`)
    continue
  }

  try {
    if (!fs.existsSync(distDir)) {
      withRetry(() => fs.mkdirSync(distDir, { recursive: true }))
    }

    for (const f of fs.readdirSync(SRC)) {
      if (EXCLUDE.includes(f)) continue
      const buf = fs.readFileSync(path.join(SRC, f))
      withRetry(() => fs.writeFileSync(path.join(distDir, f), buf))
    }

    withRetry(() => fs.writeFileSync(
      path.join(vendorDir, 'package.json'),
      JSON.stringify(VENDOR_PKG, null, 2) + '\n'
    ))

    console.log(`✅ ${proj}: ${vendorRel}/dist 已同步`)
    ok++
  } catch (e) {
    console.error(`❌ ${proj}: ${e.code || ''} ${e.message}`)
    fail++
  }
}

console.log(`\n完成：${ok} 成功，${fail} 失败`)
if (fail > 0) console.log('\n⚠️  如果全部失败，请关闭 VS Code 后重试（中文路径可能被文件监视器锁定）')
process.exit(fail > 0 ? 1 : 0)
