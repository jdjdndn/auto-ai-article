# ai-article-pipeline

AI 自动文章生成管线 — 从素材到发布的完整流程，支持任意数据库后端。

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

## 快速开始

```javascript
const { createPipeline } = require('ai-article-pipeline')

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
  target: 3,
  ai: { apiKey: process.env.AI_API_KEY, model: 'gpt-4o-mini' },
  safetyAction: 'replace',
})

const result = await pipeline.run()
```

## 执行器（完整流程编排）

执行器封装了每日生成的完整流程：配额检查 → 防重复 → 本地网关检测 → 云端兜底 → 运行日志。

```javascript
const { execute } = require('ai-article-pipeline')

const result = await execute(myDB, {
  dailyTarget: 3,
  localGateway: 'http://localhost:3456/v1',
  localModel: 'deepseek-chat',
  getPublishedToday: async () => { /* 查今日已发布数 */ },
  hasLocalRunToday: async () => { /* 查今日是否有本地成功记录 */ },
  reportRun: async (log) => { /* 上报运行日志 */ },
  ai: { apiKey: 'your-key', model: 'gpt-4o-mini' },
})
// result.mode: 'local' | 'cloud' | 'skipped'
```

## CLI

```bash
# dry-run 模式
npx ai-article-pipeline --dry-run

# 使用本地网关
npx ai-article-pipeline --gateway=http://localhost:3456/v1 --model=kimi

# 使用云端 API
npx ai-article-pipeline --api-key=sk-xxx --ai-model=gpt-4o-mini
```

## 配置选项

```javascript
createPipeline(myDB, {
  target: 3,                    // 每轮目标篇数
  safetyAction: 'replace',      // 'draft'=标草稿, 'replace'=替换违规词
  suggestRetries: 1,            // AI 选题失败重试次数
  sanitizeUrls: true,           // 清洗占位 URL
  ai: { apiKey, model, baseUrl, client },
  systemPrompt: '...',          // 自定义系统提示词
  suggestPrompt: '...',         // 自定义选题提示词
  extraSafetyRules: [...],      // 追加安全规则
})
```

## 单独使用子模块

```javascript
const {
  checkArticleSafety,     // 内容安全检查
  replaceViolatingWords,  // 替换违规词
  extractJson,            // JSON 提取
  scanText,               // 文本扫描
  aiSystemPrompt,         // 系统提示词
  aiSuggestPrompt,        // 选题提示词
  dateContext,            // 时间背景
} = require('ai-article-pipeline')
```

## 类型导出（TypeScript）

```typescript
import type {
  Seed, SeedInput, GeneratedArticle, ContentBlock,
  PipelineDB, PipelineConfig, InsertResult,
  ExecutorConfig, ExecutorResult,
  SafetyRule, AiClient,
} from 'ai-article-pipeline'
```

## 许可证

MIT
