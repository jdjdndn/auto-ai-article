"use strict";
// ============================================================
// 工具函数 — 从 article-site/shared/ai-utils.mjs + content.ts 提取
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.articleCss = void 0;
exports.firstNonEmpty = firstNonEmpty;
exports.extractJson = extractJson;
exports.asAnyArray = asAnyArray;
exports.safeJson = safeJson;
exports.normalizeJson = normalizeJson;
exports.firstImageOf = firstImageOf;
exports.normalizeContentBlocks = normalizeContentBlocks;
exports.escapeHtml = escapeHtml;
exports.generateToc = generateToc;
exports.readingTime = readingTime;
exports.renderArticleBlocks = renderArticleBlocks;
exports.renderArticleCta = renderArticleCta;
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
    // 注意：只在最外层没有半角 [] 时才尝试全角，避免破坏 JSON 字符串里的全角括号
    let arrStart = t.indexOf('[');
    let arrEnd = t.lastIndexOf(']');
    if (!(arrStart >= 0 && arrEnd > arrStart)) {
        // 找全角括号，且它们必须包裹整个 JSON 内容（前后无其他字符）
        const fwStart = t.indexOf('［');
        const fwEnd = t.lastIndexOf('］');
        if (fwStart === 0 && fwEnd > 0 && fwEnd === t.length - 1) {
            t = '[' + t.slice(1, -1) + ']';
            arrStart = 0;
            arrEnd = t.length - 1;
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
// ============================================================
// 前端渲染：blocks → HTML 字符串（Nuxt v-html 调用）
// ============================================================
/** 文章页配套 CSS（TOC + block 排版，v-html 渲染用，各站用 useHead 注入） */
exports.articleCss = `
/* TOC 目录 */
.article-toc {
  background: var(--primary-weak, #eff6ff);
  border: 1px solid #dbeafe;
  border-radius: 10px;
  padding: 12px 16px;
  margin-bottom: 20px;
  font-size: 14px;
}
.article-toc .toc-title {
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
  list-style: none;
}
.article-toc .toc-title::-webkit-details-marker { display: none; }
.article-toc ul { list-style: none; padding: 0; margin: 8px 0 0; }
.article-toc li { padding: 3px 0; }
.article-toc a { color: var(--primary); text-decoration: none; line-height: 1.5; }
.article-toc a:hover { text-decoration: underline; }
.block-h2 { scroll-margin-top: 80px; }
@media (max-width: 767px) {
  .article-toc .toc-title::after { content: '\\25B8'; float: right; transition: transform .2s; }
  .article-toc[open] .toc-title::after { transform: rotate(90deg); }
}

/* block 排版 */
.text-block { margin-bottom: 14px; line-height: 1.85; color: var(--text); font-size: 15px; }
.block-h2 { font-size: 18px; margin: 26px 0 12px; padding: 4px 0 8px 12px; border-left: 4px solid var(--primary, #2563eb); color: var(--text); }
.block-list { margin: 12px 0; }
.list-item { padding: 6px 0 6px 20px; position: relative; color: var(--text); font-size: 14px; margin: 0; }
.list-item::before { content: '•'; position: absolute; left: 4px; color: var(--primary, #2563eb); font-weight: 700; }
.block-price { display: flex; align-items: baseline; gap: 12px; background: linear-gradient(135deg, #fff7e6, #fffbe8); border: 1px solid #fde68a; border-radius: 12px; padding: 14px 18px; margin: 16px 0; }
.block-price .price { font-size: 28px; font-weight: 700; color: #dc2626; }
.block-price .original { color: #b6bcc6; text-decoration: line-through; font-size: 14px; }
.block-price .spec { color: var(--text-muted, #64748b); font-size: 13px; }
.block-quote { border-radius: 10px; padding: 12px 16px; margin: 16px 0; font-size: 14px; line-height: 1.75; }
.block-quote.warn { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; }
.block-quote.info { background: var(--primary-weak, #eff6ff); border: 1px solid #bfdbfe; color: #1d4ed8; }
.block-image { margin: 16px 0; }
.block-image img { width: 100%; border-radius: 12px; display: block; }
.block-image figcaption { font-size: 12px; color: var(--text-muted, #94a3b8); margin-top: 6px; text-align: center; }

/* ad block */
.ad-block { background: #fffbeb; border: 1px dashed #fcd34d; border-radius: 10px; padding: 12px 16px; margin: 12px 0; font-size: 14px; }
.ad-block .ad-label { display: inline-block; background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; font-size: 11px; padding: 1px 10px; border-radius: 999px; margin-bottom: 6px; }
.ad-block p { margin: 0 0 6px; }
.ad-block .ad-link { display: inline-block; margin-top: 6px; font-weight: 600; color: var(--primary, #2563eb); text-decoration: none; }

/* CTA 卡片 */
.article-cta { margin-bottom: 22px; padding: 28px 24px; text-align: center; background: linear-gradient(135deg, #f0f9ff, #e0f2fe); border: 1px solid #bae6fd; border-radius: 10px; }
.article-cta h2 { font-size: 18px; margin-bottom: 8px; color: var(--text); }
.article-cta p { color: var(--text-muted, #64748b); font-size: 14px; margin-bottom: 18px; }
.article-cta .cta-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
.btn-primary-cta { display: inline-block; padding: 12px 28px; background: linear-gradient(180deg, var(--primary, #2563eb), var(--primary-strong, #1d4ed8)); color: #fff; border-radius: 10px; text-decoration: none; font-size: 15px; font-weight: 600; transition: opacity .2s; }
.btn-primary-cta:hover { opacity: .9; }
.btn-secondary-cta { display: inline-block; padding: 12px 28px; background: #fff; color: var(--primary, #2563eb); border: 1px solid var(--primary, #2563eb); border-radius: 10px; text-decoration: none; font-size: 15px; font-weight: 600; transition: background .2s; }
.btn-secondary-cta:hover { background: var(--primary-weak, #eff6ff); }
`;
/** HTML 转义，防 XSS */
function escapeHtml(v) {
    if (v == null)
        return '';
    return String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
/** 从 blocks 提取 h2 生成 TOC 目录（≥3 个 h2 才输出），用 <details> 小屏折叠 */
function generateToc(blocks) {
    if (!Array.isArray(blocks))
        return '';
    const headings = blocks
        .filter((b) => b?.type === 'h2' && typeof b.text === 'string' && b.text.trim())
        .map((b, i) => ({ text: b.text.trim(), id: `h2-${i}` }));
    if (headings.length < 3)
        return '';
    return `<details class="article-toc"><summary class="toc-title">本文目录</summary><ul>` +
        headings.map((h) => `<li><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`).join('') +
        `</ul></details>`;
}
/** 估算阅读时长（中文 300 字/分钟），返回分钟数 */
function readingTime(blocks) {
    if (!Array.isArray(blocks))
        return 0;
    let chars = 0;
    for (const b of blocks) {
        if (typeof b?.text === 'string')
            chars += b.text.length;
        if (Array.isArray(b?.items)) {
            b.items.forEach((i) => { if (typeof i === 'string')
                chars += i.length; });
        }
    }
    return Math.max(1, Math.round(chars / 300));
}
/** 渲染单个 block 为 HTML 字符串（内部，不导出） */
function renderBlock(block, h2Idx) {
    if (!block || typeof block !== 'object')
        return '';
    switch (block.type) {
        case 'h2': {
            const id = `h2-${h2Idx.i++}`;
            return `<h2 id="${id}" class="block-h2">${escapeHtml(block.text)}</h2>`;
        }
        case 'text':
            return `<p class="text-block">${escapeHtml(block.text)}</p>`;
        case 'list':
            return `<div class="block-list">${(block.items || [])
                .map((item) => `<p class="list-item">${escapeHtml(item)}</p>`)
                .join('')}</div>`;
        case 'price':
            return `<div class="block-price"><span class="price">¥${escapeHtml(block.price)}</span>` +
                (block.original ? `<span class="original">¥${escapeHtml(block.original)}</span>` : '') +
                (block.spec ? `<span class="spec">${escapeHtml(block.spec)}</span>` : '') +
                `</div>`;
        case 'quote':
            return `<div class="block-quote ${block.tone === 'warn' ? 'warn' : 'info'}">${escapeHtml(block.text)}</div>`;
        case 'image': {
            const url = block.url || '';
            if (/example\.com|test\.com|placeholder/.test(url))
                return ''; // 占位图丢弃
            return `<figure class="block-image"><img src="${escapeHtml(url)}" alt="${escapeHtml(block.alt || '')}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'" />` +
                `<figcaption>${block.caption ? escapeHtml(block.caption) + ' · ' : ''}图源：网络</figcaption></figure>`;
        }
        case 'video': {
            const url = block.url || '';
            if (/example\.com|test\.com|placeholder/.test(url))
                return '';
            return `<figure class="block-image"><video src="${escapeHtml(url)}" controls preload="metadata" style="width:100%;border-radius:12px;display:block"></video>` +
                (block.title ? `<figcaption>${escapeHtml(block.title)}</figcaption>` : '') +
                `</figure>`;
        }
        case 'ad': {
            // 占位链接的 ad block 整个丢弃
            if (block.link && /example\.com|test\.com|placeholder|yourlink/.test(block.link))
                return '';
            return `<div class="ad-block"><span class="ad-label">${escapeHtml(block.label || '推荐')}</span>` +
                `<p>${escapeHtml(block.text)}</p>` +
                (block.link ? `<a href="${escapeHtml(block.link)}" target="_blank" rel="noopener nofollow" class="ad-link">去看看 →</a>` : '') +
                `</div>`;
        }
        default:
            return '';
    }
}
/** 渲染整个 content blocks 数组为 HTML 字符串（自动加 TOC） */
function renderArticleBlocks(blocks) {
    if (!Array.isArray(blocks))
        return '';
    const h2Idx = { i: 0 };
    const body = blocks.map((b) => renderBlock(b, h2Idx)).join('');
    const toc = generateToc(blocks);
    return toc + body;
}
/** 渲染底部 CTA 卡片 HTML（文案全可配置） */
function renderArticleCta(config) {
    const title = escapeHtml(config?.title || '想办一张高性价比套餐？');
    const description = escapeHtml(config?.description || '');
    const primaryLabel = escapeHtml(config?.primaryLabel || '立即办理');
    const primaryUrl = escapeHtml(config?.primaryUrl || '#');
    let html = `<section class="article-cta card"><h2>${title}</h2>`;
    if (description)
        html += `<p>${description}</p>`;
    html += `<div class="cta-actions">`;
    html += `<a href="${primaryUrl}" target="_blank" rel="noopener" class="btn-primary-cta">${primaryLabel}</a>`;
    if (config?.secondaryLabel && config?.secondaryUrl) {
        html += `<a href="${escapeHtml(config.secondaryUrl)}" target="_blank" rel="noopener" class="btn-secondary-cta">${escapeHtml(config.secondaryLabel)}</a>`;
    }
    html += `</div></section>`;
    return html;
}
