import type { Seed, SeedInput, GeneratedArticle, InsertResult, PipelineConfig, PipelineRunResult, TopicSuggestion, RunLogInput } from './types.js';
/** 可注入的 sleep 函数（Workers alarm 里需用 ctx.waitUntil） */
export type SleepFn = (ms: number) => Promise<void>;
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
