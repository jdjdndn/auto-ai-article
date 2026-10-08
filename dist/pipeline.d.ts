import type { Seed, SeedInput, GeneratedArticle, InsertResult, PipelineConfig, PipelineRunResult, TopicSuggestion, RunLogInput } from './types.js';
/** 可注入的 sleep 函数（Workers alarm 里需用 ctx.waitUntil） */
export type SleepFn = (ms: number) => Promise<void>;
/**
 * 通用重试工具（公共导出，本地/云端 AI client 复用）：
 * - fn(attempt)：第 attempt 次尝试（0 起），可用于模型轮换
 * - retries：额外重试次数（总尝试 retries+1）
 * - delaysMs：各次重试前的等待间隔；缺省 1s×(i+1) 递增（保持旧行为）
 */
export declare function withRetry<T>(fn: (attempt: number) => Promise<T>, retries: number, label: string, sleep?: SleepFn, delaysMs?: number[]): Promise<T>;
export interface Pipeline {
    /** AI 自动选题（返回选题列表，不入库） */
    suggestTopics(): Promise<TopicSuggestion[]>;
    /** 单条素材 → AI 生成文章（不做安全检查，不入库） */
    generateArticle(raw: string, opts?: {
        category?: string;
        template?: string;
    }): Promise<GeneratedArticle>;
    /** 完整管线：拉取种子 → 选题补足 → 生成 → 安全检查 → 入库 */
    run(): Promise<PipelineRunResult>;
}
export interface PipelineDB {
    fetchPendingSeeds(size: number): Promise<Seed[]>;
    insertSeeds(items: SeedInput[], source: string): Promise<{
        added: number;
    }>;
    markSeedDone(id: number, articleId: string): Promise<void>;
    markSeedFailed(id: number, error: string): Promise<void>;
    insertArticles(articles: GeneratedArticle[]): Promise<InsertResult>;
    insertRunLog(log: RunLogInput): Promise<void>;
}
export declare function createPipeline(db: PipelineDB, config?: PipelineConfig): Pipeline;
