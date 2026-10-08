#!/usr/bin/env node
/**
 * 同步 dist/ 到所有消费项目的 vendor/ 目录
 *
 * 用法：cd auto-ai-article && npm run build && node sync-vendor.cjs
 *      node sync-vendor.cjs --exclude=local-gateway.js,local-gateway.d.ts  # 排除指定产物（纯云端站瘦身）
 *
 * 原理：各站点是独立 git 仓库，Cloudflare Pages CI 无法访问 file:../../ 路径。
 * 因此将库 dist 以 vendor 形式提交到各仓库；本脚本保证 vendor 与源码同步。
 */
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, 'dist')
const ROOT = path.resolve(__dirname, '..')
const EXCLUDE_ARG = process.argv.find((a) => a.startsWith('--exclude='))
const EXCLUDE = EXCLUDE_ARG ? EXCLUDE_ARG.split('=')[1].split(',').map((s) => s.trim()) : []

// 消费项目列表：[项目路径, vendor 相对路径]
const TARGETS = [
  // 号卡
  ['号卡/172', 'vendor/ai-article-pipeline'],
  ['号卡/hm', 'vendor/ai-article-pipeline'],
  ['号卡/yk', 'vendor/ai-article-pipeline'],
  ['号卡/kd', 'vendor/ai-article-pipeline'],
  ['号卡/hk', 'vendor/ai-article-pipeline'],
  ['号卡/ksj', 'vendor/ai-article-pipeline'],
  ['号卡/gc', 'vendor/ai-article-pipeline'],
  // 信用卡
  ['信用卡/kahe', 'vendor/ai-article-pipeline'],
  ['信用卡/suishou', 'vendor/ai-article-pipeline'],
  ['信用卡/zhangshang', 'vendor/ai-article-pipeline'],
  // 随身wifi
  ['随身wifi/chaoneng-wifi', 'vendor/ai-article-pipeline'],
  ['随身wifi/feilimao-wifi', 'vendor/ai-article-pipeline'],
  ['随身wifi/gexing-wifi', 'vendor/ai-article-pipeline'],
  ['随身wifi/liantong-wifi', 'vendor/ai-article-pipeline'],
  // article-site
  ['article-site', 'vendor/ai-article-pipeline'],
]

// vendor 内的 package.json（声明 CJS，覆盖根目录的 type:module）
const VENDOR_PKG = {
  name: 'ai-article-pipeline',
  version: '0.2.0',
  type: 'commonjs',
  main: './dist/index.js',
  types: './dist/index.d.ts',
  exports: {
    '.': { types: './dist/index.d.ts', import: './dist/index.js', require: './dist/index.js' },
    './client': { types: './dist/client.d.ts', import: './dist/client.js', require: './dist/client.js' },
  },
}

if (!fs.existsSync(SRC)) {
  console.error('❌ dist/ 不存在，请先运行 npm run build')
  process.exit(1)
}

if (EXCLUDE.length) console.log(`⏭  排除产物: ${EXCLUDE.join(', ')}`)
let ok = 0
let fail = 0

for (const [proj, vendorRel] of TARGETS) {
  const projDir = path.join(ROOT, proj)
  const vendorDir = path.join(projDir, vendorRel)
  const distDir = path.join(vendorDir, 'dist')

  if (!fs.existsSync(projDir)) {
    console.log(`⏭  ${proj}: 项目不存在，跳过`)
    continue
  }

  try {
    // 清空旧 vendor
    fs.rmSync(vendorDir, { recursive: true, force: true })
    fs.mkdirSync(distDir, { recursive: true })

    // 复制 dist/*（跳过 --exclude 指定的文件）
    for (const f of fs.readdirSync(SRC)) {
      if (EXCLUDE.includes(f)) continue
      fs.copyFileSync(path.join(SRC, f), path.join(distDir, f))
    }

    // 写 vendor package.json
    fs.writeFileSync(
      path.join(vendorDir, 'package.json'),
      JSON.stringify(VENDOR_PKG, null, 2) + '\n'
    )

    console.log(`✅ ${proj}: ${vendorRel}/dist 已同步`)
    ok++
  } catch (e) {
    console.error(`❌ ${proj}: ${e.message}`)
    fail++
  }
}

console.log(`\n完成：${ok} 成功，${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
