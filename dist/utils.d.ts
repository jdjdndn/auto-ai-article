import type { ContentBlock } from './types.js';
/** 从候选字段中取第一个非空字符串（空串不能短路，否则会丢掉后面的真实内容） */
export declare function firstNonEmpty(...vals: unknown[]): string;
export declare function extractJson(text: string): unknown;
/** 从解析结果中尽可能取出数组列表（topics/list/items/data/result 等常见包装） */
export declare function asAnyArray(parsed: unknown): unknown[] | null;
/** 安全 JSON 解析 */
export declare function safeJson(s: string | null | undefined, fallback?: unknown): unknown;
/** JSON 字段归一化：任意值 → 紧凑 JSON 字符串；空 → '[]' */
export declare function normalizeJson(v: unknown): string | null;
/** 从 content 块数组提取第一个 image 块 URL */
export declare function firstImageOf(content: unknown): string;
/** 把 AI 松散 content 块归一化为标准 {type,...} 结构，禁止缺 type 的对象入库 */
export declare function normalizeContentBlocks(raw: unknown): ContentBlock[];
