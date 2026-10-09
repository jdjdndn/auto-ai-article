"use strict";
// ============================================================
// R2 对象存储：文章正文（content/links/friendLinks/faq/relatedIds）
// Key 格式: {siteId}/{articleId}.json
// 多站共享同一个 R2 bucket，用 siteId 前缀隔离
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSiteId = getSiteId;
exports.getR2Binding = getR2Binding;
exports.writeArticleContent = writeArticleContent;
exports.readArticleContent = readArticleContent;
exports.deleteArticleContent = deleteArticleContent;
/** 获取站点标识（多站共享 D1/R2 时区分） */
function getSiteId() {
    return process.env.SITE_ID || globalThis.__env__?.SITE_ID || '';
}
/** 获取 R2 binding（binding 名默认 ARTICLES_R2，可传参覆盖）
 *  返回 any：R2Bucket 类型由各站 Cloudflare Workers 运行时提供 */
function getR2Binding(bindingName = 'ARTICLES_R2') {
    const binding = process.env[bindingName] || globalThis.__env__?.[bindingName];
    if (!binding) {
        throw new Error(`R2 binding not found: 请配置 wrangler.jsonc 的 r2_buckets (binding: ${bindingName})`);
    }
    return binding;
}
/** 写入文章正文到 R2 */
async function writeArticleContent(articleId, data, bindingName) {
    const r2 = getR2Binding(bindingName);
    const siteId = getSiteId();
    const key = `${siteId}/${articleId}.json`;
    await r2.put(key, JSON.stringify(data));
}
/** 读取文章正文 from R2 */
async function readArticleContent(articleId, bindingName) {
    const r2 = getR2Binding(bindingName);
    const siteId = getSiteId();
    const key = `${siteId}/${articleId}.json`;
    const obj = await r2.get(key);
    if (!obj)
        return null;
    const text = await obj.text();
    return JSON.parse(text);
}
/** 删除文章正文 from R2 */
async function deleteArticleContent(articleId, bindingName) {
    const r2 = getR2Binding(bindingName);
    const siteId = getSiteId();
    const key = `${siteId}/${articleId}.json`;
    await r2.delete(key);
}
