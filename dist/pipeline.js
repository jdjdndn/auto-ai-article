"use strict";
// ============================================================
// 核心管线 — 素材 → AI 选题 → AI 生成 → 内容安全 → 入库
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.withRetry = withRetry;
exports.createPipeline = createPipeline;
const prompts_js_1 = require("./prompts.js");
const utils_js_1 = require("./utils.js");
const content_safety_js_1 = require("./content-safety.js");
const ai_fallback_js_1 = require("./ai-fallback.js");
const article_quality_js_1 = require("./article-quality.js");
const search_terms_js_1 = require("./search-terms.js");
// —— 占位 URL 清洗 ——
const PLACEHOLDER_URL = /(^|[/.@])(example\.(com|org|net)|test\.com|yourlink\.com|yourdomain\.com|your-url\.com|sample\.com|domain\.com|website\.com|lorem\.ipsum|placeholder\.com)/i;
function cleanUrl(u) {
    if (typeof u !== 'string')
        return '';
    const s = u.trim();
    if (!/^https?:\/\//i.test(s))
        return '';
    if (PLACEHOLDER_URL.test(s))
        return '';
    return s;
}
function sanitizeLinks(arr) {
    return (Array.isArray(arr) ? arr : [])
        .filter((l) => l != null && typeof l === 'object' && typeof l.url === 'string' && !!cleanUrl(l.url))
        .map((l) => ({ label: String(l.label || ''), url: cleanUrl(l.url) }));
}
function sanitizeBlocks(blocks) {
    return blocks
        .map((b) => {
        if (!b || typeof b !== 'object')
            return b;
        if (b.type === 'ad' && typeof b.link === 'string' && !cleanUrl(b.link)) {
            const { link: _, ...rest } = b;
            return rest;
        }
        if ((b.type === 'image' || b.type === 'video') &&
            typeof b.url === 'string' &&
            !cleanUrl(b.url)) {
            return null;
        }
        return b;
    })
        .filter((b) => b !== null);
}
// —— 文章 → 纯文本（供质量评分用）——
function articleToText(a) {
    const parts = [`# ${a.title}`, a.summary];
    for (const b of a.content) {
        if (b.type === 'h2')
            parts.push(`## ${b.text}`);
        else if ('text' in b && typeof b.text === 'string')
            parts.push(b.text);
        if (b.type === 'list' && Array.isArray(b.items))
            parts.push(b.items.map((i) => `- ${i}`).join('\n'));
        if (b.type === 'price' && b.desc)
            parts.push(b.desc);
    }
    for (const f of a.faq)
        parts.push(f.q, f.a);
    return parts.filter(Boolean).join('\n');
}
// —— 默认 AI 客户端（复用 ai-fallback 的 OpenAI 兼容客户端）——
function createDefaultAiClient(config) {
    return (0, ai_fallback_js_1.createAiClient)({
        openai: {
            baseUrl: config.baseUrl || 'https://api.openai.com/v1',
            apiKey: config.apiKey || '',
            model: config.model || 'gpt-4o-mini',
            maxTokens: config.maxTokens || 4096,
        },
    });
}
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * 通用重试工具（公共导出，本地/云端 AI client 复用）：
 * - fn(attempt)：第 attempt 次尝试（0 起），可用于模型轮换
 * - retries：额外重试次数（总尝试 retries+1）
 * - delaysMs：各次重试前的等待间隔；缺省 1s×(i+1) 递增（保持旧行为）
 */
async function withRetry(fn, retries, label, sleep = defaultSleep, delaysMs) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn(i);
        }
        catch (e) {
            lastErr = e;
            if (i < retries) {
                await sleep(delaysMs ? delaysMs[i] : 1000 * (i + 1));
            }
        }
    }
    throw lastErr;
}
/** 简单并发限制：并发执行 tasks，最多同时 limit 个 */
async function mapWithConcurrency(tasks, limit, fn) {
    const results = new Array(tasks.length);
    let nextIdx = 0;
    async function worker() {
        while (nextIdx < tasks.length) {
            const i = nextIdx++;
            try {
                const value = await fn(tasks[i], i);
                results[i] = { status: 'fulfilled', value };
            }
            catch (reason) {
                results[i] = { status: 'rejected', reason };
            }
        }
    }
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
    await Promise.all(workers);
    return results;
}
function createPipeline(db, config = {}) {
    const target = config.target ?? 3;
    const log = config.logger || ((...args) => console.log(new Date().toISOString(), '[pipeline]', ...args));
    // AI 客户端选择逻辑：
    // 1. config.ai.client → 直接使用（最高优先级）
    // 2. config.ai.cloudflare → 使用降级客户端（额度用完自动切换 OpenRouter）
    // 3. config.ai.openrouter / OPENROUTER_API_KEY → OpenRouter 免费模型链
    // 4. config.ai.baseUrl/apiKey → 使用 OpenAI 兼容客户端
    // 5. 默认 → OpenAI 兼容客户端
    const ai = config.ai ?? {};
    let aiClient;
    if (ai.client) {
        aiClient = ai.client;
    }
    else if (ai.cloudflare) {
        const orKey = ai.openrouter?.apiKey || process.env.OPENROUTER_API_KEY;
        aiClient = (0, ai_fallback_js_1.createAiClient)({
            cloudflare: ai.cloudflare,
            openrouter: orKey ? { apiKey: orKey, models: ai.openrouter?.models } : undefined,
        });
    }
    else if (ai.openrouter || process.env.OPENROUTER_API_KEY) {
        const or = ai.openrouter;
        const orKey = or?.apiKey || process.env.OPENROUTER_API_KEY;
        const orModels = or?.models;
        aiClient = (0, ai_fallback_js_1.createAiClient)({
            openrouter: { apiKey: orKey, ...(orModels ? { models: orModels } : {}) },
        });
    }
    else {
        aiClient = createDefaultAiClient(ai);
    }
    const systemPrompt = config.systemPrompt ?? (0, prompts_js_1.aiSystemPrompt)();
    const suggestPrompt = config.suggestPrompt ?? (0, prompts_js_1.aiSuggestPrompt)();
    const extraSafetyRules = config.extraSafetyRules ?? [];
    const sanitizeUrls = config.sanitizeUrls ?? true;
    const safetyAction = config.safetyAction ?? 'replace';
    const suggestRetries = config.suggestRetries ?? 1;
    const generateRetries = config.generateRetries ?? 1;
    const concurrency = config.concurrency ?? 3;
    const publishMode = config.publishMode ?? 'draft';
    // —— AI 选题（带重试）——
    async function suggestTopics() {
        return withRetry(async () => {
            const baseUserContent = '请输出 3 个选题 JSON 数组。只输出 JSON 数组，不要 markdown，不要解释。';
            const userContent = config.searchTerms?.length
                ? (0, search_terms_js_1.injectSearchTerms)(baseUserContent, config.searchTerms)
                : baseUserContent;
            const text = await aiClient([
                { role: 'system', content: suggestPrompt },
                { role: 'user', content: userContent },
            ]);
            const parsed = (0, utils_js_1.extractJson)(text);
            const arr = (0, utils_js_1.asAnyArray)(parsed);
            if (!arr || !arr.length) {
                const snippet = String(text || '')
                    .slice(0, 180)
                    .replace(/\s+/g, ' ');
                throw new Error(`AI 选题返回空数组 raw=${snippet}`);
            }
            const items = arr
                .map((x) => ({
                title: String(x?.title || '').trim(),
                angle: String(x?.angle || '').trim(),
                category: ['优惠', '攻略', '好物', '副业'].includes(x?.category) ? x.category : 'auto',
            }))
                .filter((x) => x.title && x.angle);
            if (!items.length)
                throw new Error('AI 选题字段无效（缺 title/angle）');
            return items.slice(0, 3);
        }, suggestRetries, 'AI 选题');
    }
    // —— 单素材生成 ——
    async function generateArticle(raw, opts = {}) {
        if (!raw || raw.length < 8)
            throw new Error('素材过短（至少 8 字符）');
        // 生成重试：TFG 等浏览器网关在会话不稳定窗口会返回 HTTP 200 但内容不合格（非 JSON/缺字段/过短），
        // 与网络错误一样需要重试；重试间隔放大（8s/16s…）以覆盖浏览器会话恢复时间
        return withRetry(async () => {
            const text = await aiClient([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `原始信息：\n${JSON.stringify(raw)}` },
            ]);
            const a = (0, utils_js_1.extractJson)(text);
            if (!a)
                throw new Error('AI 返回无法解析为 JSON');
            const item = {
                title: String(a.title || '').trim(),
                summary: String(a.summary || ''),
                content: (0, utils_js_1.normalizeContentBlocks)(a.content),
                template: (['deal', 'guide', 'faq', 'default'].includes(a.template)
                    ? a.template
                    : opts.template && opts.template !== 'auto'
                        ? opts.template
                        : 'deal'),
                category: opts.category && opts.category !== 'auto' ? opts.category : a.category || '优惠',
                tags: Array.isArray(a.tags) ? a.tags : [],
                faq: Array.isArray(a.faq) ? a.faq : [],
                links: Array.isArray(a.links) ? a.links : [],
                expiresAt: a.expiresAt || null,
            };
            if (!item.title || !item.content.length)
                throw new Error('AI 结果缺 title/content');
            // 发布模式：draft（默认，不设置 status）/ published / seed（按素材 publishAt 决定）
            if (publishMode === 'seed') {
                item.publishAt = opts.publishAt ?? null;
                item.status = opts.publishAt ? 'draft' : 'published';
            }
            else if (publishMode === 'published') {
                item.publishAt = opts.publishAt ?? null;
                item.status = 'published';
            }
            // 内容充实度兜底
            const contentChars = JSON.stringify(item.content).length;
            if (item.content.length < 3 || contentChars < 250) {
                throw new Error(`AI 内容过短（${item.content.length} 块 / ${contentChars} 字），请重试`);
            }
            // 链接池解析钩子（站点特有：如 article-site 的 applyLinkPool）— 须在 URL 清洗之前，
            // 先把 AI 输出的 ref/linkId 解析成链接池真实 URL，再由 sanitize 兜底清占位/非法链接
            let resolved = item;
            if (config.resolveLinks) {
                resolved = config.resolveLinks(item);
            }
            // URL 清洗
            if (sanitizeUrls) {
                resolved.links = sanitizeLinks(resolved.links);
                resolved.content = sanitizeBlocks(resolved.content);
            }
            return resolved;
        }, generateRetries, 'AI 生成', (ms) => new Promise((r) => setTimeout(r, ms * 8)));
    }
    // —— 内容安全处理 ——
    function applySafety(article) {
        const safety = (0, content_safety_js_1.checkArticleSafety)({
            title: article.title,
            summary: article.summary,
            content: article.content,
            faq: article.faq,
            tags: article.tags,
            links: article.links,
        }, extraSafetyRules);
        if (!safety.hits.length)
            return { article, hit: false };
        if (safetyAction === 'draft') {
            article.status = 'draft';
            return { article, hit: true };
        }
        // replace 模式：逐字段替换违规词
        const r1 = (0, content_safety_js_1.replaceViolatingWords)(article.title);
        article.title = r1.text;
        const r2 = (0, content_safety_js_1.replaceViolatingWords)(article.summary);
        article.summary = r2.text;
        article.content = article.content.map((b) => {
            // text block
            if ('text' in b && typeof b.text === 'string') {
                const r = (0, content_safety_js_1.replaceViolatingWords)(b.text);
                return r.replaced ? { ...b, text: r.text } : b;
            }
            // list items
            if (b.type === 'list' && Array.isArray(b.items)) {
                const newItems = b.items.map((it) => {
                    if (typeof it !== 'string')
                        return it;
                    const r = (0, content_safety_js_1.replaceViolatingWords)(it);
                    return r.replaced ? r.text : it;
                });
                return { ...b, items: newItems };
            }
            return b;
        });
        return { article, hit: true };
    }
    // —— 完整管线 ——
    async function run() {
        const result = { ok: 0, fail: 0, total: 0, articles: [], errors: [] };
        // 1. 拉取 pending 素材
        let list = await db.fetchPendingSeeds(target + 5);
        const have = list?.length || 0;
        // 2. 素材不足 → AI 选题补足（带重试）
        if (have < target) {
            try {
                const topics = await suggestTopics();
                if (topics.length) {
                    await db.insertSeeds(topics.map((tp) => ({
                        raw: `选题：${tp.title}\n思路：${tp.angle}\n分类建议：${tp.category}`,
                        category: tp.category,
                    })), 'ai');
                    list = await db.fetchPendingSeeds(target + 5);
                }
            }
            catch (e) {
                result.errors.push(`AI 选题失败: ${e.message}`);
            }
        }
        if (!list || !list.length) {
            result.errors.push('素材池没有待处理素材');
            return result;
        }
        // 3. 清理已关联文章的残留 pending
        const linked = list.filter((s) => s.articleId);
        if (linked.length) {
            for (const s of linked) {
                await db
                    .markSeedDone(s.id, s.articleId)
                    .catch((e) => log('清理残留 pending 失败:', e?.message || e));
            }
            list = list.filter((s) => !s.articleId);
        }
        // 4. 生成 + 安全处理
        const targets = list.slice(0, target);
        result.total = targets.length;
        const outcomes = await mapWithConcurrency(targets, concurrency, async (s) => {
            const raw = String(s.raw || '');
            if (raw.length < 8) {
                await db
                    .markSeedFailed(s.id, '素材过短')
                    .catch((e) => log('标记素材失败（素材过短）失败:', e?.message || e));
                throw new Error('素材过短');
            }
            const article = await generateArticle(raw, {
                category: s.category,
                template: s.template,
                publishAt: s.publishAt ?? null,
            });
            // 内容安全处理
            const { article: safeArticle } = applySafety(article);
            // 质量评分门控（低分跳过入库，杜绝水文上线）
            if (config.quality) {
                const score = (0, article_quality_js_1.scoreArticle)(articleToText(safeArticle), config.quality);
                if (!score.pass) {
                    await db
                        .markSeedFailed(s.id, `质量不达标 ${score.total}分`)
                        .catch((e) => log('标记素材失败（质量不达标）失败:', e?.message || e));
                    throw new Error(`文章质量不达标 ${score.total}分：套话命中 ${score.clicheHits.join(', ') || '无'}`);
                }
                log(`质量评分 ${score.total}分（信息${score.details.infoDensity}/套话${score.details.clicheDensity}/结构${score.details.structure}/原创${score.details.originality}）`);
            }
            // 入库
            const r = await db.insertArticles([safeArticle]);
            const res = r.results?.[0];
            if (res?.ok && res.id) {
                await db.markSeedDone(s.id, res.id);
                return { title: safeArticle.title, articleId: res.id };
            }
            await db.markSeedFailed(s.id, res?.error || '入库失败');
            throw new Error(res?.error || '入库失败');
        });
        // 5. 汇总
        for (const o of outcomes) {
            if (o.status === 'fulfilled') {
                result.ok++;
                result.articles.push(o.value);
            }
            else {
                result.fail++;
                result.errors.push(o.reason?.message || '未知错误');
            }
        }
        // 6. 运行日志
        try {
            await db.insertRunLog({
                runAt: new Date().toISOString(),
                model: config.ai?.model || 'default',
                total: result.total,
                ok: result.ok,
                fail: result.fail,
                error: result.errors.length ? result.errors.join('; ').slice(0, 300) : null,
            });
        }
        catch {
            /* 日志失败不阻塞 */
        }
        return result;
    }
    return { suggestTopics, generateArticle, run };
}
