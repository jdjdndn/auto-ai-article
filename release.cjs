#!/usr/bin/env node
/**
 * release.cjs — 一键发布：build库 → sync → 批量build各站验证 → push
 *
 * 站点列表自动从 sync-vendor.cjs 的 TARGETS 读取，加站只改 sync-vendor.cjs。
 *
 * 用法：
 *   node release.cjs           # 全流程
 *   node release.cjs --no-push # 只build+验证，不push
 *   node release.cjs --only=172,yk  # 只验证指定站
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const LIB_DIR = __dirname;
const CODE_ROOT = path.resolve(LIB_DIR, '..'); // E:\code
const NO_PUSH = process.argv.includes('--no-push');
const ONLY_ARG = process.argv.find((a) => a.startsWith('--only='));
const ONLY = ONLY_ARG ? ONLY_ARG.split('=')[1].split(',') : null;

// 从 sync-vendor.cjs 读取 TARGETS，自动生成站点路径列表
function loadStations() {
  const syncFile = path.join(LIB_DIR, 'sync-vendor.cjs');
  const src = fs.readFileSync(syncFile, 'utf8');
  // 匹配 ['相对路径', 'vendor/...'] 格式
  const re = /\['([^']+)',\s*'vendor\/[^']+'\]/g;
  const stations = [];
  let match;
  while ((match = re.exec(src)) !== null) {
    stations.push(path.join(CODE_ROOT, match[1]));
  }
  return stations;
}

const STATIONS = loadStations();
console.log(`自动加载 ${STATIONS.length} 个站点（来自 sync-vendor.cjs TARGETS）`);

function run(cmd, cwd, label) {
  process.stdout.write(`\n=== ${label} ===\n`);
  try {
    execSync(cmd, { cwd, stdio: 'inherit', timeout: 180000 });
    return { ok: true, label };
  } catch (e) {
    return { ok: false, label, error: (e.stderr || e.message || '').toString().split('\n').slice(-5).join('\n') };
  }
}

// Step 1: build 库
console.log('\n[1/5] Build auto-ai-article...');
const buildLib = run('npm run build', LIB_DIR, 'build lib');
if (!buildLib.ok) {
  console.error('\n❌ 库 build 失败，终止');
  process.exit(1);
}

// Step 2: sync vendor
console.log('\n[2/5] Sync vendor...');
const sync = run('node sync-vendor.cjs', LIB_DIR, 'sync vendor');
if (!sync.ok) {
  console.error('\n❌ sync 失败，终止');
  process.exit(1);
}

// Step 2.5: 同步 rebuild-all.cjs 母本到各站
console.log('\n[2.5/5] Sync rebuild-all.cjs to stations...');
const rootRebuild = path.join(LIB_DIR, 'rebuild-all.cjs');
if (fs.existsSync(rootRebuild)) {
  for (const s of STATIONS) {
    const dest = path.join(s, 'rebuild-all.cjs');
    try {
      fs.copyFileSync(rootRebuild, dest);
      const name = s.split(path.sep).pop();
      console.log(`  ✅ ${name}`);
    } catch (e) { /* 忽略不存在的站 */ }
  }
}

// Step 3: 批量 build 各站
console.log('\n[3/5] Build all stations (验证)...');
const results = [];
for (const s of STATIONS) {
  const name = s.split(path.sep).pop();
  if (ONLY && !ONLY.includes(name)) continue;
  if (!fs.existsSync(path.join(s, 'package.json'))) continue;
  const r = run('npm run build', s, `build ${name}`);
  results.push(r);
  if (!r.ok) {
    console.error(`\n❌ ${name} build 失败:\n${r.error}`);
  }
}

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.error(`\n\n❌ ${failed.length} 个站 build 失败，未 push：`);
  for (const f of failed) console.error(`  - ${f.label}`);
  process.exit(1);
}

console.log(`\n✅ 全部 ${results.length} 站 build 通过`);

// Step 4: commit + push
if (NO_PUSH) {
  console.log('\n[5/5] --no-push 模式，跳过 push');
  process.exit(0);
}

console.log('\n[5/5] Commit + push...');
run('git add -A && git commit -m "release: vendor update" && git push', LIB_DIR, 'push lib');
for (const s of STATIONS) {
  const name = s.split(path.sep).pop();
  if (ONLY && !ONLY.includes(name)) continue;
  run('git add -A && git commit -m "vendor update" && git push', s, `push ${name}`);
}

console.log('\n🎉 全部完成');
