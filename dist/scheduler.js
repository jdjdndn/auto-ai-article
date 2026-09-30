"use strict";
// ============================================================
// 定时调度器 — 基于 Cloudflare Durable Objects Alarms
// 每天固定时间触发文章生成，无需 cron triggers
// ============================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArticleScheduler = void 0;
exports.startScheduler = startScheduler;
const executor_js_1 = require("./executor.js");
/**
 * ArticleScheduler — Durable Object class
 *
 * 使用方式（在 Worker 入口文件中）：
 * ```ts
 * export { ArticleScheduler } from 'ai-article-pipeline'
 * ```
 *
 * wrangler.jsonc 配置：
 * ```json
 * {
 *   "durable_objects": {
 *     "bindings": [{ "name": "ARTICLE_SCHEDULER", "class_name": "ArticleScheduler" }]
 *   },
 *   "migrations": [{ "tag": "v1", "new_classes": ["ArticleScheduler"] }]
 * }
 * ```
 */
class ArticleScheduler {
    ctx;
    env;
    constructor(state, env) {
        this.ctx = state;
        this.env = env;
    }
    /** alarm 处理函数 — Cloudflare DO alarm 触发时调用 */
    async alarm() {
        console.log(`[scheduler] alarm 触发: ${new Date().toISOString()}`);
        try {
            const db = this.env.DB;
            const pipelineDB = createPipelineDB(db);
            const result = await (0, executor_js_1.execute)(pipelineDB, {
                dailyTarget: 3,
                ai: { model: '@cf/qwen/qwen3-30b-a3b-fp8' },
            });
            console.log(`[scheduler] 执行完成:`, result);
        }
        catch (e) {
            console.error(`[scheduler] 执行失败:`, e.message);
        }
        // 设置下一天的 alarm
        await this.scheduleNext();
    }
    /** 启动调度器 — 设置第一次 alarm */
    async start(config = {}) {
        const existing = await this.ctx.storage.getAlarm();
        if (existing) {
            console.log(`[scheduler] alarm 已存在: ${new Date(existing).toISOString()}`);
            return { scheduled: new Date(existing).toISOString() };
        }
        const next = this.getNextAlarmTime(config.time || '08:00');
        await this.ctx.storage.setAlarm(next);
        console.log(`[scheduler] 首次 alarm 设置: ${new Date(next).toISOString()}`);
        return { scheduled: new Date(next).toISOString() };
    }
    /** 获取 alarm 状态 */
    async getStatus() {
        const alarm = await this.ctx.storage.getAlarm();
        return {
            hasAlarm: !!alarm,
            nextAlarm: alarm ? new Date(alarm).toISOString() : null,
        };
    }
    /** 设置下一天的 alarm */
    async scheduleNext(time) {
        const next = this.getNextAlarmTime(time || '08:00');
        await this.ctx.storage.setAlarm(next);
        console.log(`[scheduler] 下次 alarm: ${new Date(next).toISOString()}`);
    }
    /** 计算下一次 alarm 时间（固定时间，每天触发） */
    getNextAlarmTime(timeStr) {
        const [hours, minutes] = timeStr.split(':').map(Number);
        const now = new Date();
        const target = new Date();
        target.setHours(hours, minutes, 0, 0);
        // 如果目标时间已过，设置为明天
        if (target <= now) {
            target.setDate(target.getDate() + 1);
        }
        return target.getTime();
    }
}
exports.ArticleScheduler = ArticleScheduler;
/** 创建 PipelineDB 适配器（供 DO 内部使用） */
function createPipelineDB(db) {
    return {
        async fetchPendingSeeds(size) {
            const { seeds } = await Promise.resolve().then(() => __importStar(require('./schema.js')));
            const { eq, desc } = await Promise.resolve().then(() => __importStar(require('drizzle-orm')));
            return db.select().from(seeds)
                .where(eq(seeds.status, 'pending'))
                .orderBy(desc(seeds.id))
                .limit(size);
        },
        async insertSeeds(items, source) {
            const { seeds } = await Promise.resolve().then(() => __importStar(require('./schema.js')));
            const now = new Date().toISOString();
            const rows = items
                .filter(it => it.raw?.length >= 8)
                .map(it => ({
                raw: it.raw,
                category: it.category || '优惠',
                template: it.template || 'deal',
                status: 'pending',
                source,
                createdAt: now,
                updatedAt: now,
            }));
            if (!rows.length)
                return { added: 0 };
            await db.insert(seeds).values(rows);
            return { added: rows.length };
        },
        async markSeedDone(id, articleId) {
            const { seeds } = await Promise.resolve().then(() => __importStar(require('./schema.js')));
            const { eq } = await Promise.resolve().then(() => __importStar(require('drizzle-orm')));
            await db.update(seeds).set({
                status: 'done',
                articleId,
                error: null,
                updatedAt: new Date().toISOString(),
            }).where(eq(seeds.id, id));
        },
        async markSeedFailed(id, error) {
            const { seeds } = await Promise.resolve().then(() => __importStar(require('./schema.js')));
            const { eq } = await Promise.resolve().then(() => __importStar(require('drizzle-orm')));
            await db.update(seeds).set({
                status: 'failed',
                error: String(error).slice(0, 500),
                updatedAt: new Date().toISOString(),
            }).where(eq(seeds.id, id));
        },
        async insertArticles(articlesList) {
            const { articles } = await Promise.resolve().then(() => __importStar(require('./schema.js')));
            const results = [];
            for (const a of articlesList) {
                try {
                    const id = `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    await db.insert(articles).values({
                        id,
                        title: a.title,
                        summary: a.summary || '',
                        content: typeof a.content === 'string' ? a.content : JSON.stringify(a.content || []),
                        template: a.template || 'default',
                        category: a.category || '',
                        tags: typeof a.tags === 'string' ? a.tags : JSON.stringify(a.tags || []),
                        status: a.status || 'published',
                        publishAt: a.publishAt || null,
                        expiresAt: a.expiresAt || null,
                        links: typeof a.links === 'string' ? a.links : JSON.stringify(a.links || []),
                        friendLinks: typeof a.friendLinks === 'string' ? a.friendLinks : JSON.stringify(a.friendLinks || []),
                        relatedIds: typeof a.relatedIds === 'string' ? a.relatedIds : JSON.stringify(a.relatedIds || []),
                        faq: typeof a.faq === 'string' ? a.faq : JSON.stringify(a.faq || []),
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    });
                    results.push({ id, ok: true });
                }
                catch (e) {
                    results.push({ id: '', ok: false, error: e.message });
                }
            }
            return {
                total: articlesList.length,
                created: results.filter(r => r.ok).length,
                failed: results.filter(r => !r.ok).length,
                results,
            };
        },
        async insertRunLog(log) {
            const { runLogs } = await Promise.resolve().then(() => __importStar(require('./schema.js')));
            await db.insert(runLogs).values({
                runAt: log.runAt || new Date().toISOString(),
                model: log.model || '',
                total: log.total || 0,
                ok: log.ok || 0,
                fail: log.fail || 0,
                error: log.error || null,
                dryRun: log.dryRun ? 1 : 0,
                createdAt: new Date().toISOString(),
            });
        },
    };
}
/**
 * 启动调度器 — 在 Worker fetch handler 中调用
 *
 * @example
 * ```ts
 * import { startScheduler } from 'ai-article-pipeline'
 *
 * export default {
 *   async fetch(request, env) {
 *     const scheduler = startScheduler(env, { time: '08:00' })
 *     await scheduler.start()
 *     return new Response('Scheduler started')
 *   }
 * }
 * ```
 */
function startScheduler(env, config = {}) {
    const id = env.ARTICLE_SCHEDULER.idFromName('global');
    const stub = env.ARTICLE_SCHEDULER.get(id);
    return {
        start: () => stub.start(config),
        getStatus: () => stub.getStatus(),
    };
}
