import { execute, type ExecutorConfig } from './executor.js';
export interface SiteRunnerConfig extends Omit<ExecutorConfig, 'cloudFallback' | 'getPublishedToday' | 'reportRun' | 'publishDueDrafts'> {
    /** 站点标识（日志前缀） */
    site: string;
    /** 线上站点 API 基址（如 https://www.wcbblll.cc） */
    adminBase: string;
    /** admin 密钥文件路径（内容为 MANAGE_KEY=xxx，自动剥前缀） */
    adminKeyFile?: string;
    /** 或直接传 admin 密钥明文（优先于 adminKeyFile） */
    adminKey?: string;
    /** 每天目标篇数（默认 3，与 executor 一致） */
    dailyTarget?: number;
    /** 云端兜底 API 路径（默认 /api/admin/run-daily-generate） */
    cloudEndpoint?: string;
    /** 云端兜底触发超时（毫秒，默认 15000：只触发不等结果，云端幂等防重） */
    cloudTriggerTimeoutMs?: number;
    /** 普通 API 请求超时（毫秒，默认 60000） */
    apiTimeoutMs?: number;
    /**
     * 优先发草稿：生成前先发布到期草稿（默认调线上 POST /api/admin/publish-due）。
     * false = 关闭；函数 = 自定义实现。发布数计入当日已发布口径，剩余目标由生成补足。
     */
    publishDueDrafts?: false | (() => Promise<number>);
    /** 到期草稿发布 API 路径（默认 /api/admin/publish-due） */
    publishDueEndpoint?: string;
}
export type SiteRunnerResult = Awaited<ReturnType<typeof execute>>;
/**
 * 统一每日发文入口：本地 AI 发文（网关自愈/模型轮换/互斥锁）→ 网关离线走云端 AI →
 * 未配云端 key 走线上兜底（触发式）。防重与日志统一内置。
 */
export declare function runScheduledGenerate(cfg: SiteRunnerConfig): Promise<SiteRunnerResult>;
