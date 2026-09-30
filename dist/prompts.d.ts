/** 时间背景（AI 选题用：当前日期 + 近 45 天节日/节气 + 当月时令） */
export declare function dateContext(): string;
/** AI 系统提示词（引流文：干货主体 + 软文链接 + 自动分类） */
export declare function aiSystemPrompt(): string;
/** AI 自动选题提示词（素材池不足时补足） */
export declare function aiSuggestPrompt(): string;
