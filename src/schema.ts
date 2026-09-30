// ============================================================
// 数据库 Schema 定义 — 所有子站共用
// 修改表结构只改这里；不要在其他文件再复制一份。
// ============================================================

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

// —— 文章表 ——

export const articles = sqliteTable('articles', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  content: text('content').notNull(),
  firstImage: text('first_image'),
  template: text('template').notNull().default('default'),
  category: text('category').notNull().default(''),
  tags: text('tags').notNull().default('[]'),
  status: text('status').notNull().default('draft'),
  publishAt: text('publish_at'),
  expiresAt: text('expires_at'),
  links: text('links').notNull().default('[]'),
  friendLinks: text('friend_links').notNull().default('[]'),
  relatedIds: text('related_ids').notNull().default('[]'),
  faq: text('faq').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  index('idx_articles_category_status').on(t.category, t.status),
  index('idx_articles_status_updated').on(t.status, t.updatedAt),
])

export type ArticleRow = typeof articles.$inferSelect

// —— 素材池 ——

export const seeds = sqliteTable('seeds', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  raw: text('raw').notNull(),
  category: text('category').notNull().default('优惠'),
  template: text('template').notNull().default('deal'),
  status: text('status').notNull().default('pending'),
  publishAt: text('publish_at'),
  expiresAt: text('expires_at'),
  articleId: text('article_id'),
  error: text('error'),
  source: text('source').notNull().default('admin'),
  fp: text('fp').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  index('idx_seeds_status').on(t.status),
])

export type SeedRow = typeof seeds.$inferSelect

// —— 运行日志 ——

export const runLogs = sqliteTable('run_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runAt: text('run_at').notNull(),
  model: text('model').notNull().default(''),
  total: integer('total').notNull().default(0),
  ok: integer('ok').notNull().default(0),
  fail: integer('fail').notNull().default(0),
  error: text('error'),
  dryRun: integer('dry_run').notNull().default(0),
  createdAt: text('created_at').notNull(),
}, (t) => [
  index('idx_run_logs_created').on(t.createdAt),
])

export type RunLogRow = typeof runLogs.$inferSelect
