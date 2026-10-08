# ai-article-pipeline

AI 自动文章生成管线 — 从素材到发布的完整流程，支持任意数据库后端。

## 功能

- **AI 选题**：素材池不足时自动策划选题（贴合时令/节日），失败自动重试
- **AI 生成**：原始素材 → 结构化引流文（攻略/优惠/好物/副业）
- **内容安全**：关键词扫描，支持两种处理模式：
  - `replace`（默认）：替换违规词后仍发表
  - `draft`：标记为草稿待人工审核
- **URL 清洗**：自动过滤占位/虚构链接（example.com 等）
- **内容充实度**：块数/字数不足自动拒绝，不入库低质文
- **本地网关支持**：自动检测 localhost 网关，离线时云端兜底
- **防重复发布**：检查今日已有成功记录，避免并发双跑
- **JS/TS 兼容**：CommonJS 输出，`require()` / `import` 均可使用
- **数据库 Schema**：导出 Drizzle ORM 表定义，所有子站共用
- **定时调度**：基于 Cloudflare Durable Objects Alarms，每天固定时间触发，无需 cron triggers

---

## 安装

### 方式一：从 GitHub 安装（推荐）

```bash
# 直接从 GitHub 安装
npm install github:jdjdndn/auto-ai-article

# 或者指定版本/分支
npm install github:jdjdndn/auto-ai-article#main
```

### 方式二：克隆后本地使用

```bash
# 克隆仓库
git clone https://github.com/jdjdndn/auto-ai-article.git
cd auto-ai-article

# 安装依赖
npm install

# 构建
npm run build
```

### 方式三：vendor 引用（推荐，兼容 CI 部署）

各子站项目将库 dist 以 vendor 形式提交到自身 git 仓库，package.json 使用 `file:./vendor/ai-article-pipeline`。

**为何不用 `file:../../auto-ai-article`**：各站点是独立 git 仓库，Cloudflare Pages CI 克隆后仓库外路径不存在，`Cannot resolve "ai-article-pipeline"` 导致部署失败。

**工作原理**：

```
auto-ai-article/
  src/              ← 修改这里
  dist/             ← npm run build 产出
       ↓ npm run sync-vendor
子站项目/
  vendor/ai-article-pipeline/
    dist/           ← 提交到 git（CI 可用）
    package.json    ← type: commonjs
  node_modules/ai-article-pipeline → vendor/ai-article-pipeline（symlink）
```

**更新流程**：

```bash
# 1. 修改库源码
vim auto-ai-article/src/ai-fallback.ts

# 2. 编译 + 同步到所有消费项目（sync-vendor.cjs 中的 TARGETS 列表）
cd auto-ai-article && npm run sync-vendor

# 3. 各子站项目 git add vendor/ && git commit && git push（提交后 CI 部署生效）
```

**当前引用项目**（package.json 均为 `file:./vendor/ai-article-pipeline`）：

| 分类 | 项目 |
|------|------|
| 号卡 | 172, hm, yk, kd, hk, ksj, gc |
| 信用卡 | kahe, suishou, zhangshang |
| 随身wifi | chaoneng-wifi, feilimao-wifi, gexing-wifi, liantong-wifi |
| article-site | article-site |

---

## 快速开始

### 0. 定时调度（推荐方式）

使用 Cloudflare Durable Objects Alarms，每天固定时间触发，无需 cron triggers：

```typescript
// worker 入口文件
import { ArticleScheduler, startScheduler } from 'ai-article-pipeline'

// 导出 DO class（用户不用自己写）
export { ArticleScheduler }

export default {
  async fetch(request: Request, env: any) {
    // 启动调度器（每天 08:00 触发）
    const scheduler = startScheduler(env, { time: '08:00' })
    const result = await scheduler.start()

    return Response.json({ ok: true, ...result })
  },
}
```

**wrangler.jsonc 配置**：

```json
{
  "durable_objects": {
    "bindings": [
      { "name": "ARTICLE_SCHEDULER", "class_name": "ArticleScheduler" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_classes": ["ArticleScheduler"] }
  ]
}
```

**首次部署后调用一次启动**：

```bash
curl -X POST https://your-domain.com/api/cron
# 返回: { "ok": true, "scheduled": "2026-10-01T08:00:00.000Z" }
```

之后每天 08:00 自动触发，无需任何外部服务。

---

### 1. 基础用法：createPipeline

```javascript
const { createPipeline } = require('ai-article-pipeline')

// 实现 PipelineDB 接口（你的数据库操作）
const myDB = {
  async fetchPendingSeeds(size) { return [] },
  async insertSeeds(items, source) { return { added: items.length } },
  async markSeedDone(id, articleId) {},
  async markSeedFailed(id, error) {},
  async insertArticles(articles) {
    return { total: articles.length, created: articles.length, failed: 0, results: [] }
  },
  async insertRunLog(log) {},
}

const pipeline = createPipeline(myDB, {
  target: 3,                        // 每轮目标篇数
  ai: {
    apiKey: process.env.AI_API_KEY,
    model: 'gpt-4o-mini',
  },
  safetyAction: 'replace',          // 'draft' 或 'replace'
})

const result = await pipeline.run()
console.log(`成功 ${result.ok} 篇，失败 ${result.fail} 篇`)
```

### 2. 执行器：完整流程编排

执行器封装了每日生成的完整流程：配额检查 → 防重复 → 本地网关检测 → 云端兜底 → 运行日志。

```javascript
const { execute } = require('ai-article-pipeline')

const result = await execute(myDB, {
  dailyTarget: 3,
  localGateway: 'http://localhost:3456/v1',   // 本地 AI 网关
  localModel: 'deepseek-chat',
  cloudModel: '@cf/qwen/qwen3-30b-a3b-fp8',  // 云端兜底模型
  ai: { apiKey: 'your-key', model: 'gpt-4o-mini' },
  getPublishedToday: async () => { /* 查今日已发布数 */ },
  hasLocalRunToday: async () => { /* 查今日是否有本地成功记录 */ },
  reportRun: async (log) => { /* 上报运行日志 */ },
})
// result.mode: 'local' | 'cloud' | 'skipped'
```

### 3. 导入数据库 Schema

库导出 Drizzle ORM 的 SQLite 表定义，所有子站共用同一套 Schema：

```typescript
import { articles, seeds, runLogs } from 'ai-article-pipeline'
import type { ArticleRow, SeedRow, RunLogRow } from 'ai-article-pipeline'

// 在你的 schema.ts 中重新导出
export { articles, seeds, runLogs }
export type { ArticleRow as Article, SeedRow as Seed, RunLogRow as RunLog }
```

**导出的表**：

| 表名 | 用途 | 主键 |
| ------ | ------ | ------ |
| `articles` | 文章表 | `id` (text) |
| `seeds` | 素材池 | `id` (integer, 自增) |
| `runLogs` | 运行日志 | `id` (integer, 自增) |

**articles 表字段**：

| 字段 | 类型 | 说明 |
| ------ | ------ | ------ |
| id | text | 主键，格式 `a-YYYYMMDD-XXXXXXXX` |
| title | text | 标题（必填） |
| summary | text | 摘要 |
| content | text | 内容块 JSON 数组 |
| firstImage | text | 首图 URL |
| template | text | 模板：guide/faq/default/deal |
| category | text | 分类：优惠/攻略/好物/副业 |
| tags | text | 标签 JSON 数组 |
| status | text | 状态：published/draft |
| publishAt | text | 发布时间 |
| expiresAt | text | 过期时间 |
| links | text | 链接 JSON 数组 |
| friendLinks | text | 友链 JSON 数组 |
| relatedIds | text | 相关文章 ID |
| faq | text | FAQ JSON 数组 |
| createdAt | text | 创建时间 |
| updatedAt | text | 更新时间 |

**seeds 表字段**：

| 字段 | 类型 | 说明 |
| ------ | ------ | ------ |
| id | integer | 主键，自增 |
| raw | text | 原始素材内容（必填） |
| category | text | 分类（默认"优惠"） |
| template | text | 模板（默认"deal"） |
| status | text | 状态：pending/done/failed |
| publishAt | text | 定时发布时间 |
| expiresAt | text | 过期时间 |
| articleId | text | 关联的文章 ID |
| error | text | 失败原因 |
| source | text | 来源：admin/user/ai |
| fp | text | 去重指纹 |
| createdAt | text | 创建时间 |
| updatedAt | text | 更新时间 |

**runLogs 表字段**：

| 字段 | 类型 | 说明 |
| ------ | ------ | ------ |
| id | integer | 主键，自增 |
| runAt | text | 运行时间 |
| model | text | 使用的模型 |
| total | integer | 总数 |
| ok | integer | 成功数 |
| fail | integer | 失败数 |
| error | text | 错误信息 |
| dryRun | integer | 是否 dry-run（0/1） |
| createdAt | text | 创建时间 |

---

## CLI

```bash
# dry-run 模式（只生成不入库）
npx ai-article-pipeline --dry-run

# 使用本地网关
npx ai-article-pipeline --gateway=http://localhost:3456/v1 --model=kimi

# 使用云端 API
npx ai-article-pipeline --api-key=sk-xxx --ai-model=gpt-4o-mini
```

---

## 配置选项

```typescript
createPipeline(myDB, {
  target: 3,                    // 每轮目标篇数（默认 3）
  safetyAction: 'replace',      // 'draft'=标草稿, 'replace'=替换违规词
  suggestRetries: 1,            // AI 选题失败重试次数（默认 1）
  sanitizeUrls: true,           // 清洗占位 URL（默认 true）
  ai: {
    client,                     // 自定义 AI 客户端函数
    baseUrl,                    // OpenAI 兼容 API 地址
    apiKey,                     // API Key
    model,                      // 模型名称（默认 gpt-4o-mini）
    maxTokens,                  // 最大 token 数（默认 4096）
  },
  systemPrompt: '...',          // 自定义系统提示词（覆盖默认）
  suggestPrompt: '...',         // 自定义选题提示词（覆盖默认）
  extraSafetyRules: [...],      // 追加安全规则
})
```

**执行器额外配置**：

```typescript
execute(myDB, {
  // ...PipelineConfig 所有选项
  dailyTarget: 3,               // 每日目标篇数
  localGateway: 'http://localhost:3456/v1',  // 本地网关地址
  localModel: 'deepseek-chat',  // 本地模型名称
  cloudModel: '...',            // 云端模型（离线时兜底）
  dryRun: false,                // dry-run 模式
  getPublishedToday,            // 查询今日已发布数
  hasLocalRunToday,             // 查询今日是否有本地记录
  reportRun,                    // 运行日志上报函数
})
```

---

## PipelineDB 接口

使用 `createPipeline` 或 `execute` 时，需要实现 `PipelineDB` 接口：

```typescript
interface PipelineDB {
  /** 拉取待处理素材 */
  fetchPendingSeeds(size: number): Promise<Seed[]>
  /** 插入素材 */
  insertSeeds(items: SeedInput[], source: string): Promise<{ added: number }>
  /** 标记素材完成 */
  markSeedDone(id: number, articleId: string): Promise<void>
  /** 标记素材失败 */
  markSeedFailed(id: number, error: string): Promise<void>
  /** 批量插入文章 */
  insertArticles(articles: GeneratedArticle[]): Promise<InsertResult>
  /** 记录运行日志 */
  insertRunLog(log: RunLogInput): Promise<void>
}
```

**使用 Drizzle ORM 实现示例**：

```typescript
import { eq, desc } from 'drizzle-orm'
import { articles, seeds, runLogs } from 'ai-article-pipeline'

function createPipelineDB(db: any) {
  return {
    async fetchPendingSeeds(size: number) {
      return db.select().from(seeds)
        .where(eq(seeds.status, 'pending'))
        .orderBy(desc(seeds.id))
        .limit(size)
    },
    async insertSeeds(items, source) {
      const rows = items.filter(it => it.raw?.length >= 8)
      if (!rows.length) return { added: 0 }
      await db.insert(seeds).values(rows.map(it => ({
        ...it, status: 'pending', source,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })))
      return { added: rows.length }
    },
    async markSeedDone(id, articleId) {
      await db.update(seeds).set({
        status: 'done', articleId, error: null,
        updatedAt: new Date().toISOString(),
      }).where(eq(seeds.id, id))
    },
    async markSeedFailed(id, error) {
      await db.update(seeds).set({
        status: 'failed', error: String(error).slice(0, 500),
        updatedAt: new Date().toISOString(),
      }).where(eq(seeds.id, id))
    },
    async insertArticles(articlesList) {
      const results = []
      for (const a of articlesList) {
        try {
          const id = `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          await db.insert(articles).values({ id, ...a })
          results.push({ id, ok: true })
        } catch (e) {
          results.push({ id: '', ok: false, error: e.message })
        }
      }
      return {
        total: articlesList.length,
        created: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length,
        results,
      }
    },
    async insertRunLog(log) {
      await db.insert(runLogs).values({
        ...log, createdAt: new Date().toISOString(),
      })
    },
  }
}
```

---

## 单独使用子模块

```javascript
const {
  // 内容安全
  checkArticleSafety,     // 内容安全检查
  replaceViolatingWords,  // 替换违规词
  scanText,               // 文本扫描

  // 提示词
  aiSystemPrompt,         // 系统提示词
  aiSuggestPrompt,        // 选题提示词
  dateContext,            // 时间背景

  // 工具函数
  extractJson,            // JSON 提取
  safeJson,               // 安全 JSON 解析
  normalizeJson,          // JSON 标准化
  firstImageOf,           // 提取首图
} = require('ai-article-pipeline')
```

---

## 类型导出（TypeScript）

```typescript
import type {
  // 数据
  Seed,
  SeedInput,
  GeneratedArticle,
  ContentBlock,
  FaqItem,
  LinkItem,

  // 入库
  InsertResult,
  InsertResultItem,

  // 内容安全
  SafetyHit,
  SafetyResult,
  SafetyRule,

  // AI
  AiMessage,
  AiClient,
  AiConfig,

  // 管线
  PipelineConfig,
  PipelineRunResult,
  PipelineDB,
  TopicSuggestion,

  // 运行日志
  RunLogInput,

  // 执行器
  ExecutorConfig,
  ExecutorResult,

  // Schema（Drizzle 表类型）
  ArticleRow,
  SeedRow,
  RunLogRow,
} from 'ai-article-pipeline'
```

---

## 提示词定制

默认提示词针对通用引流文优化。如需行业定制，通过配置覆盖：

```javascript
const pipeline = createPipeline(myDB, {
  systemPrompt: `你是号卡行业内容编辑...`,     // 覆盖系统提示词
  suggestPrompt: `你是号卡行业选题策划...`,     // 覆盖选题提示词
})
```

**默认提示词导出**（可参考修改）：

```javascript
import { aiSystemPrompt, aiSuggestPrompt, dateContext } from 'ai-article-pipeline'

// 查看当前提示词
console.log(aiSystemPrompt())
console.log(aiSuggestPrompt())
console.log(dateContext())
```

---

## 内容块类型

AI 生成的文章内容由多种块类型组成：

| 类型 | 说明 | 字段 |
| ------ | ------ | ------ |
| `text` | 段落文本 | `text` |
| `h2` | 小标题 | `text` |
| `list` | 要点列表 | `items: string[]` |
| `quote` | 提示框 | `text`, `tone: "warn" \| "info"` |
| `ad` | 软文块 | `label`, `text`, `link?` |
| `price` | 价格卡 | 自定义字段 |
| `image` | 图片 | `url`, `alt?`, `caption?` |
| `video` | 视频 | `url`, `title?` |

---

## 云浏览器集成

如需使用云浏览器（Browserless/Browserbase 等），可通过自定义 AI 客户端实现：

```javascript
const pipeline = createPipeline(myDB, {
  ai: {
    client: async (messages) => {
      // 自定义 AI 调用逻辑
      const response = await callYourAI(messages)
      return response
    },
  },
})
```

---

## 故障排查

### AI 选题失败

```
错误：AI 选题返回空数组
原因：模型输出格式不符合预期
解决：检查模型是否支持 JSON 输出，或调整 suggestPrompt
```

### 内容过短被拒绝

```
错误：AI 内容过短（2 块 / 150 字），请重试
原因：AI 生成的内容块数或字数不足
解决：调整 systemPrompt 中的内容充实度要求，或增加 maxTokens
```

### 命中内容安全规则

```
状态：文章被标记为 draft
原因：内容包含违规词
解决：检查 extraSafetyRules，或修改 safetyAction 为 'replace'
```

### 占位 URL 被清洗

```
现象：links 数组为空
原因：原始链接被识别为占位 URL（example.com 等）
解决：使用真实链接，或设置 sanitizeUrls: false
```

---

## 许可证

MIT
