"use strict";
// ============================================================
// 工具函数 — 从 article-site/shared/ai-utils.mjs + content.ts 提取
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractJson = extractJson;
exports.safeJson = safeJson;
exports.normalizeJson = normalizeJson;
exports.firstImageOf = firstImageOf;
// —— JSON 提取（容忍 markdown 代码块包裹 / 前后多余文字）——
function extractJson(text) {
    if (typeof text !== 'string')
        return null;
    const t = text.trim();
    try {
        return JSON.parse(t);
    }
    catch { /* fallthrough */ }
    const mc = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (mc) {
        try {
            return JSON.parse(mc[1].trim());
        }
        catch { /* fallthrough */ }
    }
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try {
            return JSON.parse(t.slice(start, end + 1));
        }
        catch { /* fallthrough */ }
    }
    // 尝试提取数组
    const arrStart = t.indexOf('[');
    const arrEnd = t.lastIndexOf(']');
    if (arrStart >= 0 && arrEnd > arrStart) {
        try {
            return JSON.parse(t.slice(arrStart, arrEnd + 1));
        }
        catch { /* fallthrough */ }
    }
    return null;
}
// —— 内容工具 ——
/** 安全 JSON 解析 */
function safeJson(s, fallback = []) {
    if (!s)
        return fallback;
    try {
        return JSON.parse(s);
    }
    catch {
        return fallback;
    }
}
/** JSON 字段归一化：任意值 → 紧凑 JSON 字符串；空 → '[]' */
function normalizeJson(v) {
    if (v == null || v === '')
        return '[]';
    if (typeof v === 'string') {
        try {
            return JSON.stringify(JSON.parse(v));
        }
        catch {
            return null;
        }
    }
    try {
        return JSON.stringify(v);
    }
    catch {
        return null;
    }
}
/** 从 content 块数组提取第一个 image 块 URL */
function firstImageOf(content) {
    if (!Array.isArray(content))
        return '';
    const b = content.find((x) => {
        const block = x;
        return block?.type === 'image' && 'url' in block && !!block.url;
    });
    return b?.url || '';
}
