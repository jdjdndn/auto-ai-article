"use strict";
// ============================================================
// ai-article-pipeline — 统一导出
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDoAlarm = exports.getNextAlarmTime = exports.startScheduler = exports.ArticleScheduler = exports.computeRelatedArticles = exports.runScheduledGenerate = exports.execute = exports.withRetry = exports.createPipeline = exports.replaceViolatingWords = exports.checkArticleSafety = exports.scanText = exports.normalizeText = exports.textSimilarity = exports.extractArticleText = exports.fetchRssFeed = exports.cnTodayStartISO = exports.safeArticle = exports.flattenLinks = exports.flattenFaq = exports.flattenToStrings = exports.initArticleActions = exports.faqJsonLd = exports.productJsonLd = exports.websiteJsonLd = exports.organizationJsonLd = exports.articleJsonLd = exports.renderShareBar = exports.renderFaqSection = exports.renderRelatedArticles = exports.renderArticleLinks = exports.articleCss = exports.readingTime = exports.generateToc = exports.renderArticleCta = exports.renderArticleBlocks = exports.escapeHtml = exports.normalizeContentBlocks = exports.asAnyArray = exports.firstNonEmpty = exports.firstImageOf = exports.normalizeJson = exports.safeJson = exports.extractJson = exports.runLogs = exports.seeds = exports.articles = exports.aiSuggestPrompt = exports.aiSystemPrompt = exports.dateContext = void 0;
exports.renderStatsMarkdown = exports.aggregateStats = exports.injectSearchTerms = exports.fetchSearchConsoleTerms = exports.scoreArticle = exports.getSiteDefaultModel = exports.SITE_DEFAULT_MODELS = exports.FALLBACK_PROVIDERS = exports.extractResponse = exports.getQuotaExhaustedModels = exports.resetQuotaState = exports.OPENROUTER_FREE_MODELS = exports.FREE_TEXT_MODELS = exports.getRecommendedModels = exports.createOpenRouterClient = exports.OpenRouterProvider = exports.CfBindingProvider = exports.FallbackChain = exports.createBindingFallbackClient = exports.createAiClient = exports.createCloudflareAiClient = exports.createFallbackClient = exports.createScheduledPlugin = exports.createDailyAlarmPlugin = exports.applyWorkerEnv = exports.rescheduleDoAlarm = void 0;
// 提示词
var prompts_js_1 = require("./prompts.js");
Object.defineProperty(exports, "dateContext", { enumerable: true, get: function () { return prompts_js_1.dateContext; } });
Object.defineProperty(exports, "aiSystemPrompt", { enumerable: true, get: function () { return prompts_js_1.aiSystemPrompt; } });
Object.defineProperty(exports, "aiSuggestPrompt", { enumerable: true, get: function () { return prompts_js_1.aiSuggestPrompt; } });
// 数据库 Schema
var schema_js_1 = require("./schema.js");
Object.defineProperty(exports, "articles", { enumerable: true, get: function () { return schema_js_1.articles; } });
Object.defineProperty(exports, "seeds", { enumerable: true, get: function () { return schema_js_1.seeds; } });
Object.defineProperty(exports, "runLogs", { enumerable: true, get: function () { return schema_js_1.runLogs; } });
// 工具函数
var utils_js_1 = require("./utils.js");
Object.defineProperty(exports, "extractJson", { enumerable: true, get: function () { return utils_js_1.extractJson; } });
Object.defineProperty(exports, "safeJson", { enumerable: true, get: function () { return utils_js_1.safeJson; } });
Object.defineProperty(exports, "normalizeJson", { enumerable: true, get: function () { return utils_js_1.normalizeJson; } });
Object.defineProperty(exports, "firstImageOf", { enumerable: true, get: function () { return utils_js_1.firstImageOf; } });
Object.defineProperty(exports, "firstNonEmpty", { enumerable: true, get: function () { return utils_js_1.firstNonEmpty; } });
Object.defineProperty(exports, "asAnyArray", { enumerable: true, get: function () { return utils_js_1.asAnyArray; } });
Object.defineProperty(exports, "normalizeContentBlocks", { enumerable: true, get: function () { return utils_js_1.normalizeContentBlocks; } });
Object.defineProperty(exports, "escapeHtml", { enumerable: true, get: function () { return utils_js_1.escapeHtml; } });
Object.defineProperty(exports, "renderArticleBlocks", { enumerable: true, get: function () { return utils_js_1.renderArticleBlocks; } });
Object.defineProperty(exports, "renderArticleCta", { enumerable: true, get: function () { return utils_js_1.renderArticleCta; } });
Object.defineProperty(exports, "generateToc", { enumerable: true, get: function () { return utils_js_1.generateToc; } });
Object.defineProperty(exports, "readingTime", { enumerable: true, get: function () { return utils_js_1.readingTime; } });
Object.defineProperty(exports, "articleCss", { enumerable: true, get: function () { return utils_js_1.articleCss; } });
Object.defineProperty(exports, "renderArticleLinks", { enumerable: true, get: function () { return utils_js_1.renderArticleLinks; } });
Object.defineProperty(exports, "renderRelatedArticles", { enumerable: true, get: function () { return utils_js_1.renderRelatedArticles; } });
Object.defineProperty(exports, "renderFaqSection", { enumerable: true, get: function () { return utils_js_1.renderFaqSection; } });
Object.defineProperty(exports, "renderShareBar", { enumerable: true, get: function () { return utils_js_1.renderShareBar; } });
Object.defineProperty(exports, "articleJsonLd", { enumerable: true, get: function () { return utils_js_1.articleJsonLd; } });
Object.defineProperty(exports, "organizationJsonLd", { enumerable: true, get: function () { return utils_js_1.organizationJsonLd; } });
Object.defineProperty(exports, "websiteJsonLd", { enumerable: true, get: function () { return utils_js_1.websiteJsonLd; } });
Object.defineProperty(exports, "productJsonLd", { enumerable: true, get: function () { return utils_js_1.productJsonLd; } });
Object.defineProperty(exports, "faqJsonLd", { enumerable: true, get: function () { return utils_js_1.faqJsonLd; } });
Object.defineProperty(exports, "initArticleActions", { enumerable: true, get: function () { return utils_js_1.initArticleActions; } });
Object.defineProperty(exports, "flattenToStrings", { enumerable: true, get: function () { return utils_js_1.flattenToStrings; } });
Object.defineProperty(exports, "flattenFaq", { enumerable: true, get: function () { return utils_js_1.flattenFaq; } });
Object.defineProperty(exports, "flattenLinks", { enumerable: true, get: function () { return utils_js_1.flattenLinks; } });
Object.defineProperty(exports, "safeArticle", { enumerable: true, get: function () { return utils_js_1.safeArticle; } });
Object.defineProperty(exports, "cnTodayStartISO", { enumerable: true, get: function () { return utils_js_1.cnTodayStartISO; } });
// 素材采集
var sources_js_1 = require("./sources.js");
Object.defineProperty(exports, "fetchRssFeed", { enumerable: true, get: function () { return sources_js_1.fetchRssFeed; } });
Object.defineProperty(exports, "extractArticleText", { enumerable: true, get: function () { return sources_js_1.extractArticleText; } });
Object.defineProperty(exports, "textSimilarity", { enumerable: true, get: function () { return sources_js_1.textSimilarity; } });
Object.defineProperty(exports, "normalizeText", { enumerable: true, get: function () { return sources_js_1.normalizeText; } });
// 内容安全
var content_safety_js_1 = require("./content-safety.js");
Object.defineProperty(exports, "scanText", { enumerable: true, get: function () { return content_safety_js_1.scanText; } });
Object.defineProperty(exports, "checkArticleSafety", { enumerable: true, get: function () { return content_safety_js_1.checkArticleSafety; } });
Object.defineProperty(exports, "replaceViolatingWords", { enumerable: true, get: function () { return content_safety_js_1.replaceViolatingWords; } });
// 管线
var pipeline_js_1 = require("./pipeline.js");
Object.defineProperty(exports, "createPipeline", { enumerable: true, get: function () { return pipeline_js_1.createPipeline; } });
Object.defineProperty(exports, "withRetry", { enumerable: true, get: function () { return pipeline_js_1.withRetry; } });
// 执行器
var executor_js_1 = require("./executor.js");
Object.defineProperty(exports, "execute", { enumerable: true, get: function () { return executor_js_1.execute; } });
// 统一调度入口（本地发文 / 线上发文 / 线上兜底触发式一体封装）
var runner_js_1 = require("./runner.js");
Object.defineProperty(exports, "runScheduledGenerate", { enumerable: true, get: function () { return runner_js_1.runScheduledGenerate; } });
// 相关文章计算（相似 + 互补混合评分，公共能力）
var related_js_1 = require("./related.js");
Object.defineProperty(exports, "computeRelatedArticles", { enumerable: true, get: function () { return related_js_1.computeRelatedArticles; } });
// 定时调度器（Cloudflare Durable Objects Alarms）
var scheduler_js_1 = require("./scheduler.js");
Object.defineProperty(exports, "ArticleScheduler", { enumerable: true, get: function () { return scheduler_js_1.ArticleScheduler; } });
Object.defineProperty(exports, "startScheduler", { enumerable: true, get: function () { return scheduler_js_1.startScheduler; } });
Object.defineProperty(exports, "getNextAlarmTime", { enumerable: true, get: function () { return scheduler_js_1.getNextAlarmTime; } });
Object.defineProperty(exports, "initDoAlarm", { enumerable: true, get: function () { return scheduler_js_1.initDoAlarm; } });
Object.defineProperty(exports, "rescheduleDoAlarm", { enumerable: true, get: function () { return scheduler_js_1.rescheduleDoAlarm; } });
Object.defineProperty(exports, "applyWorkerEnv", { enumerable: true, get: function () { return scheduler_js_1.applyWorkerEnv; } });
Object.defineProperty(exports, "createDailyAlarmPlugin", { enumerable: true, get: function () { return scheduler_js_1.createDailyAlarmPlugin; } });
Object.defineProperty(exports, "createScheduledPlugin", { enumerable: true, get: function () { return scheduler_js_1.createScheduledPlugin; } });
// AI 模型降级库（Cloudflare Workers AI 免费模型故障自动切换）
var ai_fallback_js_1 = require("./ai-fallback.js");
Object.defineProperty(exports, "createFallbackClient", { enumerable: true, get: function () { return ai_fallback_js_1.createFallbackClient; } });
Object.defineProperty(exports, "createCloudflareAiClient", { enumerable: true, get: function () { return ai_fallback_js_1.createCloudflareAiClient; } });
Object.defineProperty(exports, "createAiClient", { enumerable: true, get: function () { return ai_fallback_js_1.createAiClient; } });
Object.defineProperty(exports, "createBindingFallbackClient", { enumerable: true, get: function () { return ai_fallback_js_1.createBindingFallbackClient; } });
Object.defineProperty(exports, "FallbackChain", { enumerable: true, get: function () { return ai_fallback_js_1.FallbackChain; } });
Object.defineProperty(exports, "CfBindingProvider", { enumerable: true, get: function () { return ai_fallback_js_1.CfBindingProvider; } });
Object.defineProperty(exports, "OpenRouterProvider", { enumerable: true, get: function () { return ai_fallback_js_1.OpenRouterProvider; } });
Object.defineProperty(exports, "createOpenRouterClient", { enumerable: true, get: function () { return ai_fallback_js_1.createOpenRouterClient; } });
Object.defineProperty(exports, "getRecommendedModels", { enumerable: true, get: function () { return ai_fallback_js_1.getRecommendedModels; } });
Object.defineProperty(exports, "FREE_TEXT_MODELS", { enumerable: true, get: function () { return ai_fallback_js_1.FREE_TEXT_MODELS; } });
Object.defineProperty(exports, "OPENROUTER_FREE_MODELS", { enumerable: true, get: function () { return ai_fallback_js_1.OPENROUTER_FREE_MODELS; } });
Object.defineProperty(exports, "resetQuotaState", { enumerable: true, get: function () { return ai_fallback_js_1.resetQuotaState; } });
Object.defineProperty(exports, "getQuotaExhaustedModels", { enumerable: true, get: function () { return ai_fallback_js_1.getQuotaExhaustedModels; } });
Object.defineProperty(exports, "extractResponse", { enumerable: true, get: function () { return ai_fallback_js_1.extractResponse; } });
// AI 配置唯一事实源（模型链 / 备用提供方 / 站点默认模型）
var ai_config_js_1 = require("./ai-config.js");
Object.defineProperty(exports, "FALLBACK_PROVIDERS", { enumerable: true, get: function () { return ai_config_js_1.FALLBACK_PROVIDERS; } });
Object.defineProperty(exports, "SITE_DEFAULT_MODELS", { enumerable: true, get: function () { return ai_config_js_1.SITE_DEFAULT_MODELS; } });
Object.defineProperty(exports, "getSiteDefaultModel", { enumerable: true, get: function () { return ai_config_js_1.getSiteDefaultModel; } });
// 文章质量评分（信息密度/套话密度/结构完整性/原创性）
var article_quality_js_1 = require("./article-quality.js");
Object.defineProperty(exports, "scoreArticle", { enumerable: true, get: function () { return article_quality_js_1.scoreArticle; } });
// 搜索词采集（Google Search Console API + 注入选题）
var search_terms_js_1 = require("./search-terms.js");
Object.defineProperty(exports, "fetchSearchConsoleTerms", { enumerable: true, get: function () { return search_terms_js_1.fetchSearchConsoleTerms; } });
Object.defineProperty(exports, "injectSearchTerms", { enumerable: true, get: function () { return search_terms_js_1.injectSearchTerms; } });
// 生成统计聚合（成功率/失败分布/平台稳定性/每日趋势）
var stats_js_1 = require("./stats.js");
Object.defineProperty(exports, "aggregateStats", { enumerable: true, get: function () { return stats_js_1.aggregateStats; } });
Object.defineProperty(exports, "renderStatsMarkdown", { enumerable: true, get: function () { return stats_js_1.renderStatsMarkdown; } });
