#!/usr/bin/env node
"use strict";
// ============================================================
// CLI 入口 — 手动触发 AI 文章生成
// 用法：npx ai-article-pipeline [options]
//
// 两种模式：
//   1. 本地模式（默认）：用内存 DemoDB + 本地 AI 网关，适合 dry-run 测试
//   2. 远程模式（--remote=<url>）：通过 HTTP API 触发远程站点生成，适合生产使用
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseArgs = parseArgs;
exports.usage = usage;
exports.buildCheckConfig = buildCheckConfig;
exports.createDemoDB = createDemoDB;
exports.main = main;
const index_js_1 = require("./index.js");
const config_check_js_1 = require("./config-check.js");
// —— 参数解析 ——
function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--dry-run') {
            args.dryRun = true;
            continue;
        }
        if (a.startsWith('--')) {
            const [k, v] = a.slice(2).split('=');
            args[k] = v ?? true;
        }
    }
    return args;
}
function usage() {
    console.log(`
用法：ai-article-pipeline [options]

模式：
  本地模式（默认）    用内存 DemoDB + 本地 AI 网关，适合 dry-run 测试
  远程模式（--remote） 通过 HTTP API 触发远程站点生成，适合生产使用

选项：
  --remote=<url>        远程站点 API 基址（如 https://www.example.cc），启用远程模式
  --site=<name>         站点标识（远程模式必填，如 172、hm）
  --remote-key=<key>    远程站点 admin 密钥
  --remote-key-file=<path>  admin 密钥文件路径（内容为 MANAGE_KEY=xxx）
  --gateway=<url>       本地 AI 网关地址（默认 http://localhost:3456/v1）
  --model=<name>        本地 AI 模型（默认 deepseek-chat）
  --local-models=<a,b>  本地候选模型（逗号分隔，按优先级轮换；模型不可用时自动切换）
  --local-lock-file=<path>  本地发文互斥锁路径
  --cloud-model=<name>  云端 AI 模型
  --target=<n>          每日目标篇数（默认 3）
  --local-timeout=<ms>  本地 AI 单次请求超时毫秒（默认 280000）
  --gateway-start-cmd=<cmd>  本地网关离线时自愈拉起命令
  --gateway-chrome-start-cmd=<cmd>  网关 degraded 时拉起浏览器命令
  --cloud-fallback-url=<url>  本地离线且无云端 key 时整轮转的线上兜底 API
  --api-key=<key>       AI API Key（云端模式）
  --api-base=<url>      AI API 地址（默认 https://api.openai.com/v1）
  --ai-model=<name>     云端 AI 模型名称（默认 gpt-4o-mini）
  --openrouter-key=<key> OpenRouter 兜底 Key（或设 OPENROUTER_API_KEY 环境变量）
  --alert-webhook=<url>  告警 webhook URL（飞书/钉钉/通用）
  --alert-rate=<n>       告警阈值：成功率低于此值触发（默认 0.6）
  --dry-run             只生成不入库
  --check               只校验配置不执行，打印结果后退出
  --help                显示帮助

示例：
  # 本地 dry-run 测试
  ai-article-pipeline --dry-run

  # 远程触发站点生成
  ai-article-pipeline --remote=https://www.example.cc --site=172 --remote-key=xxx

  # 本地生成 + 告警
  ai-article-pipeline --gateway=http://localhost:3456/v1 --alert-webhook=https://open.feishu.cn/open-apis/bot/v2/hook/xxx --alert-rate=0.6
`);
}
// —— 启动前配置校验：从 args + env 构建扁平配置对象 ——
function buildCheckConfig(args) {
    return {
        OPENROUTER_API_KEY: String(args['openrouter-key'] || process.env.OPENROUTER_API_KEY || ''),
        DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY || '',
        GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
        MISTRAL_API_KEY: process.env.MISTRAL_API_KEY || '',
        CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY || '',
        LLM_API_KEY: process.env.LLM_API_KEY || '',
        AI_API_KEY: String(args['api-key'] || process.env.AI_API_KEY || ''),
        LOCAL_GATEWAY_URL: String(args.gateway || process.env.LOCAL_GATEWAY_URL || 'http://localhost:3456/v1'),
        ALERT_WEBHOOK_URL: String(args['alert-webhook'] || process.env.ALERT_WEBHOOK_URL || ''),
        ALERT_MIN_SUCCESS_RATE: args['alert-rate'] ? String(args['alert-rate']) : process.env.ALERT_MIN_SUCCESS_RATE || '',
    };
}
// —— 简易内存 DB（CLI 演示用，实际使用需替换）——
function createDemoDB() {
    const seeds = [];
    let seedId = 1;
    return {
        fetchPendingSeeds: async (size) => seeds.filter((s) => s.status === 'pending').slice(0, size),
        insertSeeds: async (items) => {
            for (const item of items) {
                seeds.push({
                    id: seedId++,
                    raw: item.raw,
                    category: item.category || 'auto',
                    template: item.template || 'auto',
                    status: 'pending',
                    publishAt: item.publishAt || null,
                    expiresAt: item.expiresAt || null,
                    articleId: null,
                    error: null,
                    source: 'ai',
                    fp: '',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                });
            }
            return { added: items.length };
        },
        markSeedDone: async (id) => {
            const s = seeds.find((x) => x.id === id);
            if (s)
                s.status = 'done';
        },
        markSeedFailed: async (id, error) => {
            const s = seeds.find((x) => x.id === id);
            if (s) {
                s.status = 'failed';
                s.error = error;
            }
        },
        insertArticles: async (articles) => {
            const results = articles.map((a, i) => ({
                id: `cli-${Date.now()}-${i}`,
                ok: true,
            }));
            return { total: articles.length, created: articles.length, failed: 0, results };
        },
        insertRunLog: async () => { },
    };
}
// —— 主入口 ——
async function main() {
    const args = parseArgs(process.argv);
    if (args.help) {
        usage();
        process.exit(0);
    }
    if (args.check) {
        const result = (0, config_check_js_1.validateConfig)(buildCheckConfig(args));
        if (result.errors.length) {
            console.error('配置校验失败：');
            for (const e of result.errors)
                console.error(`  [error] ${e}`);
        }
        else {
            console.log('配置校验通过');
        }
        if (result.warnings.length) {
            console.log('警告：');
            for (const w of result.warnings)
                console.log(`  [warn] ${w}`);
        }
        process.exit(result.valid ? 0 : 1);
    }
    // —— 告警配置 ——
    const alert = args['alert-webhook']
        ? {
            webhookUrl: String(args['alert-webhook']),
            minSuccessRate: Number.parseFloat(String(args['alert-rate'] || '0.6')),
        }
        : undefined;
    // —— 远程模式：通过 HTTP API 触发远程站点生成 ——
    if (args.remote) {
        const site = String(args.site || '');
        if (!site) {
            console.error('远程模式需要 --site=<name>');
            process.exit(1);
        }
        console.log('=== ai-article-pipeline CLI（远程模式）===');
        console.log(`站点: ${site}`);
        console.log(`远程: ${args.remote}`);
        console.log();
        try {
            const result = await (0, index_js_1.runScheduledGenerate)({
                site,
                adminBase: String(args.remote),
                adminKey: args['remote-key'] ? String(args['remote-key']) : undefined,
                adminKeyFile: args['remote-key-file'] ? String(args['remote-key-file']) : undefined,
                dailyTarget: Number.parseInt(String(args.target || '3'), 10),
                dryRun: !!args.dryRun,
                alert,
            });
            console.log();
            console.log('=== 结果 ===');
            console.log(`模式: ${result.mode}`);
            if (result.reason)
                console.log(`原因: ${result.reason}`);
            if (result.pipeline) {
                console.log(`成功: ${result.pipeline.ok}`);
                console.log(`失败: ${result.pipeline.fail}`);
            }
        }
        catch (e) {
            console.error('执行失败:', e.message);
            process.exit(1);
        }
        return;
    }
    // —— 本地模式：内存 DemoDB + 本地 AI 网关 ——
    const config = {
        dryRun: !!args.dryRun,
        dailyTarget: Number.parseInt(String(args.target || '3'), 10),
        localGateway: String(args.gateway || 'http://localhost:3456/v1'),
        localModel: String(args.model || 'deepseek-chat'),
        localModels: args['local-models']
            ? String(args['local-models'])
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        localLockFile: args['local-lock-file'] ? String(args['local-lock-file']) : undefined,
        cloudModel: String(args['cloud-model'] || ''),
        localTimeoutMs: Number.parseInt(String(args['local-timeout'] || '280000'), 10),
        localGatewayStartCommand: args['gateway-start-cmd'] ? String(args['gateway-start-cmd']) : undefined,
        localChromeStartCommand: args['gateway-chrome-start-cmd'] ? String(args['gateway-chrome-start-cmd']) : undefined,
        alert,
        ai: {
            apiKey: String(args['api-key'] || ''),
            baseUrl: String(args['api-base'] || 'https://api.openai.com/v1'),
            model: String(args['ai-model'] || 'gpt-4o-mini'),
            openrouter: String(args['openrouter-key'] || process.env.OPENROUTER_API_KEY || '')
                ? { apiKey: String(args['openrouter-key'] || process.env.OPENROUTER_API_KEY || ''), models: undefined }
                : undefined,
        },
    };
    if (args['cloud-fallback-url']) {
        const url = String(args['cloud-fallback-url']);
        config.cloudFallback = async (ctx) => {
            console.log(`离线，整轮转云端兜底: ${url}`);
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dryRun: ctx.dryRun }),
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                return { ok: false, message: `云端兜底 HTTP ${res.status} ${text.slice(0, 120)}` };
            }
            const data = await res.json().catch(() => null);
            return { ok: true, message: data?.message || '云端兜底已执行' };
        };
    }
    const checkResult = (0, config_check_js_1.validateConfig)(buildCheckConfig(args));
    if (checkResult.errors.length) {
        console.error('配置校验失败，启动中止：');
        for (const e of checkResult.errors)
            console.error(`  [error] ${e}`);
        process.exit(1);
    }
    const db = createDemoDB();
    console.log('=== ai-article-pipeline CLI ===');
    console.log(`模式: ${config.dryRun ? 'dry-run' : 'normal'}`);
    console.log(`目标: ${config.dailyTarget} 篇`);
    console.log();
    try {
        const result = await (0, index_js_1.execute)(db, config);
        console.log();
        console.log('=== 结果 ===');
        console.log(`模式: ${result.mode}`);
        if (result.reason)
            console.log(`原因: ${result.reason}`);
        if (result.pipeline) {
            console.log(`成功: ${result.pipeline.ok}`);
            console.log(`失败: ${result.pipeline.fail}`);
            if (result.pipeline.articles.length) {
                console.log('文章:');
                for (const a of result.pipeline.articles) {
                    console.log(`  - ${a.title} → ${a.articleId}`);
                }
            }
            if (result.pipeline.errors.length) {
                console.log('错误:');
                for (const e of result.pipeline.errors) {
                    console.log(`  - ${e}`);
                }
            }
        }
    }
    catch (e) {
        console.error('执行失败:', e.message);
        process.exit(1);
    }
}
if (require.main === module)
    main();
