"use strict";
// ============================================================
// 核心管线 — 素材 → AI 选题 → AI 生成 → 内容安全 → 入库
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPipeline = createPipeline;
const prompts_js_1 = require("./prompts.js");
const utils_js_1 = require("./utils.js");
const content_safety_js_1 = require("./content-safety.js");
const ai_fallback_js_1 = require("./ai-fallback.js");
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
        if ((b.type === 'image' || b.type === 'video') && typeof b.url === 'string' && !cleanUrl(b.url)) {
            return null;
        }
        return b;
    })
        .filter((b) => b !== null);
}
// —— 默认 AI 客户端（OpenAI 兼容 HTTP）——
function createDefaultAiClient(config) {
    const baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const apiKey = config.apiKey || '';
    const model = config.model || 'gpt-4o-mini';
    const maxTokens = config.maxTokens || 4096;
    return async (messages) => {
        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: false }),
            signal: AbortSignal.timeout(180_000),
        });
        if (!res.ok)
            throw new Error(`AI API HTTP ${res.status}: ${await res.text().catch(() => '')}`);
        const data = await res.json();
        return data?.choices?.[0]?.message?.content ?? '';
    };
}
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withRetry(fn, retries, label, sleep = defaultSleep) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        }
        catch (e) {
            lastErr = e;
            if (i < retries) {
                await sleep(1000 * (i + 1));
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
    // AI 客户端选择逻辑：
    // 1. config.ai.client → 直接使用（最高优先级）
    // 2. config.ai.cloudflare → 使用降级客户端（额度用完自动切换）
    // 3. config.ai.baseUrl/apiKey → 使用 OpenAI 兼容客户端
    // 4. 默认 → OpenAI 兼容客户端
    let aiClient;
    if (config.ai?.client) {
        aiClient = config.ai.client;
    }
    else if (config.ai?.cloudflare) {
        aiClient = (0, ai_fallback_js_1.createAiClient)({
            cloudflare: config.ai.cloudflare,
        });
    }
    else {
        aiClient = createDefaultAiClient(config.ai ?? {});
    }
    const systemPrompt = config.systemPrompt ?? (0, prompts_js_1.aiSystemPrompt)();
    const suggestPrompt = config.suggestPrompt ?? (0, prompts_js_1.aiSuggestPrompt)();
    const extraSafetyRules = config.extraSafetyRules ?? [];
    const sanitizeUrls = config.sanitizeUrls ?? true;
    const safetyAction = config.safetyAction ?? 'replace';
    const suggestRetries = config.suggestRetries ?? 1;
    // —— AI 选题（带重试）——
    async function suggestTopics() {
        return withRetry(async () => {
            const text = await aiClient([
                { role: 'system', content: suggestPrompt },
                { role: 'user', content: '请输出 3 个选题 JSON 数组。只输出 JSON 数组，不要 markdown，不要解释。' },
            ]);
            const parsed = (0, utils_js_1.extractJson)(text);
            const arr = (0, utils_js_1.asAnyArray)(parsed);
            if (!arr || !arr.length) {
                const snippet = String(text || '').slice(0, 180).replace(/\s+/g, ' ');
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
                : (opts.template && opts.template !== 'auto' ? opts.template : 'deal')),
            category: opts.category && opts.category !== 'auto' ? opts.category : (a.category || '优惠'),
            tags: Array.isArray(a.tags) ? a.tags : [],
            faq: Array.isArray(a.faq) ? a.faq : [],
            links: Array.isArray(a.links) ? a.links : [],
            expiresAt: a.expiresAt || null,
        };
        if (!item.title || !item.content.length)
            throw new Error('AI 结果缺 title/content');
        // 内容充实度兜底
        const contentChars = JSON.stringify(item.content).length;
        if (item.content.length < 3 || contentChars < 250) {
            throw new Error(`AI 内容过短（${item.content.length} 块 / ${contentChars} 字），请重试`);
        }
        // URL 清洗
        if (sanitizeUrls) {
            item.links = sanitizeLinks(item.links);
            item.content = sanitizeBlocks(item.content);
        }
        return item;
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
            if ('text' in b && typeof b.text === 'string') {
                const r = (0, content_safety_js_1.replaceViolatingWords)(b.text);
                return r.replaced ? { ...b, text: r.text } : b;
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
                await db.markSeedDone(s.id, s.articleId).catch(() => { });
            }
            list = list.filter((s) => !s.articleId);
        }
        // 4. 生成 + 安全处理
        const targets = list.slice(0, target);
        result.total = targets.length;
        const outcomes = await mapWithConcurrency(targets, 3, async (s) => {
            const raw = String(s.raw || '');
            if (raw.length < 8) {
                await db.markSeedFailed(s.id, '素材过短').catch(() => { });
                throw new Error('素材过短');
            }
            const article = await generateArticle(raw, {
                category: s.category,
                template: s.template,
            });
            // 内容安全处理
            const { article: safeArticle } = applySafety(article);
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
        catch { /* 日志失败不阻塞 */ }
        return result;
    }
    return { suggestTopics, generateArticle, run };
}
