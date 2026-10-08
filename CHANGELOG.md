# Changelog

本文件记录 ai-article-pipeline 的版本变更。

## [0.2.0] — 2026-10-09

### 新增
- **AI fallback 策略模式+责任链**：`AiProvider` 接口、`FallbackChain`（prepend/append/run）、`CfBindingProvider`、`OpenRouterProvider`、`LocalAiProvider`、`createFallbackChain`、`createBindingFallbackClient`
- **AI 配置唯一事实源** `ai-config.ts`：`FALLBACK_PROVIDERS`、`SITE_DEFAULT_MODELS`、`getSiteDefaultModel`
- **OpenRouter 免费模型链兜底**：CF 额度用尽自动切换 10 个免费模型
- **文章质量评分** `article-quality.ts`：信息密度/套话密度/结构完整性/原创性四维评分门控
- **搜索词采集** `search-terms.ts`：Google Search Console API + 注入选题
- **统计聚合** `stats.ts`：成功率/失败分布/平台稳定性/每日趋势
- **定时调度器** `scheduler.ts`：Cloudflare Durable Objects Alarms
- **统一调度入口** `runner.ts`：本地发文/线上发文/线上兜底触发式一体封装
- **文章周边组件**：`renderArticleLinks`、`renderFaqSection`、`renderShareBar`、`initArticleActions`
- **JSON-LD 生成**：`articleJsonLd`、`organizationJsonLd`、`websiteJsonLd`、`productJsonLd`、`faqJsonLd`
- **CLI 入口** `cli.ts`：手动触发 AI 文章生成

### 优化
- **Nuxt build 优化**：关闭 devtools + sourcemap，单站 build 从 ~100s 降到 ~14s
- **classifyError**：rate_limit 优先级提升
- **pipeline**：复用 ai-fallback OpenAI 客户端
- **concurrency**：可配置并发生成篇数
- **applySafety**：覆盖 list items 违规词替换
- **replaceViolatingWords**：加豁免词检查，反诈提醒不再被误替换
- **renderBlock**：过滤 example.com 占位图/ad 链接

### 修复
- **pipeline.ts**：OpenRouter apiKey 非空断言改为显式校验 + throw
- **scheduler.ts**：getNextAlarmTime 时区 UTC+8 修正
- **insertArticles**：自动写 firstImage
- **package.json**：补全 exports 子路径（article-quality/search-terms/stats）+ import 条件 + publishConfig
- **index.ts**：补导出 `BindingFallbackConfig`、`BadModelStore`、`fromRunLogInput`
- **stats.ts**：新增 `fromRunLogInput` 转换层，桥接 `RunLogInput` → `RunLogEntry`

### 测试
- **ai-fallback 单测**：116 个测试，行覆盖率 99.64%，分支覆盖率 94.02%
- 全套件 158 tests pass

## [0.1.0] — 2026-09-28

### 初始版本
- 核心管线：素材采集 → AI 选题 → AI 生成 → 安全审核 → 入库发布
- AI 模型降级库：CF Workers AI 免费模型故障自动切换
- 内容安全：违规词扫描 + 自动替换
- Drizzle ORM Schema：articles / seeds / runLogs
- 工具函数：JSON 解析 / HTML 渲染 / JSON-LD / TOC / 相关文章计算
