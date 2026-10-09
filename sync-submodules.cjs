#!/usr/bin/env node
/**
 * postbuild 钩子：build 后自动同步到所有消费站（submodule update 模式）
 * 1. commit dist 变更到 auto-ai-article
 * 2. 各消费站 git submodule update 拉取最新
 *
 * 用法：npm run build（自动触发 postbuild）
 *       或手动 node sync-submodules.cjs
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const SUBMODULE_PATH = 'vendor/ai-article-pipeline'
const TARGETS = [
  '172', 'gc', 'hk', 'hm', 'kd', 'ksj', 'yk',
  'chaoneng-wifi', 'feilimao-wifi', 'gexing-wifi', 'liantong-wifi',
  'kahe', 'suishou', 'zhangshang',
  'article-site',
]

function run(cmd, opts) {
  return execSync(cmd, { stdio: 'pipe', ...opts }).toString().trim()
}

// 1. commit dist 变更
try {
  run('git add dist/', { cwd: __dirname })
  const staged = run('git diff --cached --name-only', { cwd: __dirname })
  if (staged) {
    run('git commit -m "build: update dist"', { cwd: __dirname })
    console.log('✅ auto-ai-article: dist 已 commit')
  } else {
    console.log('⏭  dist 无变更，跳过 commit')
  }
} catch (e) {
  console.error('⚠️ commit dist 失败:', e.stderr?.toString().trim() || e.message)
  process.exit(1)
}

// 2. 各站 submodule update
let ok = 0, fail = 0, skip = 0
for (const proj of TARGETS) {
  const dir = path.join(ROOT, proj)
  if (!fs.existsSync(dir)) { console.log(`⏭  ${proj}: 不存在`); skip++; continue }
  try {
    run(`git -c protocol.file.allow=always submodule update ${SUBMODULE_PATH}`, { cwd: dir })
    console.log(`✅ ${proj}: submodule updated`)
    ok++
  } catch (e) {
    console.error(`✗ ${proj}: ${e.stderr?.toString().trim() || e.message}`)
    fail++
  }
}
console.log(`\n同步完成：${ok} 成功，${fail} 失败，${skip} 跳过`)
