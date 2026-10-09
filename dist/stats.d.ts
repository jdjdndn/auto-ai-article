export interface RunLogEntry {
    project: string;
    provider: string;
    success: boolean;
    wordCount: number;
    durationMs: number;
    tokensUsed?: number;
    failReason?: string;
    timestamp: string;
}
export interface StatSummary {
    totalRuns: number;
    successRate: number;
    failReasons: Array<{
        reason: string;
        count: number;
    }>;
    providerStats: Array<{
        provider: string;
        runs: number;
        successRate: number;
        avgDurationMs: number;
        avgTokens: number;
    }>;
    projectStats: Array<{
        project: string;
        runs: number;
        successRate: number;
    }>;
    dailyTrend: Array<{
        date: string;
        runs: number;
        successRate: number;
    }>;
}
export declare function aggregateStats(logs: RunLogEntry[], filter?: {
    from?: string;
    to?: string;
    project?: string;
}): StatSummary;
export declare function renderStatsMarkdown(summary: StatSummary): string;
/**
 * 将 RunLogInput（管线运行日志）转换为 RunLogEntry（统计聚合输入）。
 * 缺失字段以合理默认值填充。
 */
export declare function fromRunLogInput(input: import('./types.js').RunLogInput, project?: string): RunLogEntry;
export declare function exportStatsCsv(summary: StatSummary): string;
export declare function exportStatsJson(summary: StatSummary): string;
/**
 * 生成独立 HTML 运营面板（纯 HTML + 内联 CSS，无外部依赖）。
 * 可直接写入 .html 文件用浏览器打开，或作为 HTTP 响应体返回。
 */
export declare function renderStatsHtml(summary: StatSummary, title?: string, alertInfo?: {
    threshold?: number;
    webhookConfigured?: boolean;
    lastTriggered?: string;
}): string;
