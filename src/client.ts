// ============================================================
// 前端入口：只导出 isomorphic 函数（无 drizzle/无 server-only）
// 前端用：import { renderArticleBlocks, articleCss } from 'ai-article-pipeline/client'
// ============================================================

export {
  escapeHtml,
  renderArticleBlocks,
  renderArticleCta,
  generateToc,
  readingTime,
  articleCss,
  firstImageOf,
  normalizeContentBlocks,
  renderArticleLinks,
  renderRelatedArticles,
  renderFaqSection,
  renderShareBar,
  articleJsonLd,
  organizationJsonLd,
  websiteJsonLd,
  productJsonLd,
  faqJsonLd,
  initArticleActions,
} from './utils.js'

export type { ContentBlock, CtaConfig, LinkItem, FaqItem } from './types.js'
