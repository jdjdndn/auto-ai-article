export declare function extractJson(text: string): unknown;
/** 安全 JSON 解析 */
export declare function safeJson(s: string | null | undefined, fallback?: unknown): unknown;
/** JSON 字段归一化：任意值 → 紧凑 JSON 字符串；空 → '[]' */
export declare function normalizeJson(v: unknown): string | null;
/** 从 content 块数组提取第一个 image 块 URL */
export declare function firstImageOf(content: unknown): string;
