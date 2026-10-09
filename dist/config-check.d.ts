export interface ConfigCheckResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}
export declare function validateConfig(config: Record<string, unknown>): ConfigCheckResult;
