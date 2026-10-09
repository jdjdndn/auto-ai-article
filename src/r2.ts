// ============================================================
// R2 对象存储：文章正文（content/links/friendLinks/faq/relatedIds）
// Key 格式: {siteId}/{articleId}.json
// 多站共享同一个 R2 bucket，用 siteId 前缀隔离
// ============================================================

/** 文章正文数据（存 R2，不进 D1） */
export interface ArticleContent {
  content: string
  links: string
  friendLinks: string
  faq: string
  relatedIds: string
}

/** 获取站点标识（多站共享 D1/R2 时区分） */
export function getSiteId(): string {
  return (process.env as any).SITE_ID || (globalThis as any).__env__?.SITE_ID || ''
}

/** 获取 R2 binding（binding 名默认 ARTICLES_R2，可传参覆盖）
 *  返回 any：R2Bucket 类型由各站 Cloudflare Workers 运行时提供 */
export function getR2Binding(bindingName: string = 'ARTICLES_R2'): any {
  const binding = (process.env as any)[bindingName] || (globalThis as any).__env__?.[bindingName]
  if (!binding) {
    throw new Error(`R2 binding not found: 请配置 wrangler.jsonc 的 r2_buckets (binding: ${bindingName})`)
  }
  return binding
}

/** 写入文章正文到 R2 */
export async function writeArticleContent(
  articleId: string,
  data: ArticleContent,
  bindingName?: string,
): Promise<void> {
  const r2 = getR2Binding(bindingName)
  const siteId = getSiteId()
  const key = `${siteId}/${articleId}.json`
  await r2.put(key, JSON.stringify(data))
}

/** 读取文章正文 from R2 */
export async function readArticleContent(
  articleId: string,
  bindingName?: string,
): Promise<ArticleContent | null> {
  const r2 = getR2Binding(bindingName)
  const siteId = getSiteId()
  const key = `${siteId}/${articleId}.json`
  const obj = await r2.get(key)
  if (!obj) return null
  const text = await obj.text()
  return JSON.parse(text) as ArticleContent
}

/** 删除文章正文 from R2 */
export async function deleteArticleContent(
  articleId: string,
  bindingName?: string,
): Promise<void> {
  const r2 = getR2Binding(bindingName)
  const siteId = getSiteId()
  const key = `${siteId}/${articleId}.json`
  await r2.delete(key)
}
