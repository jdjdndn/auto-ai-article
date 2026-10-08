"use strict";
// ============================================================
// 定时调度器 — 基于 Cloudflare Durable Objects Alarms
// 每天固定时间触发文章生成，无需 cron triggers
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArticleScheduler = void 0;
exports.getNextAlarmTime = getNextAlarmTime;
exports.applyWorkerEnv = applyWorkerEnv;
exports.initDoAlarm = initDoAlarm;
exports.rescheduleDoAlarm = rescheduleDoAlarm;
exports.startScheduler = startScheduler;
exports.createDailyAlarmPlugin = createDailyAlarmPlugin;
exports.createScheduledPlugin = createScheduledPlugin;
const executor_js_1 = require("./executor.js");
const schema_js_1 = require("./schema.js");
const drizzle_orm_1 = require("drizzle-orm");
const utils_js_1 = require("./utils.js");
// ============================================================
// 通用调度工具（供消费项目 Nitro 插件 / 裸 Worker 复用）
// ============================================================
/** 计算下一次 alarm 时间（固定时间，每天触发，UTC+8 中国时区；time 形如 "08:00"） */
function getNextAlarmTime(timeStr, from = new Date()) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    // Workers 是 UTC，先 +8 偏移到中国时间再算
    const now = new Date(from.getTime() + 8 * 3600 * 1000);
    const target = new Date(now);
    target.setUTCHours(hours, minutes, 0, 0);
    if (target <= now) {
        target.setUTCDate(target.getUTCDate() + 1);
    }
    // 减回 8 偏移，得到真实 UTC 时间戳
    return target.getTime() - 8 * 3600 * 1000;
}
/** 把 Worker env 注入 globalThis.__env__ 与 process.env（DB/AI），供 alarm/scheduled 路径读取 */
function applyWorkerEnv(env) {
    if (!env)
        return;
    globalThis.__env__ = env;
    if (env.DB)
        process.env.DB = env.DB;
    if (env.AI)
        process.env.AI = env.AI;
}
/** DO alarm 首次初始化：已有 alarm 则不动（返回 null），否则设置下一次并返回时间戳 */
async function initDoAlarm(storage, time) {
    const existing = await storage.getAlarm();
    if (existing) {
        console.log(`[scheduler] alarm 已存在: ${new Date(existing).toISOString()}`);
        return null;
    }
    const next = getNextAlarmTime(time);
    await storage.setAlarm(next);
    console.log(`[scheduler] 首次 alarm 设置: ${new Date(next).toISOString()}`);
    return next;
}
/** DO alarm 触发后重设下一次（一次性 alarm 必须重设），返回时间戳 */
async function rescheduleDoAlarm(storage, time) {
    const next = getNextAlarmTime(time);
    await storage.setAlarm(next);
    console.log(`[scheduler] 下次 alarm: ${new Date(next).toISOString()}`);
    return next;
}
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
            // 配置从 this.config 读，不硬编码
            const cfg = this._config || {};
            const result = await (0, executor_js_1.execute)(pipelineDB, cfg.executorConfig || {});
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
        ;
        this._config = config;
        const existing = await this.ctx.storage.getAlarm();
        if (existing) {
            console.log(`[scheduler] alarm 已存在: ${new Date(existing).toISOString()}`);
            return { scheduled: new Date(existing).toISOString() };
        }
        const next = getNextAlarmTime(config.time || '08:00');
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
        const next = getNextAlarmTime(time || '08:00');
        await this.ctx.storage.setAlarm(next);
        console.log(`[scheduler] 下次 alarm: ${new Date(next).toISOString()}`);
    }
}
exports.ArticleScheduler = ArticleScheduler;
/** 创建 PipelineDB 适配器（供 DO 内部使用） */
function createPipelineDB(db) {
    return {
        async fetchPendingSeeds(size) {
            return db.select().from(schema_js_1.seeds)
                .where((0, drizzle_orm_1.eq)(schema_js_1.seeds.status, 'pending'))
                .orderBy((0, drizzle_orm_1.desc)(schema_js_1.seeds.id))
                .limit(size);
        },
        async insertSeeds(items, source) {
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
            await db.insert(schema_js_1.seeds).values(rows);
            return { added: rows.length };
        },
        async markSeedDone(id, articleId) {
            await db.update(schema_js_1.seeds).set({
                status: 'done',
                articleId,
                error: null,
                updatedAt: new Date().toISOString(),
            }).where((0, drizzle_orm_1.eq)(schema_js_1.seeds.id, id));
        },
        async markSeedFailed(id, error) {
            await db.update(schema_js_1.seeds).set({
                status: 'failed',
                error: String(error).slice(0, 500),
                updatedAt: new Date().toISOString(),
            }).where((0, drizzle_orm_1.eq)(schema_js_1.seeds.id, id));
        },
        async insertArticles(articlesList) {
            const results = [];
            const now = new Date().toISOString();
            const rows = articlesList.map((a) => ({
                id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                title: a.title,
                summary: a.summary || '',
                content: typeof a.content === 'string' ? a.content : JSON.stringify(a.content || []),
                firstImage: (0, utils_js_1.firstImageOf)(typeof a.content === 'string' ? [] : (a.content || [])),
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
                createdAt: now,
                updatedAt: now,
            }));
            try {
                await db.insert(schema_js_1.articles).values(rows);
                for (const r of rows)
                    results.push({ id: r.id, ok: true });
            }
            catch (e) {
                for (const r of rows)
                    results.push({ id: r.id, ok: false, error: e.message });
            }
            return {
                total: articlesList.length,
                created: results.filter(r => r.ok).length,
                failed: results.filter(r => !r.ok).length,
                results,
            };
        },
        async insertRunLog(log) {
            await db.insert(schema_js_1.runLogs).values({
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
/** DO alarm 定时触发插件工厂（配合 Nitro 的 cloudflare:durable:* hooks） */
function createDailyAlarmPlugin(opts) {
    const alarmTime = opts.alarmTime || '08:00';
    return (nitroApp) => {
        // DO 初始化时设置首次 alarm
        nitroApp.hooks.hook('cloudflare:durable:init', async (durable, { state }) => {
            await initDoAlarm(state.storage, alarmTime);
        });
        // DO alarm 触发：env 注入 → 可选额外处理 → 每日生成 → 重设下一次
        nitroApp.hooks.hook('cloudflare:durable:alarm', async (durable) => {
            console.log(`[alarm] 触发: ${new Date().toISOString()}`);
            applyWorkerEnv(durable.env);
            if (opts.onAlarm) {
                try {
                    await opts.onAlarm();
                    console.log(`[alarm] 定时发布/过期处理完成`);
                }
                catch (e) {
                    console.error(`[alarm] 定时发布/过期处理失败:`, e?.message);
                }
            }
            try {
                const result = await opts.generate();
                console.log(`[alarm] 完成:`, result);
            }
            catch (e) {
                console.error(`[alarm] 生成失败:`, e?.message);
            }
            // 一次性 alarm，触发后必须重设下一次，否则次日起不再自动发文
            try {
                await rescheduleDoAlarm(durable.ctx.storage, alarmTime);
            }
            catch (e) {
                console.error(`[alarm] 重设失败:`, e?.message);
            }
        });
    };
}
/** Workers Cron Triggers 触发插件工厂（备用路径，仅在重新启用 cron 时生效） */
function createScheduledPlugin(opts) {
    return (nitroApp) => {
        nitroApp.hooks.hook('cloudflare:scheduled', async (payload) => {
            applyWorkerEnv(payload?.env);
            console.log('[scheduled] cron 触发:', new Date().toISOString());
            try {
                const result = await opts.generate();
                console.log('[scheduled] 完成:', result);
                return result;
            }
            catch (e) {
                console.error('[scheduled] 失败:', e?.message);
                return { ok: false, error: e?.message };
            }
        });
    };
}
