#!/usr/bin/env node
"use strict";
// ============================================================
// CLI 入口 — 手动触发 AI 文章生成
// 用法：npx ai-article-pipeline [options]
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("./index.js");
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

选项：
  --gateway=<url>       本地 AI 网关地址（默认 http://localhost:3456/v1）
  --model=<name>        本地 AI 模型（默认 deepseek-chat）
  --cloud-model=<name>  云端 AI 模型
  --target=<n>          每日目标篇数（默认 3）
  --api-key=<key>       AI API Key（云端模式）
  --api-base=<url>      AI API 地址（默认 https://api.openai.com/v1）
  --ai-model=<name>     云端 AI 模型名称（默认 gpt-4o-mini）
  --openrouter-key=<key> OpenRouter 兜底 Key（CF 额度用尽自动切换免费模型链；或设 OPENROUTER_API_KEY 环境变量）
  --dry-run             只生成不入库
  --help                显示帮助

示例：
  ai-article-pipeline --dry-run
  ai-article-pipeline --gateway=http://localhost:3456/v1 --model=kimi
  ai-article-pipeline --api-key=sk-xxx --ai-model=gpt-4o-mini
`);
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
    const config = {
        dryRun: !!args.dryRun,
        dailyTarget: parseInt(String(args.target || '3'), 10),
        localGateway: String(args.gateway || 'http://localhost:3456/v1'),
        localModel: String(args.model || 'deepseek-chat'),
        cloudModel: String(args['cloud-model'] || ''),
        ai: {
            apiKey: String(args['api-key'] || ''),
            baseUrl: String(args['api-base'] || 'https://api.openai.com/v1'),
            model: String(args['ai-model'] || 'gpt-4o-mini'),
            openrouter: String(args['openrouter-key'] || process.env.OPENROUTER_API_KEY || '')
                ? { apiKey: String(args['openrouter-key'] || process.env.OPENROUTER_API_KEY || ''), models: undefined }
                : undefined,
        },
    };
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
main();
