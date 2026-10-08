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
exports.renderArticleLinks = renderArticleLinks;
exports.renderFaqSection = renderFaqSection;
exports.renderRelatedArticles = renderRelatedArticles;
exports.renderShareBar = renderShareBar;
exports.articleJsonLd = articleJsonLd;
exports.organizationJsonLd = organizationJsonLd;
exports.websiteJsonLd = websiteJsonLd;
exports.productJsonLd = productJsonLd;
exports.faqJsonLd = faqJsonLd;
exports.flattenToStrings = flattenToStrings;
exports.flattenFaq = flattenFaq;
exports.flattenLinks = flattenLinks;
exports.safeArticle = safeArticle;
exports.initArticleActions = initArticleActions;
exports.cnTodayStartISO = cnTodayStartISO;
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

/* ad block（主题变量：--ad-bg/--ad-border/--ad-color/--ad-label-bg） */
.ad-block { background: var(--ad-bg, #fffbeb); border: 1px dashed var(--ad-border, #fcd34d); border-radius: 10px; padding: 12px 16px; margin: 12px 0; font-size: 14px; }
.ad-block .ad-label { display: inline-block; background: var(--ad-label-bg, linear-gradient(135deg, #f59e0b, #d97706)); color: #fff; font-size: 11px; padding: 1px 10px; border-radius: 999px; margin-bottom: 6px; }
.ad-block p { margin: 0 0 6px; color: var(--ad-color, inherit); }
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

/* 链接区 */
.article-links { margin: 20px 0; }
.article-links .ad-note { display: block; font-size: 12px; color: var(--text-muted, #94a3b8); margin-bottom: 10px; }
.article-links .ad-badge { background: #fef3c7; color: #92400e; font-size: 11px; padding: 1px 8px; border-radius: 4px; margin-right: 4px; }
.article-links .link-btn { display: inline-block; padding: 10px 24px; background: linear-gradient(180deg, var(--primary, #2563eb), var(--primary-strong, #1d4ed8)); color: #fff; border-radius: 10px; text-decoration: none; font-size: 14px; font-weight: 500; margin-right: 8px; margin-bottom: 8px; }
.article-links .more-wrap { margin-top: 8px; }
.article-links .more-toggle { background: none; border: none; color: var(--primary, #2563eb); cursor: pointer; font-size: 13px; text-decoration: underline; }
.article-links .more-list { margin-top: 8px; }
.article-links .more-list .more-link { display: block; padding: 6px 0; color: var(--primary, #2563eb); text-decoration: none; font-size: 13px; }

/* FAQ */
.article-faq { margin: 22px 0; padding: 20px 24px; background: var(--card-bg, #fff); border-radius: 10px; }
.article-faq h2 { font-size: 17px; margin-bottom: 10px; }
.article-faq details { border-radius: 10px; padding: 4px 10px; margin: 8px 0; }
.article-faq details[open] { background: #f9fafb; }
.article-faq summary { cursor: pointer; font-weight: 600; padding: 8px 2px; }
.article-faq details p { color: var(--text-muted, #64748b); margin: 2px 0 10px 18px; font-size: 14px; }

/* 相关文章 */
.article-related { margin: 22px 0; padding: 20px 24px; background: var(--card-bg, #fff); border: 1px solid var(--border, #e5e7eb); border-radius: 10px; }
.article-related .rel-title { font-size: 17px; font-weight: 600; margin-bottom: 12px; }
.article-related .rel-list { display: flex; flex-direction: column; gap: 8px; }
.article-related .rel-link { color: var(--primary, #2563eb); font-size: 14px; line-height: 1.5; text-decoration: none; }
.article-related .rel-link:hover { text-decoration: underline; }

/* 分享栏 */
.share-bar { display: flex; gap: 12px; justify-content: center; margin: 20px 0; }
.share-bar .share-btn { padding: 8px 20px; background: #fff; border: 1px solid var(--primary, #2563eb); color: var(--primary, #2563eb); border-radius: 10px; cursor: pointer; font-size: 13px; }
.share-bar .share-btn:hover { background: var(--primary-weak, #eff6ff); }
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
/** 渲染推广链接区（主按钮常显 + 更多折叠，opts 可覆盖全部文案/样式） */
function renderArticleLinks(links, opts = {}) {
    if (!Array.isArray(links) || !links.length)
        return '';
    const main = links.filter((l) => l.kind !== 'more');
    const more = links.filter((l) => l.kind === 'more');
    const note = opts.note || '以下链接为第三方推广，请按需理性消费';
    const btnClass = opts.primaryClass || 'link-btn';
    const moreText = opts.moreText || '展开更多';
    const adLabel = opts.adLabel || '广告';
    let html = `<div class="article-links">`;
    if (!opts.hideNote)
        html += `<span class="ad-note"><b class="ad-badge">${escapeHtml(adLabel)}</b>${escapeHtml(note)}</span>`;
    for (const l of main) {
        if (!l.url || /example\.com|test\.com/.test(l.url))
            continue;
        html += `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener nofollow sponsored noreferrer" class="${btnClass}" data-track-click="${escapeHtml(l.id ? String(l.id) : '')}">${escapeHtml(l.label || '立即办理')}</a>`;
    }
    if (more.length) {
        html += `<div class="more-wrap"><button class="more-toggle" data-action="toggle-more">${escapeHtml(moreText)}（${more.length}）</button><div class="more-list" hidden>`;
        for (const l of more) {
            if (!l.url || /example\.com|test\.com/.test(l.url))
                continue;
            html += `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener nofollow sponsored noreferrer" class="more-link" data-track-click="${escapeHtml(l.id ? String(l.id) : '')}">${escapeHtml(l.label || '')}</a>`;
        }
        html += `</div></div>`;
    }
    html += `</div>`;
    return html;
}
/** 渲染 FAQ 面板（opts.mode='collapse' 折叠默认 / 'expand' 全展开） */
function renderFaqSection(faq, opts = {}) {
    if (!Array.isArray(faq) || !faq.length)
        return '';
    const title = opts.title || '常见问题';
    const mode = opts.mode || 'collapse';
    let html = `<section class="article-faq"><h2>${escapeHtml(title)}</h2>`;
    for (const f of faq) {
        if (!f?.q || !f?.a)
            continue;
        if (mode === 'expand') {
            html += `<div class="faq-item"><h3>${escapeHtml(f.q)}</h3><p>${escapeHtml(f.a)}</p></div>`;
        }
        else {
            html += `<details><summary>${escapeHtml(f.q)}</summary><p>${escapeHtml(f.a)}</p></details>`;
        }
    }
    html += `</section>`;
    return html;
}
/** 相关文章（related 列表渲染；数据由 computeRelatedArticles 计算或 API related_ids 提供） */
function renderRelatedArticles(related, opts = {}) {
    if (!Array.isArray(related) || !related.length)
        return '';
    const title = opts.title || '相关文章';
    const items = related
        .filter((r) => r?.id && r?.title)
        .map((r) => `<a class="rel-link" href="/article/${encodeURIComponent(r.id)}">${escapeHtml(r.title)}</a>`)
        .join('');
    if (!items)
        return '';
    return `<section class="article-related"><h2 class="rel-title">${escapeHtml(title)}</h2><div class="rel-list">${items}</div></section>`;
}
function renderShareBar(article, opts = {}) {
    const url = opts.shareUrl || '';
    return `<div class="share-bar">
    <button class="share-btn" data-action="copy-link" data-url="${escapeHtml(url)}" data-title="${escapeHtml(article.title)}" data-summary="${escapeHtml(article.summary || '')}">复制链接</button>
    <button class="share-btn" data-action="report">内容有误？反馈</button>
  </div>`;
}
/** 生成 Article + FAQPage JSON-LD 结构化数据（SEO/GEO） */
function articleJsonLd(article, site) {
    const articleUrl = `${site.url}/article/${article.id}`;
    const cover = article.firstImage || `${site.url}/favicon.ico`;
    const ld = [{
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: article.title,
            description: article.summary,
            url: articleUrl,
            image: cover,
            datePublished: article.createdAt,
            dateModified: article.updatedAt || article.createdAt,
            articleSection: article.category || '',
            keywords: article.tags?.join(',') || '',
            author: { '@type': 'Organization', name: site.name, url: site.url },
            publisher: {
                '@type': 'Organization',
                name: site.name,
                logo: { '@type': 'ImageObject', url: site.logo || cover },
            },
            mainEntityOfPage: { '@type': 'WebPage', '@id': articleUrl },
        }];
    if (article.faq?.length) {
        ld.push({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: article.faq.map((f) => ({
                '@type': 'Question',
                name: f.q,
                acceptedAnswer: { '@type': 'Answer', text: f.a },
            })),
        });
    }
    return JSON.stringify(ld);
}
// ============================================================
// SEO JSON-LD 通用函数（参数化站点信息）
// ============================================================
/** Organization JSON-LD */
function organizationJsonLd(site) {
    return {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: site.name,
        description: site.description,
        url: site.url || undefined,
        sameAs: site.sameAs?.length ? site.sameAs : undefined,
    };
}
/** WebSite JSON-LD */
function websiteJsonLd(site) {
    return {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: site.name,
        description: site.description,
        url: site.url || undefined,
        inLanguage: 'zh-CN',
    };
}
/** Product JSON-LD */
function productJsonLd(product) {
    return {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: product.name,
        description: product.description,
        image: product.image || undefined,
        brand: { '@type': 'Brand', name: product.brand || product.name },
        ...(product.price ? { offers: { '@type': 'Offer', price: product.price, priceCurrency: 'CNY' } } : {}),
    };
}
/** FAQPage JSON-LD */
function faqJsonLd(items) {
    if (!items?.length)
        return null;
    return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: items.map((item) => ({
            '@type': 'Question',
            name: item.q,
            acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
    };
}
// ============================================================
// 文章数据安全解析（server 端用：DB 行 → 安全对象）
// ============================================================
/** 安全 JSON 解析（失败返回 []） */
function flattenToStrings(v) {
    if (Array.isArray(v))
        return v;
    if (typeof v === 'string') {
        try {
            const parsed = JSON.parse(v);
            return Array.isArray(parsed) ? parsed : [];
        }
        catch {
            return [];
        }
    }
    return [];
}
/** 安全解析 FAQ（[{q,a}]） */
function flattenFaq(v) {
    const arr = flattenToStrings(v);
    return arr.filter((f) => f?.q && f?.a);
}
/** 安全解析链接（[{label,url,kind}]） */
function flattenLinks(v) {
    const arr = flattenToStrings(v);
    return arr.filter((l) => l?.url);
}
/** 安全解析文章行（content/links/faq 可能是 JSON 字符串或对象） */
function safeArticle(row) {
    return {
        ...row,
        content: flattenToStrings(row.content),
        links: flattenLinks(row.links),
        faq: flattenFaq(row.faq),
    };
}
/**
 * 客户端事件委托绑定（仅浏览器环境调用）
 * 绑定：更多折叠 / 复制链接 / 纠错按钮
 * opts: { reportUrl?: string, onTrackClick?: (linkId) => void }
 */
function initArticleActions(root = document, opts = {}) {
    if (typeof document === 'undefined')
        return;
    // 更多折叠
    root.addEventListener('click', (e) => {
        const t = e.target;
        if (t.matches?.('[data-action="toggle-more"]')) {
            const list = t.parentElement?.querySelector('.more-list');
            if (list)
                list.toggleAttribute('hidden');
            t.textContent = list?.hasAttribute('hidden')
                ? `${t.textContent?.replace(/（.*?）/, '').trim()}`
                : '收起';
        }
    });
    // 复制链接
    root.addEventListener('click', async (e) => {
        const t = e.target;
        if (t.matches?.('[data-action="copy-link"]')) {
            const url = t.getAttribute('data-url') || location.href;
            const title = t.getAttribute('data-title') || document.title;
            const text = `${title}\n${url}`;
            try {
                await navigator.clipboard.writeText(text);
                t.textContent = '已复制';
                setTimeout(() => (t.textContent = '复制链接'), 2000);
            }
            catch { /* 忽略 */ }
        }
    });
    // 纠错
    root.addEventListener('click', (e) => {
        const t = e.target;
        if (t.matches?.('[data-action="report"]')) {
            const url = opts.reportUrl || '/report';
            window.open(url, '_blank', 'noopener');
        }
    });
    // 点击追踪
    if (opts.onTrackClick) {
        root.addEventListener('click', (e) => {
            const t = e.target.closest?.('[data-track-click]');
            if (t)
                opts.onTrackClick(t.getAttribute('data-track-click') || '');
        });
    }
}
// —— 时区 ——
/**
 * 北京时间"今天"0 点对应的 UTC ISO 字符串。
 * 统一"今日已发布/今日创建"的日界口径：北京 2026-10-08 00:00 = UTC 2026-10-07T16:00:00.000Z。
 * 所有站点防重（getPublishedToday / publishedTodayCount / hasLocalRunToday）共用，避免
 * 直接用北京日期前缀（'YYYY-MM-DD' 字符串比较）漏掉 UTC 昨天但北京今天 8 点前发布的文章。
 */
function cnTodayStartISO() {
    const now = new Date();
    const cnDate = new Date(now.getTime() + 8 * 3600e3).toISOString().slice(0, 10); // 北京今天日期
    const [y, m, d] = cnDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d) - 8 * 3600e3).toISOString();
}
