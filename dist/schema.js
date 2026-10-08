"use strict";
// ============================================================
// 数据库 Schema 定义 — 所有子站共用
// 修改表结构只改这里；不要在其他文件再复制一份。
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.runLogs = exports.seeds = exports.articles = void 0;
const sqlite_core_1 = require("drizzle-orm/sqlite-core");
// —— 文章表 ——
exports.articles = (0, sqlite_core_1.sqliteTable)('articles', {
    id: (0, sqlite_core_1.text)('id').primaryKey(),
    title: (0, sqlite_core_1.text)('title').notNull(),
    summary: (0, sqlite_core_1.text)('summary').notNull().default(''),
    content: (0, sqlite_core_1.text)('content').notNull(),
    firstImage: (0, sqlite_core_1.text)('first_image'),
    template: (0, sqlite_core_1.text)('template').notNull().default('default'),
    category: (0, sqlite_core_1.text)('category').notNull().default(''),
    tags: (0, sqlite_core_1.text)('tags').notNull().default('[]'),
    status: (0, sqlite_core_1.text)('status').notNull().default('draft'),
    publishAt: (0, sqlite_core_1.text)('publish_at'),
    expiresAt: (0, sqlite_core_1.text)('expires_at'),
    links: (0, sqlite_core_1.text)('links').notNull().default('[]'),
    friendLinks: (0, sqlite_core_1.text)('friend_links').notNull().default('[]'),
    relatedIds: (0, sqlite_core_1.text)('related_ids').notNull().default('[]'),
    faq: (0, sqlite_core_1.text)('faq').notNull().default('[]'),
    createdAt: (0, sqlite_core_1.text)('created_at').notNull(),
    updatedAt: (0, sqlite_core_1.text)('updated_at').notNull(),
}, (t) => [
    (0, sqlite_core_1.index)('idx_articles_category_status').on(t.category, t.status),
    (0, sqlite_core_1.index)('idx_articles_status_updated').on(t.status, t.updatedAt),
]);
// —— 素材池 ——
exports.seeds = (0, sqlite_core_1.sqliteTable)('seeds', {
    id: (0, sqlite_core_1.integer)('id').primaryKey({ autoIncrement: true }),
    raw: (0, sqlite_core_1.text)('raw').notNull(),
    category: (0, sqlite_core_1.text)('category').notNull().default('优惠'),
    template: (0, sqlite_core_1.text)('template').notNull().default('deal'),
    status: (0, sqlite_core_1.text)('status').notNull().default('pending'),
    publishAt: (0, sqlite_core_1.text)('publish_at'),
    expiresAt: (0, sqlite_core_1.text)('expires_at'),
    articleId: (0, sqlite_core_1.text)('article_id'),
    error: (0, sqlite_core_1.text)('error'),
    source: (0, sqlite_core_1.text)('source').notNull().default('admin'),
    fp: (0, sqlite_core_1.text)('fp').notNull().default(''),
    createdAt: (0, sqlite_core_1.text)('created_at').notNull(),
    updatedAt: (0, sqlite_core_1.text)('updated_at').notNull(),
}, (t) => [(0, sqlite_core_1.index)('idx_seeds_status').on(t.status)]);
// —— 运行日志 ——
exports.runLogs = (0, sqlite_core_1.sqliteTable)('run_logs', {
    id: (0, sqlite_core_1.integer)('id').primaryKey({ autoIncrement: true }),
    runAt: (0, sqlite_core_1.text)('run_at').notNull(),
    model: (0, sqlite_core_1.text)('model').notNull().default(''),
    total: (0, sqlite_core_1.integer)('total').notNull().default(0),
    ok: (0, sqlite_core_1.integer)('ok').notNull().default(0),
    fail: (0, sqlite_core_1.integer)('fail').notNull().default(0),
    error: (0, sqlite_core_1.text)('error'),
    dryRun: (0, sqlite_core_1.integer)('dry_run').notNull().default(0),
    createdAt: (0, sqlite_core_1.text)('created_at').notNull(),
}, (t) => [(0, sqlite_core_1.index)('idx_run_logs_created').on(t.createdAt)]);
