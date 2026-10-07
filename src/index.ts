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
} from './types.js'

// 提示词
export { dateContext, aiSystemPrompt, aiSuggestPrompt } from './prompts.js'

// 数据库 Schema
export { articles, seeds, runLogs } from './schema.js'
export type { ArticleRow, SeedRow, RunLogRow } from './schema.js'

// 工具函数
export { extractJson, safeJson, normalizeJson, firstImageOf, firstNonEmpty, asAnyArray, normalizeContentBlocks, escapeHtml, renderArticleBlocks, renderArticleCta, generateToc, readingTime, articleCss, renderArticleLinks, renderFaqSection, renderShareBar, flattenToStrings, flattenFaq, flattenLinks, safeArticle } from './utils.js'

// 素材采集
export { fetchRssFeed, extractArticleText, textSimilarity, normalizeText } from './sources.js'
export type { RssItem } from './sources.js'

// 内容安全
export { scanText, checkArticleSafety, replaceViolatingWords } from './content-safety.js'

// 管线
export { createPipeline } from './pipeline.js'
export type { Pipeline, PipelineDB } from './pipeline.js'

// 执行器
export { execute } from './executor.js'
export type { ExecutorConfig, ExecutorResult } from './executor.js'

// 定时调度器（Cloudflare Durable Objects Alarms）
export { ArticleScheduler, startScheduler } from './scheduler.js'
export type { SchedulerConfig } from './scheduler.js'

// AI 模型降级库（Cloudflare Workers AI 免费模型故障自动切换）
export { createFallbackClient, createCloudflareAiClient, createAiClient, createOpenRouterClient, getRecommendedModels, FREE_TEXT_MODELS, OPENROUTER_FREE_MODELS, resetQuotaState, getQuotaExhaustedModels, extractResponse } from './ai-fallback.js'
export type { AiModel, FallbackConfig, FallbackResult, FallbackReason, UnifiedAiConfig } from './ai-fallback.js'
