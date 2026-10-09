"use strict";
// ============================================================
// 告警 — 运行结束后检查成功率/失败率，低于阈值时触发 webhook 通知
// 支持飞书/钉钉/通用 HTTP POST
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAndAlert = checkAndAlert;
function detectChannel(url) {
    if (url.includes('feishu') || url.includes('lark'))
        return 'feishu';
    if (url.includes('dingtalk') || url.includes('oapi.dingtalk'))
        return 'dingtalk';
    return 'generic';
}
function buildPayload(channel, text) {
    switch (channel) {
        case 'feishu':
            return { msg_type: 'text', content: { text } };
        case 'dingtalk':
            return { msgtype: 'text', text: { content: text } };
        default:
            return { text };
    }
}
function formatMessage(ctx, config) {
    const label = config.siteLabel ? `[${config.siteLabel}] ` : '';
    const rate = ctx.total ? Math.round((ctx.ok / ctx.total) * 100) : 0;
    const lines = [
        `${label}⚠️ AI 文章生成告警`,
        `模式: ${ctx.mode}`,
        `成功/失败/总计: ${ctx.ok}/${ctx.fail}/${ctx.total}（成功率 ${rate}%）`,
    ];
    if (config.minSuccessRate != null && rate < config.minSuccessRate * 100) {
        lines.push(`阈值: 成功率 < ${Math.round(config.minSuccessRate * 100)}%`);
    }
    if (ctx.historicalSuccessRate != null) {
        lines.push(`历史成功率: ${Math.round(ctx.historicalSuccessRate * 100)}%`);
    }
    if (ctx.errors?.length) {
        lines.push(`错误: ${ctx.errors.slice(0, 3).join('; ').slice(0, 200)}`);
    }
    return lines.join('\n');
}
/**
 * 检查运行结果并触发告警。
 * 触发条件：成功率低于阈值 或 全部失败（且 alertOnAllFail=true）。
 */
async function checkAndAlert(ctx, config) {
    const minRate = config.minSuccessRate ?? 0.6;
    const alertOnAllFail = config.alertOnAllFail ?? true;
    const rate = ctx.total ? ctx.ok / ctx.total : 1;
    const shouldAlert = rate < minRate || (alertOnAllFail && ctx.fail > 0 && ctx.ok === 0);
    if (!shouldAlert)
        return { triggered: false };
    const reason = rate < minRate ? `成功率 ${Math.round(rate * 100)}% 低于阈值 ${Math.round(minRate * 100)}%` : '全部失败';
    const channel = config.channel === 'auto' || !config.channel ? detectChannel(config.webhookUrl) : config.channel;
    const text = formatMessage(ctx, config);
    const payload = buildPayload(channel, text);
    try {
        const res = await fetch(config.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            return { triggered: true, reason, message: `webhook HTTP ${res.status}` };
        }
        return { triggered: true, reason, message: '告警已发送' };
    }
    catch (e) {
        return { triggered: true, reason, message: `webhook 发送失败: ${e.message}` };
    }
}
