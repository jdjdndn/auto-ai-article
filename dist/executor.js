"use strict";
// ============================================================
// 执行器 — 完整的每日生成流程编排
// 从 article-site/scripts/scheduled-generate.mjs + server/utils/daily-generate.ts 提取
// 本地网关逻辑抽到 local-gateway.ts，惰性 require：纯云端站不加载本地发文代码
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.execute = execute;
const pipeline_js_1 = require("./pipeline.js");
// —— 工具 ——
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// —— 执行器 ——
async function execute(db, config = {}) {
    const dailyTarget = config.dailyTarget ?? 3;
    const localGateway = config.localGateway ?? 'http://localhost:3456/v1';
    const localModel = config.localModel ?? 'deepseek-chat';
    const localTimeoutMs = config.localTimeoutMs ?? 280_000;
    const autoStartWaitMs = config.autoStartWaitMs ?? 45_000;
    const dryRun = config.dryRun ?? false;
    const log = config.logger || ((...args) => console.log(new Date().toISOString(), '[executor]', ...args));
    // 1. 优先发草稿：发布到期草稿后，当日已发布口径（含草稿发布）自然增大，剩余由生成补足
    if (config.publishDueDrafts) {
        try {
            const published = await config.publishDueDrafts();
            if (published > 0)
                log(`优先发布到期草稿 ${published} 篇`);
        }
        catch (e) {
            log(`[warn] 发布到期草稿失败：${e.message}`);
        }
    }
    // 2. 检查今日配额（已发布含草稿发布；不足部分为剩余目标）
    let done = 0;
    if (config.getPublishedToday) {
        done = await config.getPublishedToday();
        if (done >= dailyTarget) {
            log(`当天已发布 ${done}/${dailyTarget} 篇，跳过`);
            return { mode: 'skipped', reason: `当天已发布 ${done} 篇` };
        }
        log(`当天已发布 ${done}/${dailyTarget} 篇，剩余 ${dailyTarget - done} 篇由生成补足`);
    }
    // 2. 防重复发布：今天已有本地成功记录 → 信任本地，跳过
    if (config.hasLocalRunToday) {
        const hasLocal = await config.hasLocalRunToday();
        if (hasLocal) {
            log('今天已有本地流水线成功记录，跳过');
            return { mode: 'skipped', reason: '今天已有本地成功记录' };
        }
    }
    // 3. 检查本地网关（已提供云端 client 时跳过，Workers/线上环境无本地网关）
    //    惰性加载 local-gateway：纯云端站（config.ai.client 已提供）不 require，零开销
    const lg = config.ai?.client
        ? null
        : require('./local-gateway.js');
    let probe = lg ? await lg.probeLocalGateway(localGateway) : null;
    let localOnline = probe ? probe.online : false;
    // 3.1 自愈：离线/degraded → 拉起（网关或浏览器）→ 等待 → 重探测一次
    if (probe && !localOnline) {
        if (probe.degraded) {
            log('本地网关 degraded（浏览器未连接），尝试拉起浏览器');
            if (config.localChromeStartCommand) {
                await lg.runCommand(config.localChromeStartCommand, log);
                await sleep(autoStartWaitMs);
            }
            else {
                log('未配置 localChromeStartCommand，跳过浏览器拉起');
            }
        }
        else {
            log('本地 AI 网关离线，尝试自愈拉起');
            if (config.localGatewayStartCommand) {
                await lg.runCommand(config.localGatewayStartCommand, log);
                await sleep(autoStartWaitMs);
            }
            else {
                log('未配置 localGatewayStartCommand，跳过拉起');
            }
        }
        probe = await lg.probeLocalGateway(localGateway);
        localOnline = probe.online;
    }
    if (probe && !localOnline) {
        if (probe.sessionExpired) {
            log('本地网关会话过期或 /v1/models 未授权，请运行网关 webauth 重新登录');
        }
        if (dryRun) {
            log('本地 AI 网关离线，dry-run 不转云端');
            return { mode: 'skipped', reason: '本地网关离线，dry-run 模式' };
        }
        if (!config.ai?.client && !config.ai?.apiKey) {
            if (config.cloudFallback) {
                log('本地网关离线且未配置云端 AI key，调用 cloudFallback 整轮兜底');
                try {
                    const fb = await config.cloudFallback({ localGateway, dryRun });
                    const message = fb?.message || (fb?.ok === false ? 'cloudFallback 未成功' : '云端兜底已执行');
                    return { mode: 'cloud-fallback', reason: message };
                }
                catch (e) {
                    log(`cloudFallback 失败: ${e.message}`);
                    return { mode: 'skipped', reason: `cloudFallback 失败: ${e.message}` };
                }
            }
            return { mode: 'skipped', reason: '本地网关离线且未配置云端 AI' };
        }
        log(config.ai?.client ? '已配置云端 AI client，直接走云端' : '本地 AI 网关离线，尝试云端兜底');
    }
    // 4. 创建管线（目标 = 剩余待生成数：今日已发布 1 篇则补 2 篇，到目标即止）
    const remain = Math.max(0, dailyTarget - done);
    const pipelineConfig = {
        ...config,
        target: remain,
    };
    if (localOnline) {
        // 模型发现：localModel 不在网关模型列表时自动选第一个可用模型；
        // 显式配置 localModels 时优先使用（按优先级轮换，缺失本地模型不可用时自动切换）
        const models = probe?.models ?? [];
        let model = localModel;
        if (models.length && !models.includes(localModel)) {
            model = models[0];
            log(`本地模型 ${localModel} 不在网关模型列表，自动使用 ${model}`);
        }
        const localModels = config.localModels?.length ? config.localModels : [model];
        log(`使用本地网关 ${localGateway}，模型候选 ${localModels.join(' -> ')}`);
        pipelineConfig.ai = {
            ...pipelineConfig.ai,
            client: lg.createLocalGatewayClient({ gateway: localGateway, models: localModels, timeoutMs: localTimeoutMs, logger: log }),
            model: localModels[0],
        };
    }
    else {
        log(`使用云端 AI，模型 ${config.cloudModel || config.ai?.model || 'default'}`);
        pipelineConfig.ai = {
            ...pipelineConfig.ai,
            model: config.cloudModel || config.ai?.model,
        };
    }
    const pipeline = (0, pipeline_js_1.createPipeline)(db, pipelineConfig);
    // 5. 运行管线（本地分支先拿跨站互斥锁，避免多站并发打同一网关）
    try {
        const lockFile = localOnline ? config.localLockFile : undefined;
        if (lockFile) {
            const got = await lg.acquireLock(lockFile, config.localLockWaitMs ?? 180_000, config.localLockStaleMs ?? 1_800_000, log);
            if (!got) {
                log(`本地网关正被其他站点占用（锁 ${lockFile}），本轮跳过，由云端兜底`);
                return { mode: 'skipped', reason: `本地网关正被其他站点占用（${lockFile}）` };
            }
        }
        try {
            const result = await pipeline.run();
            log(`完成：成功 ${result.ok}，失败 ${result.fail}`);
            // 6. 上报运行日志
            if (config.reportRun) {
                try {
                    await config.reportRun({
                        runAt: new Date().toISOString(),
                        model: pipelineConfig.ai?.model || 'default',
                        total: result.total,
                        ok: result.ok,
                        fail: result.fail,
                        error: result.errors.length ? result.errors.join('; ').slice(0, 300) : null,
                        dryRun,
                    });
                }
                catch { /* 日志失败不阻塞 */ }
            }
            return { mode: localOnline ? 'local' : 'cloud', pipeline: result };
        }
        finally {
            if (lockFile)
                lg.releaseLock(lockFile);
        }
    }
    catch (e) {
        log('执行失败:', e.message);
        if (config.reportRun) {
            try {
                await config.reportRun({
                    runAt: new Date().toISOString(),
                    model: pipelineConfig.ai?.model || 'default',
                    total: 0,
                    ok: 0,
                    fail: 1,
                    error: e.message?.slice(0, 300),
                    dryRun,
                });
            }
            catch { /* noop */ }
        }
        throw e;
    }
}
