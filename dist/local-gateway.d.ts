import type { Logger } from './types.js';
/** 执行自愈命令（shell 模式，最多等 30s；命令自身不应阻塞，如内部用 Start-Process） */
export declare function runCommand(command: string, log: (...args: unknown[]) => void): Promise<void>;
export declare function createLocalGatewayClient(config: {
    gateway: string;
    models: string[];
    timeoutMs: number;
    logger?: Logger;
}): (messages: Array<{
    role: string;
    content: string;
}>) => Promise<string>;
export declare function acquireLock(file: string, waitMs: number, staleMs: number, log: (...args: unknown[]) => void): Promise<boolean>;
export declare function releaseLock(file: string): void;
export interface LocalGatewayProbe {
    /** 网关可用（可发 AI 请求） */
    online: boolean;
    /** token-free-gateway degraded（status:"degraded"，browser disconnected） */
    degraded: boolean;
    /** 会话过期（status:"session_expired"）或 /v1/models 返回空列表（未授权） */
    sessionExpired: boolean;
    /** 可用模型列表（可能为空） */
    models: string[];
}
/**
 * 探测本地网关。
 * TFG 语义（src/server.ts /health）：status 'ok'|'degraded'|'session_expired'，browser 'connected'|'disconnected'。
 * - ok + connected → 在线
 * - degraded（browser disconnected）→ 不可发请求，需拉起 Chrome
 * - session_expired → 需重新 webauth
 * 非 TFG 网关没有 /health → 回退老逻辑 /v1/models（200 且有模型即在线）
 */
export declare function probeLocalGateway(gateway: string, timeoutMs?: number): Promise<LocalGatewayProbe>;
