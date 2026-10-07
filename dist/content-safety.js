"use strict";
// ============================================================
// 内容安全审核 — 从 article-site/server/utils/content-safety.ts 提取
// 轻量关键词扫描，支持「标草稿」和「替换违规词」两种处理模式。
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanText = scanText;
exports.checkArticleSafety = checkArticleSafety;
exports.replaceViolatingWords = replaceViolatingWords;
// 默认违规词规则
const DEFAULT_RULES = [
    {
        cat: 'porn',
        label: '色情低俗',
        words: ['色情', '淫秽', '裸聊', '约炮', '一夜情', '援交', '嫖娼', '卖淫', 'AV在线', '成人影片', '黄色网站', '福利姬', '裸贷'],
    },
    {
        cat: 'gambling',
        label: '赌博',
        words: ['赌博', '博彩', '六合彩', '时时彩', '赌球', '百家乐', '老虎机', '棋牌赚钱', '澳门赌场', '线上赌场', '下注返利'],
    },
    {
        cat: 'drug',
        label: '毒品',
        words: ['毒品', '冰毒', '海洛因', '大麻', '摇头丸', '止咳水', '笑气', '迷药', '催情水', '毒品代购'],
    },
    {
        cat: 'fraud',
        label: '诈骗引流',
        words: ['刷单返利', '杀猪盘', '电信诈骗', '虚假中奖', '兼职刷单', '博彩套利', '资金盘', '庞氏骗局', '拉人头返现', '高回报理财'],
    },
    {
        cat: 'weapon',
        label: '暴恐武器',
        words: ['枪支', '弹药', '自制炸药', '雷管', '管制刀具', '爆炸物制作', '恐怖袭击', '袭击教程', '杀伤性武器'],
    },
    {
        cat: 'illegal-trade',
        label: '违禁交易',
        words: ['违禁品', '走私', '代购处方药', '假币', '假证', '伪造证件', '发票代开', '枪支配件'],
    },
    {
        cat: 'minor',
        label: '未成年相关',
        words: ['未成年色情', '幼女', '恋童', '儿童色情', '未成年裸聊'],
    },
];
/**
 * 豁免上下文：违规词出现在这些词附近时视为正面提醒，不命中。
 * 例如"不要赌博"、"远离刷单诈骗"、"警惕杀猪盘"是正确的反诈提醒。
 */
const EXEMPT_PREFIXES = ['不要', '别', '远离', '警惕', '谨防', '小心', '切勿', '严禁', '禁止', '防范', '打击', '整治', '拒绝', '抵制', '反', '防'];
/** 对一段文本做类别关键词扫描 */
function scanText(text, rules = DEFAULT_RULES) {
    const hits = [];
    if (!text)
        return hits;
    for (const rule of rules) {
        for (const w of rule.words) {
            let idx = text.indexOf(w);
            let found = false;
            while (idx !== -1) {
                // 检查前面 10 个字符内是否有豁免词（"不要赌博""远离刷单"等正面提醒）
                const before = text.slice(Math.max(0, idx - 10), idx);
                const exempted = EXEMPT_PREFIXES.some(p => before.includes(p));
                if (!exempted) {
                    found = true;
                    break;
                }
                idx = text.indexOf(w, idx + w.length);
            }
            if (found) {
                hits.push({ cat: rule.cat, label: rule.label, word: w });
                break; // 每类最多记一个命中词
            }
        }
    }
    return hits;
}
/** 对文章整体扫描（标题/摘要/正文/FAQ/标签/链接） */
function checkArticleSafety(input, extraRules = []) {
    const rules = [...DEFAULT_RULES, ...extraRules];
    const texts = [];
    if (input.title)
        texts.push(input.title);
    if (input.summary)
        texts.push(input.summary);
    if (input.content != null) {
        const content = typeof input.content === 'string' ? safeParse(input.content) : input.content;
        if (Array.isArray(content)) {
            for (const block of content) {
                if (!block || typeof block !== 'object')
                    continue;
                if (typeof block.text === 'string')
                    texts.push(block.text);
                if (Array.isArray(block.items))
                    texts.push(block.items.join(' '));
                if (typeof block.label === 'string')
                    texts.push(block.label);
                if (typeof block.url === 'string')
                    texts.push(block.url);
                if (typeof block.caption === 'string')
                    texts.push(block.caption);
                if (typeof block.alt === 'string')
                    texts.push(block.alt);
            }
        }
        else if (typeof content === 'string') {
            texts.push(content);
        }
    }
    // FAQ
    const faqArr = safeArr(input.faq);
    for (const f of faqArr) {
        if (typeof f?.q === 'string')
            texts.push(f.q);
        if (typeof f?.a === 'string')
            texts.push(f.a);
    }
    // 标签
    for (const t of safeArr(input.tags)) {
        if (typeof t === 'string')
            texts.push(t);
    }
    // 链接
    for (const l of safeArr(input.links)) {
        if (typeof l?.label === 'string')
            texts.push(l.label);
        if (typeof l?.url === 'string')
            texts.push(l.url);
    }
    for (const f of safeArr(input.friendLinks)) {
        if (typeof f?.name === 'string')
            texts.push(f.name);
        if (typeof f?.url === 'string')
            texts.push(f.url);
    }
    const seen = new Map();
    for (const t of texts) {
        for (const h of scanText(t, rules)) {
            if (!seen.has(h.cat))
                seen.set(h.cat, h);
        }
    }
    const hits = [...seen.values()];
    return { ok: hits.length === 0, hits };
}
/**
 * 替换文本中的违规词为 ***（保留首字可读性）
 * 返回 { text: 替换后文本, replaced: 是否有替换发生 }
 */
function replaceViolatingWords(text, rules = DEFAULT_RULES) {
    if (!text)
        return { text, replaced: false };
    let result = text;
    let replaced = false;
    for (const rule of rules) {
        for (const w of rule.words) {
            let idx = result.indexOf(w);
            while (idx !== -1) {
                // 豁免上下文："不要赌博"不替换
                const before = result.slice(Math.max(0, idx - 10), idx);
                if (EXEMPT_PREFIXES.some(p => before.includes(p))) {
                    idx = result.indexOf(w, idx + w.length);
                    continue;
                }
                const mask = w[0] + '*'.repeat(Math.max(0, w.length - 1));
                result = result.slice(0, idx) + mask + result.slice(idx + w.length);
                replaced = true;
                idx = result.indexOf(w, idx + mask.length);
            }
        }
    }
    return { text: result, replaced };
}
function safeParse(s) {
    try {
        return JSON.parse(s);
    }
    catch {
        return [];
    }
}
function safeArr(v) {
    if (Array.isArray(v))
        return v;
    if (typeof v === 'string') {
        try {
            const p = JSON.parse(v);
            return Array.isArray(p) ? p : [];
        }
        catch {
            return [];
        }
    }
    return [];
}
