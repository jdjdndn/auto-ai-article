import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
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
} from '../src/client.js'
import type { ContentBlock, CtaConfig, LinkItem, FaqItem } from '../src/client.js'
import * as utils from '../src/utils.js'

// 引用类型避免未使用告警
const _types: {
  ContentBlock: ContentBlock | null
  CtaConfig: CtaConfig | null
  LinkItem: LinkItem | null
  FaqItem: FaqItem | null
} = {
  ContentBlock: null,
  CtaConfig: null,
  LinkItem: null,
  FaqItem: null,
}
void _types

describe('client 模块导出完整性', () => {
  it('所有渲染函数均为 function 类型', () => {
    const fns = [
      escapeHtml,
      renderArticleBlocks,
      renderArticleCta,
      generateToc,
      readingTime,
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
    ]
    for (const fn of fns) {
      assert.equal(typeof fn, 'function')
    }
  })

  it('articleCss 是非空字符串', () => {
    assert.equal(typeof articleCss, 'string')
    assert.ok(articleCss.length > 0)
    assert.ok(articleCss.includes('.article-toc'))
  })

  it('re-export 与 utils 模块引用一致', () => {
    assert.equal(escapeHtml, utils.escapeHtml)
    assert.equal(renderArticleBlocks, utils.renderArticleBlocks)
    assert.equal(renderArticleCta, utils.renderArticleCta)
    assert.equal(generateToc, utils.generateToc)
    assert.equal(readingTime, utils.readingTime)
    assert.equal(articleCss, utils.articleCss)
    assert.equal(firstImageOf, utils.firstImageOf)
    assert.equal(normalizeContentBlocks, utils.normalizeContentBlocks)
    assert.equal(renderArticleLinks, utils.renderArticleLinks)
    assert.equal(renderRelatedArticles, utils.renderRelatedArticles)
    assert.equal(renderFaqSection, utils.renderFaqSection)
    assert.equal(renderShareBar, utils.renderShareBar)
    assert.equal(articleJsonLd, utils.articleJsonLd)
    assert.equal(organizationJsonLd, utils.organizationJsonLd)
    assert.equal(websiteJsonLd, utils.websiteJsonLd)
    assert.equal(productJsonLd, utils.productJsonLd)
    assert.equal(faqJsonLd, utils.faqJsonLd)
    assert.equal(initArticleActions, utils.initArticleActions)
  })
})

describe('escapeHtml', () => {
  it('转义特殊字符', () => {
    assert.equal(escapeHtml('<script>"a"&\'b\'</script>'), '&lt;script&gt;&quot;a&quot;&amp;&#39;b&#39;&lt;/script&gt;')
  })

  it('null 和 undefined 返回空字符串', () => {
    assert.equal(escapeHtml(null), '')
    assert.equal(escapeHtml(undefined), '')
  })

  it('数字和布尔值转字符串', () => {
    assert.equal(escapeHtml(42), '42')
    assert.equal(escapeHtml(true), 'true')
  })

  it('普通字符串原样返回', () => {
    assert.equal(escapeHtml('hello world'), 'hello world')
  })
})

describe('renderArticleBlocks', () => {
  it('非数组输入返回空字符串', () => {
    assert.equal(renderArticleBlocks(null as unknown as ContentBlock[]), '')
    assert.equal(renderArticleBlocks(undefined as unknown as ContentBlock[]), '')
    assert.equal(renderArticleBlocks({} as unknown as ContentBlock[]), '')
  })

  it('空数组返回空字符串', () => {
    assert.equal(renderArticleBlocks([]), '')
  })

  it('渲染多种 block 类型', () => {
    const blocks: ContentBlock[] = [
      { type: 'h2', text: '标题' },
      { type: 'text', text: '正文内容' },
      { type: 'list', items: ['条目1', '条目2'] },
    ]
    const html = renderArticleBlocks(blocks)
    assert.ok(html.includes('<h2'), '应包含 h2 标签')
    assert.ok(html.includes('正文内容'), '应包含正文')
    assert.ok(html.includes('条目1'), '应包含列表项')
  })

  it('占位图片 URL 被丢弃', () => {
    const blocks: ContentBlock[] = [
      { type: 'image', url: 'https://example.com/img.png' },
      { type: 'text', text: '保留' },
    ]
    const html = renderArticleBlocks(blocks)
    assert.ok(!html.includes('example.com'), '占位图应被丢弃')
    assert.ok(html.includes('保留'), '其他块应保留')
  })
})

describe('renderArticleCta', () => {
  it('undefined 使用默认文案', () => {
    const html = renderArticleCta(undefined)
    assert.ok(html.includes('想办一张高性价比套餐？'), '默认标题')
    assert.ok(html.includes('立即办理'), '默认按钮')
  })

  it('自定义配置渲染', () => {
    const html = renderArticleCta({
      title: '自定义标题',
      description: '描述文字',
      primaryLabel: '去办理',
      primaryUrl: 'https://go.example/c',
      secondaryLabel: '了解更多',
      secondaryUrl: 'https://go.example/m',
    })
    assert.ok(html.includes('自定义标题'))
    assert.ok(html.includes('描述文字'))
    assert.ok(html.includes('去办理'))
    assert.ok(html.includes('了解更多'))
  })

  it('只有 secondaryLabel 无 secondaryUrl 时不显示副按钮', () => {
    const html = renderArticleCta({ secondaryLabel: '副按钮' })
    assert.ok(!html.includes('副按钮'), '缺少 secondaryUrl 不应渲染副按钮')
  })
})

describe('generateToc', () => {
  it('非数组返回空字符串', () => {
    assert.equal(generateToc(null as unknown as ContentBlock[]), '')
  })

  it('少于 3 个 h2 返回空字符串', () => {
    const blocks: ContentBlock[] = [
      { type: 'h2', text: '一' },
      { type: 'h2', text: '二' },
    ]
    assert.equal(generateToc(blocks), '')
  })

  it('3 个及以上 h2 生成目录', () => {
    const blocks: ContentBlock[] = [
      { type: 'h2', text: '一' },
      { type: 'h2', text: '二' },
      { type: 'h2', text: '三' },
    ]
    const toc = generateToc(blocks)
    assert.ok(toc.includes('article-toc'), '应包含 TOC 容器')
    assert.ok(toc.includes('本文目录'), '应包含标题')
    assert.ok(toc.includes('#h2-0'), '应包含锚点链接')
  })
})

describe('readingTime', () => {
  it('非数组返回 0', () => {
    assert.equal(readingTime(null as unknown as ContentBlock[]), 0)
    assert.equal(readingTime(undefined as unknown as ContentBlock[]), 0)
  })

  it('空数组返回 1（最少 1 分钟）', () => {
    assert.equal(readingTime([]), 1)
  })

  it('按字数计算阅读时长', () => {
    const longText = '字'.repeat(600)
    const blocks: ContentBlock[] = [{ type: 'text', text: longText }]
    assert.equal(readingTime(blocks), 2)
  })

  it('list items 字数也计入', () => {
    const blocks: ContentBlock[] = [{ type: 'list', items: ['字'.repeat(300), '字'.repeat(300)] }]
    assert.equal(readingTime(blocks), 2)
  })
})

describe('firstImageOf', () => {
  it('非数组返回空字符串', () => {
    assert.equal(firstImageOf(null), '')
    assert.equal(firstImageOf('not-array'), '')
  })

  it('提取第一个图片 url', () => {
    const content: ContentBlock[] = [
      { type: 'text', text: '文字' },
      { type: 'image', url: 'https://img.example/a.png' },
      { type: 'image', url: 'https://img.example/b.png' },
    ]
    assert.equal(firstImageOf(content), 'https://img.example/a.png')
  })

  it('无图片返回空字符串', () => {
    const content: ContentBlock[] = [{ type: 'text', text: '纯文字' }]
    assert.equal(firstImageOf(content), '')
  })
})

describe('normalizeContentBlocks', () => {
  it('非数组返回空数组', () => {
    assert.deepEqual(normalizeContentBlocks(null), [])
    assert.deepEqual(normalizeContentBlocks(undefined), [])
    assert.deepEqual(normalizeContentBlocks('string'), [])
  })

  it('标准化标准块', () => {
    const raw = [
      { type: 'h2', text: '标题' },
      { type: 'text', text: '正文' },
    ]
    const result = normalizeContentBlocks(raw)
    assert.equal(result.length, 2)
    assert.equal(result[0].type, 'h2')
    assert.equal(result[1].type, 'text')
  })

  it('松散对象归一化', () => {
    const raw = [{ h2: '松散标题' }, { text: '松散正文' }]
    const result = normalizeContentBlocks(raw)
    assert.equal(result.length, 2)
    assert.equal(result[0].type, 'h2')
    assert.equal(result[1].type, 'text')
  })

  it('过滤非对象元素', () => {
    const raw = [null, undefined, 42, 'str', { type: 'text', text: '有效' }]
    const result = normalizeContentBlocks(raw)
    assert.equal(result.length, 1)
    assert.equal(result[0].type, 'text')
  })
})

describe('renderArticleLinks', () => {
  it('非数组返回空字符串', () => {
    assert.equal(renderArticleLinks(null), '')
    assert.equal(renderArticleLinks('not-array'), '')
  })

  it('空数组返回空字符串', () => {
    assert.equal(renderArticleLinks([]), '')
  })

  it('渲染链接区并过滤占位 URL', () => {
    const links: LinkItem[] = [
      { id: 1, label: '链接A', url: 'https://real.example/a' },
      { id: 2, label: '占位', url: 'https://example.com/x' },
      { id: 3, label: '更多', url: 'https://real.example/m', kind: 'more' },
    ]
    const html = renderArticleLinks(links)
    assert.ok(html.includes('article-links'), '应包含容器')
    assert.ok(html.includes('链接A'), '应包含真实链接')
    assert.ok(!html.includes('占位'), '应过滤占位 URL')
    assert.ok(html.includes('更多'), '应包含 more 折叠区')
  })

  it('hideNote 隐藏广告标注', () => {
    const links: LinkItem[] = [{ label: '链接', url: 'https://real.example/a' }]
    const html = renderArticleLinks(links, { hideNote: true })
    assert.ok(!html.includes('ad-note'), '应隐藏广告标注')
  })
})

describe('renderRelatedArticles', () => {
  it('非数组返回空字符串', () => {
    assert.equal(renderRelatedArticles(null), '')
  })

  it('空数组返回空字符串', () => {
    assert.equal(renderRelatedArticles([]), '')
  })

  it('渲染相关文章列表', () => {
    const related = [
      { id: 'abc', title: '文章一' },
      { id: 'def', title: '文章二' },
    ]
    const html = renderRelatedArticles(related)
    assert.ok(html.includes('article-related'), '应包含容器')
    assert.ok(html.includes('文章一'), '应包含标题')
    assert.ok(html.includes('/article/abc'), '应包含链接')
  })

  it('过滤缺少 id 或 title 的条目', () => {
    const related = [
      { id: '', title: '无id' },
      { id: 'ok', title: '' },
    ]
    assert.equal(renderRelatedArticles(related), '')
  })
})

describe('renderFaqSection', () => {
  it('非数组返回空字符串', () => {
    assert.equal(renderFaqSection(null), '')
  })

  it('空数组返回空字符串', () => {
    assert.equal(renderFaqSection([]), '')
  })

  it('默认折叠模式渲染', () => {
    const faq: FaqItem[] = [{ q: '问题一？', a: '答案一' }]
    const html = renderFaqSection(faq)
    assert.ok(html.includes('article-faq'), '应包含容器')
    assert.ok(html.includes('<details>'), '折叠模式用 details')
    assert.ok(html.includes('问题一？'))
  })

  it('expand 模式全展开', () => {
    const faq: FaqItem[] = [{ q: '问题？', a: '答案' }]
    const html = renderFaqSection(faq, { mode: 'expand' })
    assert.ok(html.includes('faq-item'), '展开模式用 faq-item')
    assert.ok(!html.includes('<details>'))
  })

  it('过滤缺少 q 或 a 的条目', () => {
    const faq = [
      { q: '', a: '答案' },
      { q: '问题', a: '' },
    ] as unknown as FaqItem[]
    const html = renderFaqSection(faq)
    // 所有条目均被跳过，不应渲染 details 或 faq-item 条目容器
    assert.ok(!html.includes('<details>'), '不应渲染折叠条目')
    assert.ok(!html.includes('faq-item'), '不应渲染展开条目')
    assert.ok(!html.includes('答案'), '不应包含被过滤的答案')
  })
})

describe('renderShareBar', () => {
  it('渲染分享栏包含按钮', () => {
    const html = renderShareBar({ id: '1', title: '文章标题', summary: '摘要' })
    assert.ok(html.includes('share-bar'), '应包含容器')
    assert.ok(html.includes('复制链接'), '应包含复制按钮')
    assert.ok(html.includes('内容有误'), '应包含反馈按钮')
    assert.ok(html.includes('文章标题'), '应包含标题数据')
  })

  it('自定义 shareUrl', () => {
    const html = renderShareBar({ id: '1', title: 't' }, { shareUrl: 'https://share.example/x' })
    assert.ok(html.includes('https://share.example/x'))
  })
})

describe('articleJsonLd', () => {
  const article = {
    id: 'art-1',
    title: '套餐详解',
    summary: '月租29元',
    createdAt: '2026-01-01T00:00:00.000Z',
    category: '优惠',
    tags: ['套餐', '流量'],
  }
  const site = { name: '测试站', url: 'https://test.example' }

  it('生成 Article 结构化数据', () => {
    const json = articleJsonLd(article, site)
    const parsed = JSON.parse(json) as Array<Record<string, unknown>>
    assert.equal(parsed[0]['@type'], 'Article')
    assert.equal(parsed[0].headline, '套餐详解')
    assert.equal(parsed[0].url, 'https://test.example/article/art-1')
  })

  it('包含 FAQ 时追加 FAQPage', () => {
    const json = articleJsonLd({ ...article, faq: [{ q: '问题？', a: '答案' }] }, site)
    const parsed = JSON.parse(json) as Array<Record<string, unknown>>
    assert.equal(parsed.length, 2)
    assert.equal(parsed[1]['@type'], 'FAQPage')
  })

  it('转义 < 防止 XSS', () => {
    const json = articleJsonLd({ ...article, title: '<script>' }, site)
    assert.ok(!json.includes('<script>'), '应转义 < 字符')
    assert.ok(json.includes('\\u003c'))
  })
})

describe('organizationJsonLd', () => {
  it('生成组织结构化数据', () => {
    const ld = organizationJsonLd({ name: '组织名', url: 'https://org.example', description: '描述' })
    assert.equal(ld['@type'], 'Organization')
    assert.equal(ld.name, '组织名')
    assert.equal(ld.url, 'https://org.example')
  })

  it('无 sameAs 时返回 undefined', () => {
    const ld = organizationJsonLd({ name: '组织名' })
    assert.equal(ld.sameAs, undefined)
    assert.equal(ld.url, undefined)
  })
})

describe('websiteJsonLd', () => {
  it('生成网站结构化数据', () => {
    const ld = websiteJsonLd({ name: '站名', url: 'https://site.example', description: '站点描述' })
    assert.equal(ld['@type'], 'WebSite')
    assert.equal(ld.name, '站名')
    assert.equal(ld.inLanguage, 'zh-CN')
  })
})

describe('productJsonLd', () => {
  it('生成产品结构化数据含 offers', () => {
    const ld = productJsonLd({ name: '产品名', price: '29.9', brand: '品牌' })
    assert.equal(ld['@type'], 'Product')
    assert.equal(ld.name, '产品名')
    assert.ok((ld as Record<string, unknown>).offers, '有价格应包含 offers')
  })

  it('无价格时不包含 offers', () => {
    const ld = productJsonLd({ name: '产品名' })
    assert.ok(!(ld as Record<string, unknown>).offers, '无价格不应包含 offers')
  })
})

describe('faqJsonLd', () => {
  it('空数组或 null 返回 null', () => {
    assert.equal(faqJsonLd([]), null)
    assert.equal(faqJsonLd(null as unknown as { q: string; a: string }[]), null)
  })

  it('生成 FAQPage 结构化数据', () => {
    const ld = faqJsonLd([{ q: '问题一？', a: '答案一' }])
    assert.equal(ld!['@type'], 'FAQPage')
    assert.ok(Array.isArray(ld!.mainEntity))
    assert.equal(ld!.mainEntity.length, 1)
  })
})

describe('initArticleActions', () => {
  it('无 document 环境传入 root 安全返回不报错', () => {
    // Node.js 测试环境无全局 document，传入 root 避免默认参数求值 document
    // 函数体内 typeof document === 'undefined' 守卫会安全返回
    assert.doesNotThrow(() => initArticleActions({} as unknown as ParentNode))
  })

  it('无 document 环境不传参数时抛 ReferenceError（默认参数求值 document）', () => {
    // 默认参数 root = document 在进入函数体前求值，Node 环境无 document 故抛错
    assert.throws(() => initArticleActions(), ReferenceError)
  })
})
