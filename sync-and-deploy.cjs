#!/usr/bin/env node
/**
 * 一键同步部署：build → sync-vendor → 逐项目 commit + push
 *
 * 用法：node sync-and-deploy.cjs
 *   --skip-build    跳过 build
 *   --dry-run       只显示会做什么，不实际 push
 *   --only=号卡/172 只处理指定项目（逗号分隔）
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = __dirname
const PARENT = path.resolve(ROOT, '..')

const args = process.argv.slice(2)
const skipBuild = args.includes('--skip-build')
const dryRun = args.includes('--dry-run')
const onlyArg = args.find((a) => a.startsWith('--only='))
const only = onlyArg ? onlyArg.split('=')[1].split(',').map((s) => s.trim()) : null

const PROJECTS = [
  '号卡/172', '号卡/hm', '号卡/yk', '号卡/kd', '号卡/hk', '号卡/ksj', '号卡/gc',
  '信用卡/kahe', '信用卡/suishou', '信用卡/zhangshang',
  '随身wifi/chaoneng-wifi', '随身wifi/feilimao-wifi', '随身wifi/gexing-wifi', '随身wifi/liantong-wifi',
  'article-site',
]

function run(cmd, cwd) {
  try {
    return { ok: true, out: execSync(cmd, { cwd, encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') }
  }
}

function log(icon, msg) { console.log(`${icon} ${msg}`) }

if (!skipBuild) {
  log('🔨', 'Building auto-ai-article...')
  const b = run('npm run build', ROOT)
  if (!b.ok) { log('❌', 'Build 失败'); console.error(b.out); process.exit(1) }
  log('✅', 'Build 完成')
} else {
  log('⏭', '跳过 build')
}

log('📦', 'Syncing vendor...')
const s = run('node sync-vendor.cjs', ROOT)
console.log(s.out)
if (!s.ok) {
  log('❌', 'sync-vendor 失败 — 请关闭 VS Code 后重试')
  process.exit(1)
}
log('✅', 'Vendor 同步完成')

log('🚀', dryRun ? 'Dry run — 不会实际 push' : '开始逐项目 commit + push')
console.log('')

let pushed = 0, skipped = 0, failed = 0
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const commitMsg = `chore: sync vendor (v${pkg.version})`

for (const proj of PROJECTS) {
  if (only && !only.includes(proj)) continue

  const dir = path.join(PARENT, proj)
  if (!fs.existsSync(dir)) { log('⏭', `${proj}: 不存在`); continue }

  const rem = run('git remote get-url origin', dir)
  if (!rem.ok) { log('⚠️', `${proj}: 无 remote，跳过`); skipped++; continue }

  run('git add -A', dir)

  const diff = run('git diff --cached --quiet', dir)
  if (diff.ok) {
    log('⏭', `${proj}: 无改动`)
    skipped++
    continue
  }

  if (dryRun) {
    const status = run('git status --short', dir)
    log('👁', `${proj}: 有改动（dry-run）`)
    console.log(status.out.split('\n').map((l) => '   ' + l).join('\n'))
    skipped++
    continue
  }

  const c = run(`git commit -m "${commitMsg}"`, dir)
  if (!c.ok) { log('❌', `${proj}: commit 失败`); console.error(c.out); failed++; continue }

  const p = run('git push origin HEAD', dir)
  if (!p.ok) { log('❌', `${proj}: push 失败`); console.error(p.out); failed++; continue }

  log('✅', `${proj}: 已 push`)
  pushed++
}

console.log('')
log('📊', `完成：${pushed} 已推送，${skipped} 跳过，${failed} 失败`)
if (failed > 0) process.exit(1)
