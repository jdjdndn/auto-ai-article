"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateConfig = validateConfig;
const ai_config_js_1 = require("./ai-config.js");
function nestedVal(config, path) {
    let cur = config;
    for (const k of path) {
        if (cur && typeof cur === 'object') {
            cur = cur[k];
        }
        else {
            return undefined;
        }
    }
    return cur;
}
function pick(config, flatKey, nestedPath) {
    const flat = config[flatKey];
    if (flat !== undefined && flat !== null && flat !== '')
        return flat;
    if (nestedPath)
        return nestedVal(config, nestedPath);
    return undefined;
}
function isNonEmpty(v) {
    return typeof v === 'string' && v.trim().length > 0;
}
function validateConfig(config) {
    const errors = [];
    const warnings = [];
    const providerKeys = ai_config_js_1.FALLBACK_PROVIDERS.map((p) => p.envKey);
    const hasFallback = providerKeys.some((k) => isNonEmpty(config[k]));
    const aiApiKey = pick(config, 'AI_API_KEY', ['ai', 'apiKey']);
    const localGateway = pick(config, 'LOCAL_GATEWAY_URL', ['localGateway']);
    if (!hasFallback && !isNonEmpty(aiApiKey) && !isNonEmpty(localGateway)) {
        errors.push('未配置任何 AI 提供方，至少需要 OPENROUTER_API_KEY / AI_API_KEY / 本地网关之一');
    }
    if (!isNonEmpty(config.OPENROUTER_API_KEY)) {
        warnings.push('未配置 OpenRouter 兜底，CF 额度用尽后无免费降级');
    }
    const alertWebhook = pick(config, 'ALERT_WEBHOOK_URL', ['alert', 'webhookUrl']);
    if (!isNonEmpty(alertWebhook)) {
        warnings.push('未配置告警 webhook，故障时无通知');
    }
    const rateRaw = pick(config, 'ALERT_MIN_SUCCESS_RATE', ['alert', 'minSuccessRate']);
    if (rateRaw !== undefined && rateRaw !== null && rateRaw !== '') {
        const rate = Number(rateRaw);
        if (Number.isNaN(rate) || rate <= 0 || rate > 1) {
            errors.push('ALERT_MIN_SUCCESS_RATE 必须在 0~1 之间');
        }
    }
    if (isNonEmpty(localGateway)) {
        const gw = String(localGateway).trim();
        if (!gw.startsWith('http://')) {
            errors.push('LOCAL_GATEWAY_URL 必须以 http:// 开头');
        }
    }
    return { valid: errors.length === 0, errors, warnings };
}
