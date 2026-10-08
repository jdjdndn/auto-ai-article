#!/usr/bin/env node
/**
 * release.cjs — 一键发布：build库 → sync → 批量验证各站 → push
 *
 * 站点列表自动从 sync-vendor.cjs 的 TARGETS 读取，加站只改 sync-vendor.cjs。
 *
 * 耗时优化（v2）：
 *   1. 增量跳过：build 库后、sync 前比对「新 dist」vs「各站当前 vendor」指纹（SHA256），
 *      再叠加「站源码指纹」（release-state.json 记录上次成功 build 时的指纹）——
 *      vendor 与源码均未变的站跳过 build（产物=上次已验证）；sync 在判定之后执行
 *   2. 并行 build：并发 build（默认 3，--concurrency 可调；Nuxt build 单站峰值 1-2GB 内存，并发 5 曾致内存耗尽全部挂起）
 *   3. 并行 push：多站 git push 并发（默认 5）
 *   4. 进程清理：超时 kill 进程树；Ctrl+C/异常时自动清理全部 build 子进程，防残留
 *   5. 首次执行（无 release-state.json）→ 全量 build，保守不跳过；build 失败站不记录，下次重试
 *   6. 失败重试：push 默认重试 2 次（指数退避 2s/4s）；build 不重试（失败多因代码问题）
 *   7. 断点续跑：build 失败站记入 release-state.json 的 failed 字段；--resume 仅重试上次失败站
 *   8. 日志落盘：每次运行输出到 release-log/<时间戳>.log（tee console 全部输出）
 *   9. dry-run：--dry-run 只做增量判定 + 打印计划，不执行 build/sync/push
 *  10. 自适应并发：未显式指定 --concurrency 时，按可用内存动态调整 build 并发（单站峰值 ~1.5GB，留 2GB 余量）
 *
 * 用法：
 *   node release.cjs                    # 增量 + 并行全流程
 *   node release.cjs --no-push          # 只 build+验证，不 push
 *   node release.cjs --only=172,yk      # 只验证指定站
 *   node release.cjs --force            # 忽略增量，全量 build 所有站
 *   node release.cjs --concurrency=3    # build 并发数（默认 3；不传则按内存自适应）
 *   node release.cjs --dry-run          # 只打印计划，不执行
 *   node release.cjs --resume           # 仅重试上次 build 失败的站
 */
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

const LIB_DIR = __dirname;
const CODE_ROOT = path.resolve(LIB_DIR, '..'); // E:\code
const NO_PUSH = process.argv.includes('--no-push');
const FORCE = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');
const RESUME = process.argv.includes('--resume');
const ONLY_ARG = process.argv.find((a) => a.startsWith('--only='));
const ONLY = ONLY_ARG ? ONLY_ARG.split('=')[1].split(',') : null;
const CONC_ARG = process.argv.find((a) => a.startsWith('--concurrency='));
const CONC_EXPLICIT = !!CONC_ARG; // 用户显式指定则不自适应
// 默认并发 3：Nuxt build 单站峰值 1-2GB 内存，并发 5 曾致内存耗尽、全部进程挂起
const BUILD_CONC = CONC_ARG ? parseInt(CONC_ARG.split('=')[1], 10) || 3 : 3;
const PUSH_CONC = 5;

// ---------- 进程树清理（Windows） ----------
function killTree(pid) {
  try { execSync('taskkill /PID ' + pid + ' /T /F', { stdio: 'ignore' }); }
  catch (e) { /* 进程可能已退出 */ }
}
// 中断/异常时清理自身进程树（连带所有 build 子进程），避免残留
function cleanupSelf() { killTree(process.pid); }
process.on('SIGINT', () => { console.error('\n中断，清理 build 进程树'); cleanupSelf(); process.exit(130); });
process.on('SIGTERM', () => { cleanupSelf(); process.exit(143); });
process.on('uncaughtException', (e) => { console.error('未捕获异常:', e); cleanupSelf(); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('未处理的 Promise 拒绝:', e); cleanupSelf(); process.exit(1); });

async function main() {
const t0all = Date.now();

// ---------- 日志落盘（tee console 输出到 release-log/<时间戳>.log） ----------
const LOG_DIR = path.join(LIB_DIR, 'release-log');
fs.mkdirSync(LOG_DIR, { recursive: true });
const _now = new Date();
const _p = (n) => String(n).padStart(2, '0');
const LOG_FILE = path.join(LOG_DIR, `${_now.getFullYear()}-${_p(_now.getMonth() + 1)}-${_p(_now.getDate())}_${_p(_now.getHours())}-${_p(_now.getMinutes())}-${_p(_now.getSeconds())}.log`);
const _origLog = console.log, _origErr = console.error;
console.log = (...a) => { _origLog(...a); try { fs.appendFileSync(LOG_FILE, a.join(' ') + '\n'); } catch (e) {} };
console.error = (...a) => { _origErr(...a); try { fs.appendFileSync(LOG_FILE, a.join(' ') + '\n'); } catch (e) {} };
// 清理旧日志（保留最近 20 个）
try { const _logs = fs.readdirSync(LOG_DIR).filter((f) => f.endsWith('.log')).map((f) => ({ f, t: fs.statSync(path.join(LOG_DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t); for (const l of _logs.slice(20)) fs.unlinkSync(path.join(LOG_DIR, l.f)); } catch (e) {}
console.log(`📝 日志: ${LOG_FILE}`);

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
const _mode = [DRY_RUN && 'dry-run', RESUME && 'resume', FORCE && 'force', NO_PUSH && 'no-push', ONLY && `only=${ONLY.join(',')}`, CONC_EXPLICIT && `concurrency=${BUILD_CONC}`].filter(Boolean).join(' ') || '增量';
console.log(`🚀 release 开始 | 模式: ${_mode}`);

// ---------- 工具 ----------
function sha256(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }

/** 目录指纹：递归收集 相对路径=SHA256，排序拼接；目录不存在返回 null；excludes 排除子目录名 */
function dirFingerprint(dir, excludes) {
  if (!fs.existsSync(dir)) return null;
  const out = [];
  const walk = (d, rel) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      const r = rel ? rel + '/' + f : f;
      if (fs.statSync(p).isDirectory()) {
        if (excludes && excludes.includes(f)) continue;
        walk(p, r);
      }
      else out.push(r + '=' + sha256(p));
    }
  };
  walk(dir, '');
  return out.sort().join('|');
}

/** 站源码指纹：排除构建产物/依赖/git，用于检测站自身代码变更 */
const SRC_EXCLUDES = ['node_modules', '.output', '.nuxt', '.git', 'vendor'];
function srcFingerprint(station) {
  return dirFingerprint(station, SRC_EXCLUDES);
}

// ---------- 发布状态（release-state.json）：记录各站上次成功 build 时的源码指纹 ----------
const STATE_FILE = path.join(LIB_DIR, 'release-state.json');
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch (e) { return {}; }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** 站点的 vendor dist 与母本 dist 是否一致（一致=true） */
function vendorUpToDate(station) {
  const a = dirFingerprint(path.join(LIB_DIR, 'dist'));
  const b = dirFingerprint(path.join(station, 'vendor', 'ai-article-pipeline', 'dist'));
  return a !== null && a === b;
}

/** 异步执行命令（stdio 直通），Promise 化；retries=失败后重试次数（指数退避 2s/4s/...） */
function runAsync(cmd, cwd, label, timeoutMs, retries) {
  const maxAttempts = 1 + (retries || 0);
  const attempt = (n) => new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(cmd, { cwd, shell: true, stdio: ['ignore', 'inherit', 'inherit'] });
    const timer = timeoutMs ? setTimeout(() => { console.error(`  ⏱ ${label} 超时(${Math.round(timeoutMs / 1000)}s)，已终止`); killTree(child.pid); }, timeoutMs) : null;
    child.on('error', (e) => { if (timer) clearTimeout(timer); resolve({ ok: false, label, error: e.message, ms: Date.now() - t0 }); });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) { resolve({ ok: true, label, ms: Date.now() - t0 }); return; }
      if (n < maxAttempts) {
        const wait = Math.pow(2, n - 1) * 2000;
        console.log(`  ↻ ${label} 失败(exit ${code})，${wait / 1000}s 后重试(${n}/${maxAttempts})`);
        setTimeout(() => attempt(n + 1).then(resolve), wait);
      } else {
        resolve({ ok: false, label, error: 'exit ' + code, ms: Date.now() - t0 });
      }
    });
  });
  return attempt(1);
}

/** 并发池：限制并发执行任务列表 */
async function runPool(tasks, concurrency) {
  const results = [];
  let idx = 0;
  const worker = async () => {
    while (idx < tasks.length) {
      const t = tasks[idx++];
      results.push(await t.fn());
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(concurrency, 1), tasks.length) }, worker));
  return results;
}

function fmt(ms) { return (ms / 1000).toFixed(0) + 's'; }

/** 自适应并发：按可用内存估算（单站 build 峰值 ~1.5GB，留 2GB 余量），不超过 upperBound */
function autoConcurrency(upperBound) {
  const perBuild = 1.5 * 1024 * 1024 * 1024;
  const reserve = 2 * 1024 * 1024 * 1024;
  const usable = os.freemem() - reserve;
  if (usable <= 0) return 1;
  return Math.max(1, Math.min(upperBound, Math.floor(usable / perBuild)));
}

// ---------- Step 1: build 库 ----------
if (DRY_RUN) {
  console.log('\n[1/5] --dry-run：跳过库 build');
} else {
  console.log('\n[1/5] Build auto-ai-article...');
  const t1 = Date.now();
  try { execSync('npm run build', { cwd: LIB_DIR, stdio: 'inherit', timeout: 180000 }); }
  catch (e) { console.error('\n❌ 库 build 失败，终止'); process.exit(1); }
  console.log(`  ✓ 库 build 完成 ${fmt(Date.now() - t1)}`);
}

// ---------- Step 2: 增量判定（sync 前！比对「新 dist」vs「各站当前 vendor」+「站源码指纹」） ----------
console.log('\n[2/5] 增量判定（vendor + 源码指纹）...');
const state = loadState();
const buildTasks = [];
const skipped = [];
const failedPrev = Object.keys(state).filter((k) => state[k].failed);
if (RESUME && failedPrev.length) console.log(`  ↻ --resume：上次失败 ${failedPrev.length} 站: ${failedPrev.join(', ')}`);
for (const s of STATIONS) {
  const name = s.split(path.sep).pop();
  if (ONLY && !ONLY.includes(name)) continue;
  if (!fs.existsSync(path.join(s, 'package.json'))) continue;
  // 跳过没有 build 脚本的站（如 seo-optimizer）
  try {
    const sp = JSON.parse(fs.readFileSync(path.join(s, 'package.json'), 'utf8'));
    if (!sp.scripts || !sp.scripts.build) { skipped.push(name); continue; }
  } catch { skipped.push(name); continue; }
  const srcFP = srcFingerprint(s);
  const hadFail = !!(state[name] && state[name].failed);
  if (RESUME && !hadFail) { skipped.push(name); continue; }
  if (RESUME) {
    buildTasks.push({ name, srcFP, why: '（--resume 重试）', label: 'build ' + name, fn: () => runAsync('npm run build', s, 'build ' + name, 600000) });
    continue;
  }
  const vendorOK = vendorUpToDate(s);
  const srcOK = state[name] && state[name].src === srcFP;
  if (!FORCE && vendorOK && srcOK && !hadFail) { skipped.push(name); continue; }
  const why = FORCE ? '（--force 全量）' : (hadFail ? '（上次失败重试）' : (!vendorOK ? '（vendor 变化）' : '（站源码变化）'));
  buildTasks.push({ name, srcFP, why, label: 'build ' + name, fn: () => runAsync('npm run build', s, 'build ' + name, 600000) });
}
console.log(`  ⏭  跳过: ${skipped.length ? skipped.join(', ') : '无'}${FORCE ? '（--force 全量）' : ''}`);
console.log(`  需要 build: ${buildTasks.length} 站`);

if (DRY_RUN) {
  console.log('\n🔍 --dry-run：仅打印计划，不执行 build/sync/push');
  if (buildTasks.length) for (const t of buildTasks) console.log(`  ▸ build ${t.name} ${t.why}`);
  console.log(`\n🎉 dry-run 完成（总耗时 ${fmt(Date.now() - t0all)}）`);
  console.log(`📝 日志已保存: ${LOG_FILE}`);
  process.exit(0);
}

// ---------- Step 3: sync vendor + rebuild-all 母本（把新 dist 拷贝到所有站；在增量判定之后执行，避免误判全一致） ----------
console.log('\n[3/5] Sync vendor + rebuild-all 母本...');
const t3 = Date.now();
try { execSync('node sync-vendor.cjs', { cwd: LIB_DIR, stdio: 'inherit', timeout: 180000 }); }
catch (e) { console.error('\n❌ sync 失败，终止'); process.exit(1); }
const rootRebuild = path.join(LIB_DIR, 'rebuild-all.cjs');
if (fs.existsSync(rootRebuild)) {
  for (const s of STATIONS) {
    const dest = path.join(s, 'rebuild-all.cjs');
    try { fs.copyFileSync(rootRebuild, dest); } catch (e) { /* 忽略不存在的站 */ }
  }
  console.log(`  ✓ rebuild-all.cjs 母本已复制到各站`);
}
console.log(`  ✓ sync 完成 ${fmt(Date.now() - t3)}`);

// ---------- Step 4: 批量 build 各站（并行；仅增量判定出的站） ----------
console.log('\n[4/5] Build stations（验证）...');
const t4 = Date.now();
const effConc = CONC_EXPLICIT ? BUILD_CONC : autoConcurrency(BUILD_CONC);
if (!CONC_EXPLICIT) console.log(`  自适应并发：可用内存 ${(os.freemem() / 1024 / 1024 / 1024).toFixed(1)}GB → 并发 ${effConc}`);
const buildResults = buildTasks.length ? await runPool(buildTasks, effConc) : [];
buildResults.forEach((r, i) => console.log(`  ${r.ok ? '✓' : '✗'} ${r.label} ${fmt(r.ms)} (${i + 1}/${buildResults.length})${r.ok ? '' : '  ' + (r.error || '')}`));
console.log(`  ✓ build 阶段完成 ${fmt(Date.now() - t4)}`);

const failed = buildResults.filter((r) => !r.ok);
// 记录状态：成功→记 src 指纹 + 清 failed；失败→记 failed（下次自动重试或 --resume）
for (const r of buildResults) {
  const t = buildTasks.find((x) => x.label === r.label);
  if (!t) continue;
  if (r.ok) state[t.name] = { src: t.srcFP };
  else state[t.name] = { src: t.srcFP, failed: { ts: Date.now(), error: r.error || 'unknown' } };
}
saveState(state);
if (failed.length) {
  console.error(`\n\n❌ ${failed.length} 个站 build 失败，未 push（可用 --resume 重试）：`);
  for (const f of failed) console.error(`  - ${f.label}${f.error ? '（' + f.error + '）' : ''}`);
  process.exit(1);
}
console.log(`\n✅ build 通过：${buildResults.length} 站（跳过 ${skipped.length} 站）`);

// ---------- Step 4: commit + push ----------
if (NO_PUSH) {
  console.log('\n[5/5] --no-push 模式，跳过 push');
  if (buildResults.length) {
    console.log('\n📊 build 耗时(降序 top5):');
    [...buildResults].sort((a, b) => b.ms - a.ms).slice(0, 5).forEach((r) => console.log(`  ${fmt(r.ms).padStart(6)}  ${r.label.replace('build ', '')}`));
  }
  console.log(`\n🎉 完成（总耗时 ${fmt(Date.now() - t0all)}）`);
  console.log(`📝 日志已保存: ${LOG_FILE}`);
  process.exit(0);
}

console.log('\n[5/5] Commit + push...');
const t5 = Date.now();
const pushTasks = [];
// 库自身
try {
  execSync('git add -A && git commit -m "release: vendor update" && git push', { cwd: LIB_DIR, stdio: 'inherit', timeout: 180000 });
  console.log('  ✓ push lib');
} catch (e) { console.error('  ✗ push lib 失败（忽略继续）'); }
// 各站（并行）
for (const s of STATIONS) {
  const name = s.split(path.sep).pop();
  if (ONLY && !ONLY.includes(name)) continue;
  if (!fs.existsSync(path.join(s, 'package.json'))) continue;
    pushTasks.push({ fn: () => runAsync('git add -A && (git commit -m "vendor update" || true) && git push', s, 'push ' + name, 180000, 2) });
}
const pushResults = await runPool(pushTasks, PUSH_CONC);
pushResults.forEach((r, i) => console.log(`  ${r.ok ? '✓' : '✗'} ${r.label} ${fmt(r.ms)} (${i + 1}/${pushResults.length})${r.ok ? '' : '  ' + (r.error || '')}`));

// ---------- 汇总 ----------
console.log('\n📊 汇总:');
if (buildResults.length) {
  const _sorted = [...buildResults].sort((a, b) => b.ms - a.ms);
  console.log('  build 耗时(降序 top5):');
  _sorted.slice(0, 5).forEach((r) => console.log(`    ${fmt(r.ms).padStart(6)}  ${r.label.replace('build ', '')}`));
  if (_sorted.length > 5) console.log(`    ... 共 ${_sorted.length} 站`);
}
if (pushResults.length) {
  const _ok = pushResults.filter((r) => r.ok).length;
  console.log(`  push: ${_ok}/${pushResults.length} 成功`);
}
console.log(`\n🎉 全部完成（总耗时 ${fmt(Date.now() - t0all)}）`);
console.log(`📝 日志已保存: ${LOG_FILE}`);
}

main().catch((e) => { console.error('\n❌ release 异常:', e); process.exit(1); });
