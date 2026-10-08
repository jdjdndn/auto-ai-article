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
export declare function aggregateStats(logs: RunLogEntry[]): StatSummary;
export declare function renderStatsMarkdown(summary: StatSummary): string;
