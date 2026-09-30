import { type ExecutorConfig } from './executor.js';
/** 调度器配置 */
export interface SchedulerConfig {
    /** 目标时间（如 "08:00"），默认 "08:00" */
    time?: string;
    /** 执行器配置 */
    executorConfig?: ExecutorConfig;
}
/**
 * ArticleScheduler — Durable Object class
 *
 * 使用方式（在 Worker 入口文件中）：
 * ```ts
 * export { ArticleScheduler } from 'ai-article-pipeline'
 * ```
 *
 * wrangler.jsonc 配置：
 * ```json
 * {
 *   "durable_objects": {
 *     "bindings": [{ "name": "ARTICLE_SCHEDULER", "class_name": "ArticleScheduler" }]
 *   },
 *   "migrations": [{ "tag": "v1", "new_classes": ["ArticleScheduler"] }]
 * }
 * ```
 */
export declare class ArticleScheduler {
    private ctx;
    private env;
    constructor(state: any, env: any);
    /** alarm 处理函数 — Cloudflare DO alarm 触发时调用 */
    alarm(): Promise<void>;
    /** 启动调度器 — 设置第一次 alarm */
    start(config?: SchedulerConfig): Promise<{
        scheduled: string;
    }>;
    /** 获取 alarm 状态 */
    getStatus(): Promise<{
        hasAlarm: boolean;
        nextAlarm: string | null;
    }>;
    /** 设置下一天的 alarm */
    private scheduleNext;
    /** 计算下一次 alarm 时间（固定时间，每天触发） */
    private getNextAlarmTime;
}
/**
 * 启动调度器 — 在 Worker fetch handler 中调用
 *
 * @example
 * ```ts
 * import { startScheduler } from 'ai-article-pipeline'
 *
 * export default {
 *   async fetch(request, env) {
 *     const scheduler = startScheduler(env, { time: '08:00' })
 *     await scheduler.start()
 *     return new Response('Scheduler started')
 *   }
 * }
 * ```
 */
export declare function startScheduler(env: any, config?: SchedulerConfig): {
    start: () => any;
    getStatus: () => any;
};
