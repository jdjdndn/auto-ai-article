export interface AlertConfig {
    /** Webhook URL（飞书/钉钉/通用） */
    webhookUrl: string;
    /** 通知渠道（默认 auto：URL 含 feishu → feishu，含 dingtalk/oapi.dingtalk → dingtalk，否则 generic） */
    channel?: 'feishu' | 'dingtalk' | 'generic' | 'auto';
    /** 最小成功率阈值（低于此值触发告警，默认 0.6） */
    minSuccessRate?: number;
    /** 全部失败时是否告警（默认 true） */
    alertOnAllFail?: boolean;
    /** 告警消息前缀（如站点名，默认空） */
    siteLabel?: string;
}
export interface AlertContext {
    /** 本次运行成功数 */
    ok: number;
    /** 本次运行失败数 */
    fail: number;
    /** 本次运行总数 */
    total: number;
    /** 模式 */
    mode: string;
    /** 错误信息 */
    errors?: string[];
    /** 统计面板成功率（历史聚合，可选） */
    historicalSuccessRate?: number;
}
export interface AlertResult {
    triggered: boolean;
    reason?: string;
    message?: string;
}
/**
 * 检查运行结果并触发告警。
 * 触发条件：成功率低于阈值 或 全部失败（且 alertOnAllFail=true）。
 */
export declare function checkAndAlert(ctx: AlertContext, config: AlertConfig): Promise<AlertResult>;
