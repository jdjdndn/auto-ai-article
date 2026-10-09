"use strict";
// ============================================================
// AI 模型降级库 — Cloudflare Workers AI 免费模型故障自动切换
// 独立封装，不修改其他项目代码
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.CfRestProvider = exports.LocalAiProvider = exports.OpenRouterProvider = exports.CfBindingProvider = exports.FallbackChain = exports.OPENROUTER_FREE_MODELS = exports.FREE_TEXT_MODELS = void 0;
exports.extractResponse = extractResponse;
exports.resetQuotaState = resetQuotaState;
exports.getQuotaExhaustedModels = getQuotaExhaustedModels;
exports.createFallbackClient = createFallbackClient;
exports.createBindingFallbackClient = createBindingFallbackClient;
exports.createFallbackChain = createFallbackChain;
exports.getRecommendedModels = getRecommendedModels;
exports.createCloudflareAiClient = createCloudflareAiClient;
exports.createAiClient = createAiClient;
exports.createOpenRouterClient = createOpenRouterClient;
const ai_config_js_1 = require("./ai-config.js");
Object.defineProperty(exports, "FREE_TEXT_MODELS", { enumerable: true, get: function () { return ai_config_js_1.FREE_TEXT_MODELS; } });
Object.defineProperty(exports, "OPENROUTER_FREE_MODELS", { enumerable: true, get: function () { return ai_config_js_1.OPENROUTER_FREE_MODELS; } });
// —— 响应提取（兼容不同模型格式）——
/**
 * 从 Cloudflare Workers AI 响应中提取文本内容
 *
 * 兼容格式（HTTP API + Workers AI binding 两条路径共用）：
 * 1. 顶层字符串：data 本身就是 string
 * 2. 标准格式：{ result: { response: "..." } }
 * 3. 直接字符串：{ result: "..." }
 * 4. OpenAI 兼容：{ result: { choices: [{ message: { content: "..." } }] } }
 * 5. 数组格式：{ result: [{ content: "..." }] }
 * 6. binding 无 result 包装：{ choices: [...] } / { response: "..." } / { text: "..." }
 * 7. reasoning_content 回退（思考型模型：content 为空时取 reasoning）
 * 8. 其他格式：尝试提取 content/text 字段
 *
 * 空串保护：content 为空串/纯空白时继续尝试后续通道，避免 ?? 短路丢掉真实内容。
 */
function extractResponse(data) {
    // 1. 顶层字符串：部分 binding 直接返回 string
    if (typeof data === 'string')
        return data;
    const pick = (v) => (typeof v === 'string' && v.trim() ? v : '');
    // 2. 标准格式：{ result: { response: "..." } }
    const r1 = pick(data?.result?.response);
    if (r1)
        return r1;
    // 3. 直接字符串：{ result: "..." }
    const r2 = pick(data?.result);
    if (r2)
        return r2;
    // 4. OpenAI 兼容：{ result: { choices: [{ message: { content } }] } }
    const r3 = pick(data?.result?.choices?.[0]?.message?.content);
    if (r3)
        return r3;
    // 5. 数组格式：{ result: [{ content: "..." }] }
    if (Array.isArray(data?.result)) {
        const r4 = pick(data.result[0]?.content);
        if (r4)
            return r4;
    }
    // 6. binding 无 result 包装（部分模型直接返回顶层字段）
    const r5 = pick(data?.choices?.[0]?.message?.content);
    if (r5)
        return r5;
    const r6 = pick(data?.response);
    if (r6)
        return r6;
    // 7. reasoning_content 回退（思考型模型：content 为空时取 reasoning）
    const r7 = pick(data?.result?.choices?.[0]?.message?.reasoning_content);
    if (r7)
        return r7;
    const r8 = pick(data?.choices?.[0]?.message?.reasoning_content);
    if (r8)
        return r8;
    // 8. 其他格式：尝试提取 content/text 字段
    return pick(data?.result?.content) || pick(data?.result?.text) || pick(data?.text) || '';
}
// —— 错误分类 ——
function classifyError(error) {
    // 超时：手动 AbortController 中止会产生 TimeoutError/AbortError
    if (error.name === 'TimeoutError' || error.name === 'AbortError')
        return 'timeout';
    const msg = error.message.toLowerCase();
    if (msg.includes('rate') || msg.includes('429'))
        return 'rate_limit';
    if (msg.includes('quota') || msg.includes('exceeded'))
        return 'quota_exceeded';
    if (msg.includes('timeout') || msg.includes('timed out'))
        return 'timeout';
    if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('server'))
        return 'server_error';
    if (msg.includes('400') || msg.includes('invalid') || msg.includes('bad request'))
        return 'invalid_request';
    return 'unknown';
}
// —— 创建单个模型的客户端 ——
function createModelClient(model, config) {
    const baseUrl = config.baseUrl || 'https://api.cloudflare.com/client/v4';
    const timeoutMs = config.timeoutMs || 120_000;
    const maxTokens = config.maxTokens || 15_360;
    return async (messages) => {
        const body = { messages, max_tokens: maxTokens };
        // 关思考：思考型模型（glm/deepseek/qwen 系）会把预算烧在 reasoning 上导致正文截断；
        // 仅对实测支持 chat_template_kwargs 的模型开启（mistral-small 不支持，传参会 400）
        if (model.noThinking) {
            body.chat_template_kwargs = { thinking: false };
        }
        // Node v22 下 AbortSignal.timeout() 不可靠（不触发 abort），用手动控制器；
        // 中止时用 TimeoutError 命名，便于 classifyError 识别为超时（与 generate-posts.js 一致）
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new DOMException('AI 请求超时', 'TimeoutError')), timeoutMs);
        try {
            const res = await fetch(`${baseUrl}/accounts/${config.accountId}/ai/run/${model.id}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${config.apiToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!res.ok) {
                const bodyText = await res.text().catch(() => '');
                throw new Error(`HTTP ${res.status}: ${bodyText.slice(0, 200)}`);
            }
            const data = await res.json();
            const content = extractResponse(data);
            if (!content)
                throw new Error('AI 没有返回内容');
            // 截断兜底：finish_reason=length 说明模型输出被预算截断（内容半截），
            // 直接视为失败切换下一模型，不接收不完整文章（与 generate-posts.js 一致）
            const fr = data?.result?.choices?.[0]?.finish_reason;
            if (fr === 'length')
                throw new Error('AI 输出被截断（finish_reason=length，内容不完整）');
            return content;
        }
        finally {
            clearTimeout(timer);
        }
    };
}
// —— 额度状态记录（模块级，进程内共享）——
/** 额度已用完的模型 ID 集合 */
const quotaExhausted = new Set();
/** 重置额度状态（测试或手动恢复时使用） */
function resetQuotaState() {
    quotaExhausted.clear();
}
/** 获取当前额度用完的模型列表 */
function getQuotaExhaustedModels() {
    return Array.from(quotaExhausted);
}
// —— 按天失败记忆（BadModelStore 实现负责持久化）——
function loadBadModels(store) {
    if (!store)
        return new Set();
    try {
        const data = store.load();
        if (data && Array.isArray(data))
            return new Set(data);
    }
    catch {
        /* 读失败：从空开始 */
    }
    return new Set();
}
function saveBadModels(store, models) {
    if (!store)
        return;
    try {
        store.save([...models]);
    }
    catch {
        /* 写失败不影响主流程 */
    }
}
// —— 创建降级客户端 ——
function createFallbackClient(config) {
    const models = (config.models || ai_config_js_1.FREE_TEXT_MODELS)
        .slice()
        .sort((a, b) => a.priority - b.priority)
        .slice(0, config.maxDepth || ai_config_js_1.FREE_TEXT_MODELS.length);
    const retriesPerModel = config.retriesPerModel ?? 1;
    const minLength = config.minLength || 0;
    const requireEnding = config.requireEnding ?? false;
    const badModels = loadBadModels(config.badModelStore);
    const log = (...args) => console.log(new Date().toISOString(), '[ai-fallback]', ...args);
    // 完整收尾门禁：最后一句必须以句号类标点结束，或以 URL 收尾（URL 后不带句号是模型常见合法写法）
    function endingOk(content) {
        const tail = content.trim().replace(/`{3,}/g, '').trim();
        return /[。！？…!?.]$/.test(tail) || /https?:\/\/\S+$/.test(tail);
    }
    // 确定性失败（不重试直接切下一模型）：额度/限流/超时/请求无效/截断/空响应/过短/结尾不完整
    function isDeterministicFailure(err) {
        const reason = classifyError(err);
        if (reason === 'quota_exceeded' || reason === 'rate_limit' || reason === 'timeout' || reason === 'invalid_request')
            return true;
        return /被截断|没有返回内容|过短|结尾不完整/.test(err.message);
    }
    return async (messages) => {
        const attempted = [];
        // 过滤掉额度已用完或当天已失败的模型
        const unavailable = [...quotaExhausted, ...badModels];
        const availableModels = models.filter((m) => !unavailable.includes(m.id));
        if (availableModels.length === 0) {
            throw new Error(`所有模型当天不可用。已记录：${[...new Set(unavailable)].join(', ')}`);
        }
        if (availableModels.length < models.length) {
            const skipped = models.filter((m) => unavailable.includes(m.id)).map((m) => m.id);
            log(`跳过当天不可用模型：${skipped.join(', ')}`);
        }
        for (const model of availableModels) {
            const client = createModelClient(model, config);
            let lastError;
            let failedForGood = false;
            for (let retry = 0; retry <= retriesPerModel; retry++) {
                if (retry > 0) {
                    log(`模型 ${model.id} 第 ${retry + 1} 次重试`);
                }
                try {
                    const content = await client(messages);
                    // 内容质量门禁（对齐 generate-posts.js）：过短/结尾不完整视为不合格，切下一模型
                    if (minLength > 0 && content.trim().length < minLength) {
                        throw new Error(`内容过短(${content.trim().length}字 < ${minLength})`);
                    }
                    if (requireEnding && !endingOk(content)) {
                        throw new Error(`内容被截断(结尾不完整: …${content.trim().slice(-16)})`);
                    }
                    attempted.push({ model: model.id, success: true });
                    log(`成功：${model.id}（尝试 ${attempted.length} 个模型）`);
                    return content;
                }
                catch (e) {
                    lastError = e;
                    const reason = classifyError(e);
                    log(`失败：${model.id}（${reason}）: ${e.message}`);
                    if (reason === 'quota_exceeded') {
                        quotaExhausted.add(model.id);
                        log(`模型 ${model.id} 额度已用完，已记录`);
                    }
                    // 确定性失败不重试：额度/限流/超时/请求无效/截断/空响应/过短（重试只会浪费 token）
                    if (isDeterministicFailure(e)) {
                        failedForGood = true;
                        break;
                    }
                    if (retry === retriesPerModel) {
                        failedForGood = true;
                    }
                }
            }
            // 模型整体失败（重试完或确定性失败）→ 记入当天失败记忆：今天之内不再使用
            if (failedForGood) {
                badModels.add(model.id);
                saveBadModels(config.badModelStore, badModels);
                attempted.push({
                    model: model.id,
                    success: false,
                    reason: classifyError(lastError || new Error('unknown')),
                    error: lastError?.message,
                });
            }
        }
        throw new Error(`所有模型均失败。尝试记录：${attempted.map((a) => `${a.model}(${a.reason || 'error'})`).join(', ')}`);
    };
}
/** 责任链：多个 provider 依次尝试，一个全失败切下一个 */
class FallbackChain {
    providers;
    log;
    /** 最近一次成功的 provider 名（供调用方记录来源） */
    lastSuccess = null;
    constructor(providers, logFn) {
        this.providers = providers;
        this.log = logFn || ((...args) => console.log(new Date().toISOString(), '[ai-chain]', ...args));
    }
    /** 在链首插入 provider（最高优先级，如本地 AI） */
    prepend(provider) {
        this.providers.unshift(provider);
        return this;
    }
    /** 在链尾追加 provider（最低优先级，如兜底） */
    append(provider) {
        this.providers.push(provider);
        return this;
    }
    async run(messages) {
        const errors = [];
        for (const provider of this.providers) {
            try {
                const result = await provider.try(messages);
                this.lastSuccess = provider.name;
                return result;
            }
            catch (e) {
                const msg = String(e?.message || e);
                errors.push(`${provider.name}: ${msg}`);
                this.log(`${provider.name} 失败，切换下一个 provider`);
            }
        }
        throw new Error(`所有 AI provider 均失败：\n${errors.join('\n')}`);
    }
}
exports.FallbackChain = FallbackChain;
/** CF Workers AI binding provider */
class CfBindingProvider {
    name = 'cloudflare-binding';
    binding;
    models;
    maxTokens;
    timeoutMs;
    badModels = new Set();
    quotaExhausted = new Set();
    log;
    constructor(config) {
        this.binding = config.binding;
        this.models = (config.models || ai_config_js_1.FREE_TEXT_MODELS)
            .slice()
            .sort((a, b) => a.priority - b.priority)
            .slice(0, config.maxDepth || ai_config_js_1.FREE_TEXT_MODELS.length);
        this.maxTokens = config.maxTokens || 4096;
        this.timeoutMs = config.timeoutMs || 120_000;
        this.log = config.logFn || ((...args) => console.log(new Date().toISOString(), '[ai-cf]', ...args));
    }
    async try(messages) {
        const unavailable = [...this.quotaExhausted, ...this.badModels];
        const available = this.models.filter((m) => !unavailable.includes(m.id));
        if (!available.length)
            throw new Error('CF 所有模型当天不可用');
        for (const model of available) {
            try {
                const timer = setTimeout(() => { }, this.timeoutMs);
                let out;
                try {
                    const body = { messages, max_tokens: this.maxTokens };
                    if (model.noThinking)
                        body.chat_template_kwargs = { thinking: false };
                    out = await this.binding.run(model.id, body);
                }
                finally {
                    clearTimeout(timer);
                }
                const content = extractResponse(out);
                if (!content)
                    throw new Error('AI 没有返回内容');
                const fr = out?.result?.choices?.[0]?.finish_reason || out?.choices?.[0]?.finish_reason;
                if (fr === 'length')
                    throw new Error('AI 输出被截断');
                this.log(`成功：${model.id}`);
                return content;
            }
            catch (e) {
                const reason = classifyError(e);
                this.log(`失败：${model.id}（${reason}）`);
                if (reason === 'quota_exceeded')
                    this.quotaExhausted.add(model.id);
                this.badModels.add(model.id);
            }
        }
        throw new Error(`CF 所有模型失败：${[...unavailable].join(', ')}`);
    }
    getBadModels() {
        return Array.from(this.badModels);
    }
}
exports.CfBindingProvider = CfBindingProvider;
/** OpenRouter provider（包装 createOpenRouterClient） */
class OpenRouterProvider {
    name = 'openrouter';
    client;
    badModels = new Set();
    constructor(config) {
        this.client = createOpenRouterClient(config);
    }
    async try(messages) {
        return this.client(messages);
    }
    getBadModels() {
        return Array.from(this.badModels);
    }
}
exports.OpenRouterProvider = OpenRouterProvider;
/** 本地 AI provider（token-free-gateway / Ollama / LM Studio 等 OpenAI 兼容网关） */
class LocalAiProvider {
    name = 'local';
    baseUrl;
    model;
    apiKey;
    badModels = new Set();
    constructor(config) {
        this.baseUrl = config.baseUrl.replace(/\/+$/, '');
        this.model = config.model || 'deepseek-chat';
        this.apiKey = config.apiKey;
    }
    async try(messages) {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
            },
            body: JSON.stringify({ model: this.model, messages, max_tokens: 4096 }),
        });
        if (!res.ok)
            throw new Error(`本地 AI 返回 ${res.status}: ${await res.text()}`);
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content)
            throw new Error('本地 AI 没有返回内容');
        return content;
    }
    getBadModels() {
        return Array.from(this.badModels);
    }
}
exports.LocalAiProvider = LocalAiProvider;
/** CF Workers AI REST provider（Node CLI 用 fetch REST，无需 Workers binding） */
class CfRestProvider {
    name = 'cloudflare-rest';
    client;
    badModels = new Set();
    constructor(config) {
        this.client = createFallbackClient(config);
    }
    async try(messages) {
        return this.client(messages);
    }
    getBadModels() {
        return Array.from(this.badModels);
    }
}
exports.CfRestProvider = CfRestProvider;
function createBindingFallbackClient(config) {
    const chain = createFallbackChain(config);
    return (messages) => chain.run(messages);
}
/** 创建 FallbackChain 实例（可 prepend/append 额外 provider） */
function createFallbackChain(config) {
    const log = (...args) => console.log(new Date().toISOString(), '[ai-fallback]', ...args);
    const providers = [];
    // 1. 本地 AI（最高优先级）
    if (config.local) {
        providers.push(new LocalAiProvider(config.local));
    }
    // 2. CF REST（Node CLI）或 CF binding（Workers）
    if (config.cfRest) {
        providers.push(new CfRestProvider(config.cfRest));
    }
    else if (config.binding) {
        providers.push(new CfBindingProvider({
            binding: config.binding,
            models: config.models,
            maxDepth: config.maxDepth,
            maxTokens: config.maxTokens,
            timeoutMs: config.timeoutMs,
            logFn: (...args) => console.log(new Date().toISOString(), '[ai-cf]', ...args),
        }));
    }
    // 3. OpenRouter（兜底）
    if (config.openrouter) {
        providers.push(new OpenRouterProvider(config.openrouter));
    }
    return new FallbackChain(providers, log);
}
function getRecommendedModels(chineseOnly = true) {
    return ai_config_js_1.FREE_TEXT_MODELS.filter((m) => !chineseOnly || m.chineseOptimized).sort((a, b) => a.priority - b.priority);
}
// —— 导出默认客户端工厂 ——
function createCloudflareAiClient(config) {
    return createFallbackClient(config);
}
/**
 * 创建 AI 客户端（根据配置自动选择）
 *
 * 优先级：
 * 1. 配置了 cloudflare → 使用降级客户端（额度用完自动切换）
 * 2. 配置了 openrouter → 使用 OpenRouter 免费模型链客户端（CF 用尽后的兜底）
 * 3. 配置了 openai → 使用 OpenAI 兼容客户端
 * 4. 都未配置 → 抛出错误
 */
function createAiClient(config) {
    if (config.cloudflare) {
        const cfClient = createFallbackClient(config.cloudflare);
        // 同时配了 openrouter → CF 全部模型失败时回退到 OpenRouter
        if (config.openrouter) {
            const orClient = createOpenRouterClient(config.openrouter);
            return async (messages) => {
                try {
                    return await cfClient(messages);
                }
                catch (e) {
                    const msg = String(e?.message || e);
                    if (msg.includes('所有模型') || msg.includes('不可用') || msg.includes('均失败')) {
                        console.log('[ai-fallback] Cloudflare 模型全部不可用，回退到 OpenRouter');
                        return orClient(messages);
                    }
                    throw e;
                }
            };
        }
        return cfClient;
    }
    if (config.openrouter) {
        return createOpenRouterClient(config.openrouter);
    }
    if (config.openai) {
        const baseUrl = (config.openai.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const apiKey = config.openai.apiKey;
        const model = config.openai.model || 'gpt-4o-mini';
        const maxTokens = config.openai.maxTokens || 15_360;
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
    throw new Error('必须配置 cloudflare、openrouter 或 openai');
}
/**
 * OpenRouter 客户端：OpenAI 兼容端点 + 免费模型链依次降级
 * （402 无额度 / 404 模型下架 / 429 限流 / 5xx → 切换下一模型）
 */
function createOpenRouterClient(config) {
    const baseUrl = (config.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
    const apiKey = config.apiKey;
    const models = config.models?.length ? config.models : ai_config_js_1.OPENROUTER_FREE_MODELS;
    const timeoutMs = config.timeoutMs || 120_000;
    return async (messages) => {
        const attempted = [];
        for (const model of models) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(new DOMException('AI 请求超时', 'TimeoutError')), timeoutMs);
            try {
                const res = await fetch(`${baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                    body: JSON.stringify({ model, messages, max_tokens: 15_360, stream: false }),
                    signal: controller.signal,
                });
                if (!res.ok) {
                    const bodyText = await res.text().catch(() => '');
                    throw new Error(`HTTP ${res.status}: ${bodyText.slice(0, 200)}`);
                }
                const data = await res.json();
                const content = data?.choices?.[0]?.message?.content ?? '';
                if (!content.trim())
                    throw new Error('AI 没有返回内容');
                return content;
            }
            catch (e) {
                attempted.push(`${model}(${classifyError(e)})`);
                const reason = classifyError(e);
                const msg = String(e.message || '').toLowerCase();
                // 确定性失败直接切下一模型；未知/服务端错误也切（免费模型链无需重试）
                if (reason === 'timeout' && !msg.includes('500') && !msg.includes('502') && !msg.includes('503')) {
                    // 超时可能瞬时，但免费链上继续尝试下一模型成本更低
                }
            }
            finally {
                clearTimeout(timer);
            }
        }
        throw new Error(`所有 OpenRouter 免费模型失败。尝试记录：${attempted.join(', ')}`);
    };
}
