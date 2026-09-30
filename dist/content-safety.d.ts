import type { SafetyHit, SafetyResult, SafetyRule, ContentBlock, FaqItem, LinkItem } from './types.js';
/** 对一段文本做类别关键词扫描 */
export declare function scanText(text: string, rules?: SafetyRule[]): SafetyHit[];
/** 对文章整体扫描（标题/摘要/正文/FAQ/标签/链接） */
export declare function checkArticleSafety(input: {
    title?: string;
    summary?: string;
    content?: ContentBlock[] | string;
    faq?: FaqItem[] | string;
    tags?: string[] | string;
    links?: LinkItem[] | string;
    friendLinks?: Array<{
        name: string;
        url: string;
    }> | string;
}, extraRules?: SafetyRule[]): SafetyResult;
/**
 * 替换文本中的违规词为 ***（保留首字可读性）
 * 返回 { text: 替换后文本, replaced: 是否有替换发生 }
 */
export declare function replaceViolatingWords(text: string, rules?: SafetyRule[]): {
    text: string;
    replaced: boolean;
};
