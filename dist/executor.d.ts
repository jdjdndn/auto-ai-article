import type { PipelineConfig, PipelineRunResult, RunLogInput } from './types.js';
import { type PipelineDB } from './pipeline.js';
export interface ExecutorConfig extends PipelineConfig {
    /** 每日目标发布篇数（默认 3） */
    dailyTarget?: number;
    /** 本地 AI 网关地址（默认 http://localhost:3456/v1） */
    localGateway?: string;
    /** 本地 AI 模型名称（默认 deepseek-chat） */
    localModel?: string;
    /** 云端 AI 模型（本地网关离线时兜底） */
    cloudModel?: string;
    /** dry-run 模式：只生成不入库 */
    dryRun?: boolean;
    /** 今日已发布篇数查询函数 */
    getPublishedToday?: () => Promise<number>;
    /** 今日是否已有本地成功运行记录（防重复发布） */
    hasLocalRunToday?: () => Promise<boolean>;
    /** 运行日志上报函数 */
    reportRun?: (log: RunLogInput) => Promise<void>;
    /** 自定义 logger（默认 console.log） */
    logger?: (...args: unknown[]) => void;
}
export interface ExecutorResult {
    mode: 'local' | 'cloud' | 'skipped';
    reason?: string;
    pipeline?: PipelineRunResult;
}
export declare function execute(db: PipelineDB, config?: ExecutorConfig): Promise<ExecutorResult>;
