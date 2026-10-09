/** 文章正文数据（存 R2，不进 D1） */
export interface ArticleContent {
    content: string;
    links: string;
    friendLinks: string;
    faq: string;
    relatedIds: string;
}
/** 获取站点标识（多站共享 D1/R2 时区分） */
export declare function getSiteId(): string;
/** 获取 R2 binding（binding 名默认 ARTICLES_R2，可传参覆盖）
 *  返回 any：R2Bucket 类型由各站 Cloudflare Workers 运行时提供 */
export declare function getR2Binding(bindingName?: string): any;
/** 写入文章正文到 R2 */
export declare function writeArticleContent(articleId: string, data: ArticleContent, bindingName?: string): Promise<void>;
/** 读取文章正文 from R2 */
export declare function readArticleContent(articleId: string, bindingName?: string): Promise<ArticleContent | null>;
/** 删除文章正文 from R2 */
export declare function deleteArticleContent(articleId: string, bindingName?: string): Promise<void>;
