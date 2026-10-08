import type { PipelineConfig, PipelineRunResult, RunLogInput } from './types.js';
import { type PipelineDB } from './pipeline.js';
import type { LocalGatewayProbe } from './local-gateway.js';
export type { LocalGatewayProbe };
export interface ExecutorConfig extends PipelineConfig {
    /** 每日目标发布篇数（默认 3） */
    dailyTarget?: number;
    /**
     * 生成前先发布到期草稿（"优先发草稿"：先发布 publishAt 已到期的 draft，返回本次发布数）。
     * 在当日防重统计之前调用，发布数计入 getPublishedToday 的"今日已发布"口径，
     * 剩余目标（dailyTarget - 已发布）由生成补足。缺省不启用（行为不变）。
     */
    publishDueDrafts?: () => Promise<number>;
    /** 本地 AI 网关地址（默认 http://localhost:3456/v1） */
    localGateway?: string;
    /** 本地 AI 模型名称（默认 deepseek-chat） */
    localModel?: string;
    /**
     * 本地候选模型（按优先级轮换；缺省仅用 localModel，行为不变）。
     * 网关某个模型/会话不可用（网络错误/HTTP 4xx/5xx）时自动尝试下一个。
     * 示例：['deepseek-chat', 'deepseek-reasoner', 'kimi']
     */
    localModels?: string[];
    /** 云端 AI 模型（本地网关离线时兜底） */
    cloudModel?: string;
    /**
     * 本地发文互斥锁文件（跨进程/跨站共享；多站同机用本地网关时串行化，避免并发打网关）。
     * 各站配置**同一路径**即可全局互斥：后到站等待 localLockWaitMs，超时则本轮跳过（由各站云端 alarm 兜底）。
     * 缺省不启用，行为不变。
     */
    localLockFile?: string;
    /** 等待互斥锁的最长时间（毫秒，默认 180000；0 = 不等待直接跳过） */
    localLockWaitMs?: number;
    /** 互斥锁视为过期的最长时间（毫秒，默认 1800000=30min，防异常退出残留锁） */
    localLockStaleMs?: number;
    /** 本地 AI 单次请求超时（毫秒，默认 280000，对齐 TFG requestTimeoutSec=300 减余量） */
    localTimeoutMs?: number;
    /** 本地网关离线时的自愈拉起命令（如 auto-start.ps1；空则不拉起） */
    localGatewayStartCommand?: string;
    /** 网关 degraded（browser disconnected）时拉起浏览器命令（如 `chrome start`；空则只提示） */
    localChromeStartCommand?: string;
    /** 执行拉起命令后的等待/重探测时间（毫秒，默认 45000） */
    autoStartWaitMs?: number;
    /**
     * 本地离线且未配置云端 AI key 时的整轮兜底钩子（如调线上 /api/admin/run-daily-generate）。
     * 返回后视为已处理，不再本地生成，也**不**再本地上报 run-logs（由兜底实现方负责）。
     * 缺省时保持原 skip 行为。
     */
    cloudFallback?: (ctx: {
        localGateway: string;
        dryRun: boolean;
    }) => Promise<{
        ok: boolean;
        message?: string;
    } | void>;
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
    mode: 'local' | 'cloud' | 'cloud-fallback' | 'skipped';
    reason?: string;
    pipeline?: PipelineRunResult;
}
export declare function execute(db: PipelineDB, config?: ExecutorConfig): Promise<ExecutorResult>;
