// ============================================================
// ai-article-pipeline — 统一导出
// ============================================================

// 类型
export type {
  Seed,
  SeedInput,
  GeneratedArticle,
  ContentBlock,
  FaqItem,
  LinkItem,
  InsertResult,
  InsertResultItem,
  SafetyHit,
  SafetyResult,
  SafetyRule,
  AiMessage,
  AiClient,
  AiConfig,
  PipelineConfig,
  PipelineRunResult,
  TopicSuggestion,
  RunLogInput,
  CtaConfig,
  Logger,
} from './types.js'

// 提示词
export { dateContext, aiSystemPrompt, aiSuggestPrompt } from './prompts.js'

// 数据库 Schema
export { articles, seeds, runLogs } from './schema.js'
export type { ArticleRow, SeedRow, RunLogRow } from './schema.js'

// 工具函数
export {
  extractJson,
  safeJson,
  normalizeJson,
  firstImageOf,
  firstNonEmpty,
  asAnyArray,
  normalizeContentBlocks,
  escapeHtml,
  renderArticleBlocks,
  renderArticleCta,
  generateToc,
  readingTime,
  articleCss,
  renderArticleLinks,
  renderRelatedArticles,
  renderFaqSection,
  renderShareBar,
  articleJsonLd,
  organizationJsonLd,
  websiteJsonLd,
  productJsonLd,
  faqJsonLd,
  initArticleActions,
  flattenToStrings,
  flattenFaq,
  flattenLinks,
  safeArticle,
  cnTodayStartISO,
} from './utils.js'

// 素材采集
export { fetchRssFeed, extractArticleText, textSimilarity, normalizeText } from './sources.js'
export type { RssItem } from './sources.js'

// 内容安全
export { scanText, checkArticleSafety, replaceViolatingWords } from './content-safety.js'

// 管线
export { createPipeline, withRetry } from './pipeline.js'
export type { Pipeline, PipelineDB, SleepFn } from './pipeline.js'

// 执行器
export { execute } from './executor.js'
export type { ExecutorConfig, ExecutorResult } from './executor.js'

// 统一调度入口（本地发文 / 线上发文 / 线上兜底触发式一体封装）
export { runScheduledGenerate } from './runner.js'
export type { SiteRunnerConfig, SiteRunnerResult } from './runner.js'

// 相关文章计算（相似 + 互补混合评分，公共能力）
export { computeRelatedArticles } from './related.js'
export type { RelatedCandidate, RelatedOptions } from './related.js'

// 定时调度器（Cloudflare Durable Objects Alarms）
export {
  ArticleScheduler,
  startScheduler,
  getNextAlarmTime,
  initDoAlarm,
  rescheduleDoAlarm,
  applyWorkerEnv,
  createDailyAlarmPlugin,
  createScheduledPlugin,
} from './scheduler.js'
export type { SchedulerConfig, DailyAlarmPluginOptions, ScheduledPluginOptions } from './scheduler.js'

// AI 模型降级库（Cloudflare Workers AI 免费模型故障自动切换）
export {
  createFallbackClient,
  createCloudflareAiClient,
  createAiClient,
  createBindingFallbackClient,
  createFallbackChain,
  type AiProvider,
  FallbackChain,
  CfBindingProvider,
  OpenRouterProvider,
  LocalAiProvider,
  createOpenRouterClient,
  getRecommendedModels,
  FREE_TEXT_MODELS,
  OPENROUTER_FREE_MODELS,
  resetQuotaState,
  getQuotaExhaustedModels,
  extractResponse,
} from './ai-fallback.js'
export type { AiModel, FallbackConfig, FallbackResult, FallbackReason, UnifiedAiConfig } from './ai-fallback.js'

// AI 配置唯一事实源（模型链 / 备用提供方 / 站点默认模型）
export { FALLBACK_PROVIDERS, SITE_DEFAULT_MODELS, getSiteDefaultModel } from './ai-config.js'
export type { FallbackProvider } from './ai-config.js'

// 文章质量评分（信息密度/套话密度/结构完整性/原创性）
export { scoreArticle } from './article-quality.js'
export type { QualityScore, QualityOptions } from './article-quality.js'

// 搜索词采集（Google Search Console API + 注入选题）
export { fetchSearchConsoleTerms, injectSearchTerms } from './search-terms.js'
export type { SearchTerm, SearchTermsOptions } from './search-terms.js'

// 生成统计聚合（成功率/失败分布/平台稳定性/每日趋势）
export { aggregateStats, renderStatsMarkdown } from './stats.js'
export type { RunLogEntry, StatSummary } from './stats.js'
