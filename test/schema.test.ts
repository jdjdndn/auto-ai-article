import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getTableName, isTable, getTableColumns } from 'drizzle-orm'
import { articles, seeds, runLogs } from '../src/schema.js'

// —— 辅助函数 ——

/** 获取表的索引信息：名称 + 列名数组 */
function getIndexInfo(table: object): { name: string; columns: string[] }[] {
  const sym = Object.getOwnPropertySymbols(table).find((s) => s.toString().includes('ExtraConfigBuilder'))
  if (!sym) return []
  const holder = table as Record<symbol, unknown>
  const builder = holder[sym]
  if (typeof builder !== 'function') return []
  const items = (builder as (t: object) => Array<{ config: { name: string; columns: Array<{ name: string }> } }>)(table)
  return items.map((item) => ({
    name: item.config.name,
    columns: item.config.columns.map((c) => c.name),
  }))
}

/** 读取列的 autoIncrement 属性（仅 integer 主键存在） */
function isAutoIncrement(col: object): boolean {
  return (col as Record<string, unknown>).autoIncrement === true
}

// —— articles 表 ——

describe('articles 表 schema', () => {
  it('表名与表对象类型', () => {
    assert.equal(getTableName(articles), 'articles')
    assert.equal(isTable(articles), true)
  })

  it('主键列 id 为 text 类型且非空无默认值', () => {
    const col = articles.id
    assert.equal(col.name, 'id')
    assert.equal(col.dataType, 'string')
    assert.equal(col.notNull, true)
    assert.equal(col.primary, true)
    assert.equal(col.hasDefault, false)
  })

  it('title 为 text 非空无默认值', () => {
    const col = articles.title
    assert.equal(col.name, 'title')
    assert.equal(col.dataType, 'string')
    assert.equal(col.notNull, true)
    assert.equal(col.hasDefault, false)
  })

  it('summary 为 text 非空且默认空字符串', () => {
    const col = articles.summary
    assert.equal(col.name, 'summary')
    assert.equal(col.notNull, true)
    assert.equal(col.hasDefault, true)
    assert.equal(col.default, '')
  })

  it('content 为 text 非空无默认值', () => {
    const col = articles.content
    assert.equal(col.name, 'content')
    assert.equal(col.notNull, true)
    assert.equal(col.hasDefault, false)
  })

  it('firstImage 为 text 可空无默认值，数据库列名 first_image', () => {
    const col = articles.firstImage
    assert.equal(col.name, 'first_image')
    assert.equal(col.notNull, false)
    assert.equal(col.hasDefault, false)
  })

  it('template 为 text 非空且默认 default', () => {
    const col = articles.template
    assert.equal(col.name, 'template')
    assert.equal(col.notNull, true)
    assert.equal(col.hasDefault, true)
    assert.equal(col.default, 'default')
  })

  it('category 为 text 非空且默认空字符串', () => {
    const col = articles.category
    assert.equal(col.name, 'category')
    assert.equal(col.notNull, true)
    assert.equal(col.hasDefault, true)
    assert.equal(col.default, '')
  })

  it('tags 为 text 非空且默认 []', () => {
    const col = articles.tags
    assert.equal(col.name, 'tags')
    assert.equal(col.notNull, true)
    assert.equal(col.hasDefault, true)
    assert.equal(col.default, '[]')
  })

  it('status 为 text 非空且默认 draft', () => {
    const col = articles.status
    assert.equal(col.name, 'status')
    assert.equal(col.notNull, true)
    assert.equal(col.hasDefault, true)
    assert.equal(col.default, 'draft')
  })

  it('publishAt 与 expiresAt 为 text 可空无默认值', () => {
    assert.equal(articles.publishAt.name, 'publish_at')
    assert.equal(articles.publishAt.notNull, false)
    assert.equal(articles.publishAt.hasDefault, false)
    assert.equal(articles.expiresAt.name, 'expires_at')
    assert.equal(articles.expiresAt.notNull, false)
    assert.equal(articles.expiresAt.hasDefault, false)
  })

  it('links / friendLinks / relatedIds / faq 均为 text 非空且默认 []', () => {
    for (const col of [articles.links, articles.friendLinks, articles.relatedIds, articles.faq]) {
      assert.equal(col.notNull, true)
      assert.equal(col.hasDefault, true)
      assert.equal(col.default, '[]')
    }
    assert.equal(articles.friendLinks.name, 'friend_links')
    assert.equal(articles.relatedIds.name, 'related_ids')
  })

  it('createdAt 与 updatedAt 为 text 非空无默认值', () => {
    assert.equal(articles.createdAt.name, 'created_at')
    assert.equal(articles.createdAt.notNull, true)
    assert.equal(articles.createdAt.hasDefault, false)
    assert.equal(articles.updatedAt.name, 'updated_at')
    assert.equal(articles.updatedAt.notNull, true)
    assert.equal(articles.updatedAt.hasDefault, false)
  })

  it('共 17 个列', () => {
    assert.equal(Object.keys(getTableColumns(articles)).length, 17)
  })

  it('索引定义正确', () => {
    const indexes = getIndexInfo(articles)
    assert.equal(indexes.length, 2)
    assert.deepEqual(indexes[0], { name: 'idx_articles_category_status', columns: ['category', 'status'] })
    assert.deepEqual(indexes[1], { name: 'idx_articles_status_updated', columns: ['status', 'updated_at'] })
  })
})

// —— seeds 表 ——

describe('seeds 表 schema', () => {
  it('表名与表对象类型', () => {
    assert.equal(getTableName(seeds), 'seeds')
    assert.equal(isTable(seeds), true)
  })

  it('主键列 id 为 integer 自增非空', () => {
    const col = seeds.id
    assert.equal(col.name, 'id')
    assert.equal(col.dataType, 'number')
    assert.equal(col.notNull, true)
    assert.equal(col.primary, true)
    assert.equal(isAutoIncrement(col), true)
  })

  it('raw 为 text 非空无默认值', () => {
    const col = seeds.raw
    assert.equal(col.name, 'raw')
    assert.equal(col.dataType, 'string')
    assert.equal(col.notNull, true)
    assert.equal(col.hasDefault, false)
  })

  it('category 为 text 非空且默认 优惠', () => {
    const col = seeds.category
    assert.equal(col.name, 'category')
    assert.equal(col.notNull, true)
    assert.equal(col.hasDefault, true)
    assert.equal(col.default, '优惠')
  })

  it('template 为 text 非空且默认 deal', () => {
    const col = seeds.template
    assert.equal(col.name, 'template')
    assert.equal(col.notNull, true)
    assert.equal(col.hasDefault, true)
    assert.equal(col.default, 'deal')
  })

  it('status 为 text 非空且默认 pending', () => {
    const col = seeds.status
    assert.equal(col.name, 'status')
    assert.equal(col.notNull, true)
    assert.equal(col.hasDefault, true)
    assert.equal(col.default, 'pending')
  })

  it('publishAt 与 expiresAt 为 text 可空无默认值', () => {
    assert.equal(seeds.publishAt.name, 'publish_at')
    assert.equal(seeds.publishAt.notNull, false)
    assert.equal(seeds.expiresAt.name, 'expires_at')
    assert.equal(seeds.expiresAt.notNull, false)
  })

  it('articleId 与 error 为 text 可空无默认值', () => {
    assert.equal(seeds.articleId.name, 'article_id')
    assert.equal(seeds.articleId.notNull, false)
    assert.equal(seeds.articleId.hasDefault, false)
    assert.equal(seeds.error.name, 'error')
    assert.equal(seeds.error.notNull, false)
    assert.equal(seeds.error.hasDefault, false)
  })

  it('source 为 text 非空且默认 admin', () => {
    const col = seeds.source
    assert.equal(col.name, 'source')
    assert.equal(col.notNull, true)
    assert.equal(col.hasDefault, true)
    assert.equal(col.default, 'admin')
  })

  it('fp 为 text 非空且默认空字符串', () => {
    const col = seeds.fp
    assert.equal(col.name, 'fp')
    assert.equal(col.notNull, true)
    assert.equal(col.hasDefault, true)
    assert.equal(col.default, '')
  })

  it('createdAt 与 updatedAt 为 text 非空无默认值', () => {
    assert.equal(seeds.createdAt.name, 'created_at')
    assert.equal(seeds.createdAt.notNull, true)
    assert.equal(seeds.updatedAt.name, 'updated_at')
    assert.equal(seeds.updatedAt.notNull, true)
  })

  it('共 13 个列', () => {
    assert.equal(Object.keys(getTableColumns(seeds)).length, 13)
  })

  it('索引定义正确', () => {
    const indexes = getIndexInfo(seeds)
    assert.equal(indexes.length, 1)
    assert.deepEqual(indexes[0], { name: 'idx_seeds_status', columns: ['status'] })
  })
})

// —— runLogs 表 ——

describe('runLogs 表 schema', () => {
  it('表名 run_logs 与表对象类型', () => {
    assert.equal(getTableName(runLogs), 'run_logs')
    assert.equal(isTable(runLogs), true)
  })

  it('主键列 id 为 integer 自增非空', () => {
    const col = runLogs.id
    assert.equal(col.name, 'id')
    assert.equal(col.dataType, 'number')
    assert.equal(col.notNull, true)
    assert.equal(col.primary, true)
    assert.equal(isAutoIncrement(col), true)
  })

  it('runAt 为 text 非空无默认值，数据库列名 run_at', () => {
    const col = runLogs.runAt
    assert.equal(col.name, 'run_at')
    assert.equal(col.dataType, 'string')
    assert.equal(col.notNull, true)
    assert.equal(col.hasDefault, false)
  })

  it('model 为 text 非空且默认空字符串', () => {
    const col = runLogs.model
    assert.equal(col.name, 'model')
    assert.equal(col.notNull, true)
    assert.equal(col.hasDefault, true)
    assert.equal(col.default, '')
  })

  it('total / ok / fail 均为 integer 非空且默认 0', () => {
    for (const col of [runLogs.total, runLogs.ok, runLogs.fail]) {
      assert.equal(col.dataType, 'number')
      assert.equal(col.notNull, true)
      assert.equal(col.hasDefault, true)
      assert.equal(col.default, 0)
    }
  })

  it('error 为 text 可空无默认值', () => {
    const col = runLogs.error
    assert.equal(col.name, 'error')
    assert.equal(col.notNull, false)
    assert.equal(col.hasDefault, false)
  })

  it('dryRun 为 integer 非空且默认 0，数据库列名 dry_run', () => {
    const col = runLogs.dryRun
    assert.equal(col.name, 'dry_run')
    assert.equal(col.dataType, 'number')
    assert.equal(col.notNull, true)
    assert.equal(col.hasDefault, true)
    assert.equal(col.default, 0)
  })

  it('createdAt 为 text 非空无默认值，数据库列名 created_at', () => {
    const col = runLogs.createdAt
    assert.equal(col.name, 'created_at')
    assert.equal(col.notNull, true)
    assert.equal(col.hasDefault, false)
  })

  it('共 9 个列', () => {
    assert.equal(Object.keys(getTableColumns(runLogs)).length, 9)
  })

  it('索引定义正确', () => {
    const indexes = getIndexInfo(runLogs)
    assert.equal(indexes.length, 1)
    assert.deepEqual(indexes[0], { name: 'idx_run_logs_created', columns: ['created_at'] })
  })
})

// —— 跨表一致性 ——

describe('三张表 schema 一致性', () => {
  it('三张表互不相同', () => {
    const names = [getTableName(articles), getTableName(seeds), getTableName(runLogs)]
    assert.equal(new Set(names).size, 3)
  })

  it('所有表均为合法 drizzle 表对象', () => {
    assert.equal(isTable(articles), true)
    assert.equal(isTable(seeds), true)
    assert.equal(isTable(runLogs), true)
  })

  it('articles.id 为 text 主键，seeds/runLogs.id 为 integer 自增主键', () => {
    assert.equal(articles.id.dataType, 'string')
    assert.equal(isAutoIncrement(articles.id), false)
    assert.equal(seeds.id.dataType, 'number')
    assert.equal(isAutoIncrement(seeds.id), true)
    assert.equal(runLogs.id.dataType, 'number')
    assert.equal(isAutoIncrement(runLogs.id), true)
  })
})
