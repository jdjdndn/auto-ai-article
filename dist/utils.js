"use strict";
// ============================================================
// 工具函数 — 从 article-site/shared/ai-utils.mjs + content.ts 提取
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.firstNonEmpty = firstNonEmpty;
exports.extractJson = extractJson;
exports.asAnyArray = asAnyArray;
exports.safeJson = safeJson;
exports.normalizeJson = normalizeJson;
exports.firstImageOf = firstImageOf;
exports.normalizeContentBlocks = normalizeContentBlocks;
// —— JSON 提取（容忍 markdown 代码块包裹 / 前后多余文字）——
/** 从候选字段中取第一个非空字符串（空串不能短路，否则会丢掉后面的真实内容） */
function firstNonEmpty(...vals) {
    for (const v of vals) {
        if (typeof v === 'string' && v.trim())
            return v;
    }
    return '';
}
function extractJson(text) {
    if (typeof text !== 'string')
        return null;
    // 去掉思考过程标签，避免污染 JSON 提取（qwen 等模型常见输出）
    let t = text
        .replace(/```think\s*[\s\S]*?```/gi, '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/【think】[\s\S]*?【\/think】/gi, '')
        .trim();
    if (!t)
        return null;
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
    // 尝试提取数组（兼容全角括号）
    let arrStart = t.indexOf('[');
    let arrEnd = t.lastIndexOf(']');
    if (!(arrStart >= 0 && arrEnd > arrStart)) {
        const fwStart = t.indexOf('［');
        const fwEnd = t.lastIndexOf('］');
        if (fwStart >= 0 && fwEnd > fwStart) {
            t = t.slice(0, fwStart) + '[' + t.slice(fwStart + 1, fwEnd) + ']' + t.slice(fwEnd + 1);
            arrStart = t.indexOf('[');
            arrEnd = t.lastIndexOf(']');
        }
    }
    if (arrStart >= 0 && arrEnd > arrStart) {
        try {
            return JSON.parse(t.slice(arrStart, arrEnd + 1));
        }
        catch { /* fallthrough */ }
    }
    return null;
}
/** 从解析结果中尽可能取出数组列表（topics/list/items/data/result 等常见包装） */
function asAnyArray(parsed) {
    if (Array.isArray(parsed))
        return parsed;
    if (parsed && typeof parsed === 'object') {
        const obj = parsed;
        const keys = ['topics', 'list', 'items', 'data', 'result', 'suggestions', '选题'];
        for (const k of keys) {
            if (Array.isArray(obj[k]))
                return obj[k];
        }
        // 单对象包装
        if (obj.result && typeof obj.result === 'object') {
            const inner = asAnyArray(obj.result);
            if (inner)
                return inner;
        }
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
/** 安全转字符串，避免页面出现 [object Object] */
function asDisplayString(v, fallback = '') {
    if (v == null || v === '')
        return fallback;
    if (typeof v === 'string')
        return v;
    if (typeof v === 'number' || typeof v === 'boolean')
        return String(v);
    return fallback;
}
/** 把 list items 拍平为字符串数组，禁止 [object Object] */
function flattenListItems(items) {
    return (Array.isArray(items) ? items : []).map((it) => {
        if (typeof it === 'string')
            return it;
        if (it && typeof it === 'object') {
            return asDisplayString(it.text ?? it.name ?? it.label ?? it.item) || JSON.stringify(it);
        }
        return String(it ?? '');
    }).filter(Boolean);
}
/** 把 price 块字段拍平为字符串，兼容 AI 输出嵌套对象 */
function flattenPriceBlock(b) {
    let name = asDisplayString(b.name);
    let price = '';
    let desc = asDisplayString(b.desc);
    const raw = b.price;
    if (raw != null && typeof raw === 'object') {
        const o = raw;
        name = name || asDisplayString(o.name);
        price = asDisplayString(o.price) || asDisplayString(o.name);
        desc = desc || asDisplayString(o.desc);
    }
    else {
        price = asDisplayString(raw);
    }
    return { type: 'price', name, price, desc };
}
/** 拍平标准块中的对象字段（text/h2/quote/ad/list.items） */
function flattenTypedBlock(b) {
    const type = String(b.type || '');
    if (type === 'price')
        return flattenPriceBlock(b);
    if (type === 'text' || type === 'h2' || type === 'quote' || type === 'ad') {
        const out = { ...b };
        for (const k of ['text', 'h2', 'quote', 'label', 'ad', 'content']) {
            if (out[k] != null && typeof out[k] === 'object') {
                const o = out[k];
                out[k] = asDisplayString(o.text ?? o.content ?? o.value ?? o.price ?? o.name);
            }
        }
        if (type === 'text')
            out.text = asDisplayString(out.text ?? out.content);
        if (type === 'h2')
            out.text = asDisplayString(out.text ?? out.h2);
        if (type === 'quote')
            out.text = asDisplayString(out.text ?? out.quote);
        if (type === 'ad') {
            out.label = asDisplayString(out.label ?? out.ad) || '立即办理';
            out.text = asDisplayString(out.text ?? out.ad ?? out.content);
        }
        return out;
    }
    if (type === 'list') {
        const items = Array.isArray(b.items) ? b.items : Array.isArray(b.list) ? b.list : b.list?.items;
        return {
            type: 'list',
            items: (Array.isArray(items) ? items : []).map((it) => {
                if (typeof it === 'string')
                    return it;
                if (it && typeof it === 'object') {
                    return asDisplayString(it.text ?? it.name ?? it.label ?? it.item) || JSON.stringify(it);
                }
                return String(it ?? '');
            }).filter(Boolean),
        };
    }
    return b;
}
/** 把 AI 松散 content 块归一化为标准 {type,...} 结构，禁止缺 type 的对象入库 */
function normalizeContentBlocks(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const b of raw) {
        if (!b || typeof b !== 'object')
            continue;
        // 已是标准块：仍需拍平嵌套对象字段
        if (typeof b.type === 'string' && b.type) {
            if (b.type === 'list') {
                const items = Array.isArray(b.items) ? b.items : Array.isArray(b.list) ? b.list : b.list?.items;
                out.push({ type: 'list', items: flattenListItems(items) });
                continue;
            }
            out.push(flattenTypedBlock(b));
            continue;
        }
        // {h2: '...'}
        if (typeof b.h2 === 'string' && b.h2) {
            out.push({ type: 'h2', text: b.h2 });
            continue;
        }
        // {h2: {...}}
        if (b.h2 != null && typeof b.h2 === 'object') {
            const text = asDisplayString(b.h2.text ?? b.h2.content);
            if (text) {
                out.push({ type: 'h2', text });
                continue;
            }
        }
        // {list: {items:[...]}} 或 {list: [...]} 或 {items:[...]}
        if (b.list != null) {
            const items = Array.isArray(b.list) ? b.list : b.list?.items;
            out.push({
                type: 'list',
                items: (Array.isArray(items) ? items : []).map((it) => {
                    if (typeof it === 'string')
                        return it;
                    if (it && typeof it === 'object') {
                        return asDisplayString(it.text ?? it.name ?? it.label ?? it.item) || JSON.stringify(it);
                    }
                    return String(it ?? '');
                }).filter(Boolean),
            });
            continue;
        }
        if (Array.isArray(b.items)) {
            out.push({
                type: 'list',
                items: b.items.map((it) => {
                    if (typeof it === 'string')
                        return it;
                    if (it && typeof it === 'object') {
                        return asDisplayString(it.text ?? it.name ?? it.label ?? it.item) || JSON.stringify(it);
                    }
                    return String(it ?? '');
                }).filter(Boolean),
            });
            continue;
        }
        // {quote: '...', tone}
        if (typeof b.quote === 'string' && b.quote) {
            out.push({
                type: 'quote',
                text: b.quote,
                tone: b.tone === 'warn' ? 'warn' : 'info',
            });
            continue;
        }
        // {ad: '...', text?, link?, label?}
        if (typeof b.ad === 'string' || b.label != null || (b.text != null && b.link != null)) {
            const adText = b.ad != null && typeof b.ad === 'object'
                ? asDisplayString(b.ad.text ?? b.ad.content)
                : asDisplayString(b.ad);
            const labelText = b.label != null && typeof b.label === 'object'
                ? asDisplayString(b.label.text)
                : asDisplayString(b.label);
            const bodyText = b.text != null && typeof b.text === 'object'
                ? asDisplayString(b.text.text ?? b.text.content)
                : asDisplayString(b.text);
            out.push({
                type: 'ad',
                label: labelText || adText || '立即办理',
                text: bodyText || adText,
                link: typeof b.link === 'string' ? b.link : undefined,
            });
            continue;
        }
        // {price: ..., name?, desc?} — price 可能是嵌套对象
        if (b.price != null || b.name != null) {
            out.push(flattenPriceBlock(b));
            continue;
        }
        // {image: url} 或 {url} + alt/caption
        if (typeof b.image === 'string' && b.image) {
            out.push({ type: 'image', url: b.image, alt: b.alt, caption: b.caption });
            continue;
        }
        if (typeof b.url === 'string' && b.url && (b.alt != null || b.caption != null || b.type == null)) {
            // 无 type 且只有 url，可能是图片
            if (b.text == null && b.h2 == null) {
                out.push({ type: 'image', url: b.url, alt: b.alt, caption: b.caption });
                continue;
            }
        }
        // {text: '...'} 段落
        if (typeof b.text === 'string' && b.text) {
            out.push({ type: 'text', text: b.text });
            continue;
        }
        // {text: {...}} 段落对象
        if (b.text != null && typeof b.text === 'object') {
            const text = asDisplayString(b.text.text ?? b.text.content ?? b.text.value);
            if (text) {
                out.push({ type: 'text', text });
                continue;
            }
        }
        // 单字段字符串对象兜底：{foo:'bar'} → text
        const keys = Object.keys(b).filter((k) => b[k] != null && b[k] !== '');
        if (keys.length === 1 && typeof b[keys[0]] === 'string') {
            out.push({ type: 'text', text: String(b[keys[0]]) });
        }
        // 其他无法识别的块丢弃，避免页面 JSON 化 / [object Object]
    }
    return out;
}
