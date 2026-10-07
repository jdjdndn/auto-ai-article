"use strict";
// ============================================================
// AI 模型降级库 — Cloudflare Workers AI 免费模型故障自动切换
// 独立封装，不修改其他项目代码
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FREE_TEXT_MODELS = void 0;
exports.extractResponse = extractResponse;
exports.resetQuotaState = resetQuotaState;
exports.getQuotaExhaustedModels = getQuotaExhaustedModels;
exports.createFallbackClient = createFallbackClient;
exports.getRecommendedModels = getRecommendedModels;
exports.createCloudflareAiClient = createCloudflareAiClient;
exports.createAiClient = createAiClient;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// —— 免费模型清单（按优先级排序）——
// 来源：Cloudflare Workers AI 官方文档（2026-10）
// 免费额度：每个模型每日 10,000 neurons
exports.FREE_TEXT_MODELS = [
    // —— 中文优化模型（优先）——
    { id: '@cf/qwen/qwen3.8-27b', provider: 'Alibaba/Qwen', priority: 1, description: 'Qwen 3.8，中文能力最强', chineseOptimized: true, noThinking: true },
    { id: '@cf/zai-org/glm-5.3', provider: 'Zhipu AI', priority: 2, description: '智谱 GLM 5.3，中文优秀', chineseOptimized: true, noThinking: true },
    { id: '@cf/deepseek-ai/deepseek-v4-pro-0813', provider: 'DeepSeek', priority: 3, description: 'DeepSeek V4 专业版', chineseOptimized: true, noThinking: true },
    { id: '@cf/moonshotai/kimi-k2.6', provider: 'Moonshot AI', priority: 4, description: 'Moonshot Kimi K2.6', chineseOptimized: true, noThinking: true },
    { id: '@cf/qwen/qwen3-30b-a3b-fp8', provider: 'Alibaba/Qwen', priority: 5, description: 'Qwen 3 MoE 架构', chineseOptimized: true, noThinking: true },
    { id: '@cf/zai-org/glm-5.2', provider: 'Zhipu AI', priority: 6, description: '智谱 GLM 5.2', chineseOptimized: true, noThinking: true },
    { id: '@cf/deepseek-ai/deepseek-v4-flash-0731', provider: 'DeepSeek', priority: 7, description: 'DeepSeek V4 快速版', chineseOptimized: true, noThinking: true },
    { id: '@cf/moonshotai/kimi-k2.7-code', provider: 'Moonshot AI', priority: 8, description: 'Kimi K2.7 代码增强版', chineseOptimized: true, noThinking: true },
    { id: '@cf/zai-org/glm-5.3-flash', provider: 'Zhipu AI', priority: 9, description: '智谱 GLM 5.3 快速版', chineseOptimized: true, noThinking: true },
    { id: '@cf/qwen/qwen2.5-coder-32b-instruct', provider: 'Alibaba/Qwen', priority: 10, description: 'Qwen 2.5 Coder 32B', chineseOptimized: true, noThinking: true },
    // —— 通用模型（备选）——
    { id: '@cf/meta/llama-4-scout-17b-16e-instruct', provider: 'Meta', priority: 11, description: 'Meta Llama 4 Scout', chineseOptimized: false, noThinking: true },
    { id: '@cf/openai/gpt-oss-120b', provider: 'OpenAI', priority: 12, description: 'OpenAI 开源 120B', chineseOptimized: false, noThinking: true },
    { id: '@cf/zai-org/glm-4.7-flash', provider: 'Zhipu AI', priority: 13, description: '智谱 GLM 4.7 快速版', chineseOptimized: true, noThinking: true },
    { id: '@cf/mistralai/mistral-small-3.1-24b-instruct', provider: 'Mistral AI', priority: 14, description: 'Mistral Small 3.1', chineseOptimized: false, noThinking: false },
    { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', provider: 'Meta', priority: 15, description: 'Meta Llama 3.3 70B', chineseOptimized: false, noThinking: true },
];
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
    if (msg.includes('quota') || msg.includes('limit') || msg.includes('exceeded'))
        return 'quota_exceeded';
    if (msg.includes('timeout') || msg.includes('timed out'))
        return 'timeout';
    if (msg.includes('rate') || msg.includes('429'))
        return 'rate_limit';
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
                    'Authorization': `Bearer ${config.apiToken}`,
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
// —— 按天失败记忆（与 generate-posts.js 的 bad-providers.json 同机制）——
// 当天某个模型失败过，今天之内所有运行都不再使用（避免反复尝试浪费 token）；
// 文件格式：{ date: 'YYYY-MM-DD', models: [...] }；日期按 UTC（与 CF 每模型每日额度重置周期一致）
function todayUtc() {
    return new Date().toISOString().slice(0, 10);
}
function loadBadModels(file) {
    if (!file)
        return new Set();
    try {
        const d = JSON.parse(fs_1.default.readFileSync(file, 'utf8'));
        if (d && d.date === todayUtc() && Array.isArray(d.models))
            return new Set(d.models);
    }
    catch { /* 文件不存在或损坏：从空开始 */ }
    return new Set();
}
function saveBadModels(file, models) {
    if (!file)
        return;
    try {
        fs_1.default.mkdirSync(path_1.default.dirname(file), { recursive: true });
        fs_1.default.writeFileSync(file, JSON.stringify({ date: todayUtc(), models: [...models] }, null, 2));
    }
    catch { /* 写盘失败不影响主流程 */ }
}
// —— 创建降级客户端 ——
function createFallbackClient(config) {
    const models = (config.models || exports.FREE_TEXT_MODELS)
        .slice()
        .sort((a, b) => a.priority - b.priority)
        .slice(0, config.maxDepth || exports.FREE_TEXT_MODELS.length);
    const retriesPerModel = config.retriesPerModel ?? 1;
    const minLength = config.minLength || 0;
    const requireEnding = config.requireEnding ?? false;
    const badModels = loadBadModels(config.badModelFile);
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
        const availableModels = models.filter(m => !unavailable.includes(m.id));
        if (availableModels.length === 0) {
            throw new Error(`所有模型当天不可用。已记录：${[...new Set(unavailable)].join(', ')}`);
        }
        if (availableModels.length < models.length) {
            const skipped = models.filter(m => unavailable.includes(m.id)).map(m => m.id);
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
                saveBadModels(config.badModelFile, badModels);
                attempted.push({ model: model.id, success: false, reason: classifyError(lastError || new Error('unknown')), error: lastError?.message });
            }
        }
        throw new Error(`所有模型均失败。尝试记录：${attempted.map(a => `${a.model}(${a.reason || 'error'})`).join(', ')}`);
    };
}
// —— 获取推荐模型列表 ——
function getRecommendedModels(chineseOnly = true) {
    return exports.FREE_TEXT_MODELS
        .filter(m => !chineseOnly || m.chineseOptimized)
        .sort((a, b) => a.priority - b.priority);
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
 * 2. 配置了 openai → 使用 OpenAI 兼容客户端
 * 3. 都未配置 → 抛出错误
 */
function createAiClient(config) {
    if (config.cloudflare) {
        return createFallbackClient(config.cloudflare);
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
    throw new Error('必须配置 cloudflare 或 openai');
}
