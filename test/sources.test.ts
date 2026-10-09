import assert from 'node:assert/strict'
import { describe, it, afterEach } from 'node:test'
import { fetchRssFeed, extractArticleText, normalizeText, textSimilarity } from '../src/sources.js'

// ============================================================
// 手写 fetch mock：替换 globalThis.fetch，测试后恢复
// ============================================================
let originalFetch: typeof fetch | null = null
let fetchCalls: { url: string; init: RequestInit }[] = []

interface MockOptions {
  ok?: boolean
  status?: number
  text?: string
  error?: Error
  hang?: boolean // 永不主动 resolve，仅监听 abort 信号（用于超时测试）
}

function mockFetch(opts: MockOptions = {}): void {
  originalFetch = globalThis.fetch
  fetchCalls = []
  const ok = opts.ok ?? true
  const status = opts.status ?? 200
  const text = opts.text ?? ''
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    fetchCalls.push({ url, init })
    if (opts.error) throw opts.error
    if (opts.hang) {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init.signal as AbortSignal
        if (signal.aborted) reject(new Error('The operation was aborted'))
        else signal.addEventListener('abort', () => reject(new Error('The operation was aborted')))
      })
    }
    return {
      ok,
      status,
      async text() {
        return text
      },
    } as unknown as Response
  }) as typeof fetch
}

function restoreFetch(): void {
  if (originalFetch !== null) globalThis.fetch = originalFetch
  originalFetch = null
}

afterEach(restoreFetch)

// ============================================================
// fetchRssFeed：RSS/Atom 解析
// ============================================================
describe('fetchRssFeed', () => {
  it('正常解析 RSS item 列表', async () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item>
        <title>套餐A</title>
        <link>http://a.com/1</link>
        <description>优惠套餐介绍</description>
        <pubDate>Mon, 09 Oct 2026 00:00:00 GMT</pubDate>
      </item>
    </channel></rss>`
    mockFetch({ text: xml })
    const items = await fetchRssFeed('http://feed.example.com/rss')
    assert.equal(items.length, 1)
    assert.equal(items[0].title, '套餐A')
    assert.equal(items[0].link, 'http://a.com/1')
    assert.equal(items[0].description, '优惠套餐介绍')
    assert.equal(items[0].pubDate, 'Mon, 09 Oct 2026 00:00:00 GMT')
    // 验证 fetch 调用参数
    assert.ok(fetchCalls.length >= 1)
    const call = fetchCalls[0]!
    assert.equal(call.url, 'http://feed.example.com/rss')
    const headers = call.init.headers as Record<string, string>
    assert.equal(headers['User-Agent'], 'ArticleBot/1.0')
  })

  it('解析 Atom entry 并通过 href 属性提取 link', async () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>文章B</title>
        <link href="http://b.com/2"/>
        <summary>摘要内容</summary>
        <published>2026-10-09T00:00:00Z</published>
      </entry>
    </feed>`
    mockFetch({ text: xml })
    const items = await fetchRssFeed('http://feed.example.com/atom')
    assert.equal(items.length, 1)
    assert.equal(items[0].title, '文章B')
    assert.equal(items[0].link, 'http://b.com/2')
    assert.equal(items[0].description, '摘要内容')
    assert.equal(items[0].pubDate, '2026-10-09T00:00:00Z')
  })

  it('description 回退到 content，pubDate 回退到 updated', async () => {
    const xml = `<rss><channel>
      <item>
        <title>回退测试</title>
        <link>http://c.com</link>
        <content>正文内容字段</content>
        <updated>2026-10-08</updated>
      </item>
    </channel></rss>`
    mockFetch({ text: xml })
    const items = await fetchRssFeed('http://feed.example.com/rss')
    assert.equal(items.length, 1)
    assert.equal(items[0].description, '正文内容字段')
    assert.equal(items[0].pubDate, '2026-10-08')
  })

  it('CDATA 与 HTML 实体解码', async () => {
    const xml = `<rss><channel>
      <item>
        <title><![CDATA[&lt;标题&gt;&amp;实体]]></title>
        <link>http://d.com</link>
        <description>内容&quot;引号&#39;撇</description>
        <pubDate>2026-10-09</pubDate>
      </item>
    </channel></rss>`
    mockFetch({ text: xml })
    const items = await fetchRssFeed('http://feed.example.com/rss')
    // title 不经过 stripHtml，保留尖括号；decodeHtml 顺序: CDATA → &amp; → &lt; → &gt; → &quot; → &#39;
    assert.equal(items[0].title, '<标题>&实体')
    // description 经过 stripHtml，故只测不含尖括号的实体
    assert.equal(items[0].description, '内容"引号\'撇')
  })

  it('description 中 HTML 标签被剥离', async () => {
    const xml = `<rss><channel>
      <item>
        <title>标签剥离</title>
        <link>http://e.com</link>
        <description><![CDATA[<p>优惠</p><b>套餐</b>]]></description>
        <pubDate>2026-10-09</pubDate>
      </item>
    </channel></rss>`
    mockFetch({ text: xml })
    const items = await fetchRssFeed('http://feed.example.com/rss')
    assert.equal(items[0].description, '优惠 套餐')
  })

  it('description 超过 500% 字符时截断', async () => {
    const longDesc = '甲'.repeat(600)
    const xml = `<rss><channel>
      <item>
        <title>截断测试</title>
        <link>http://f.com</link>
        <description>${longDesc}</description>
        <pubDate>2026-10-09</pubDate>
      </item>
    </channel></rss>`
    mockFetch({ text: xml })
    const items = await fetchRssFeed('http://feed.example.com/rss')
    assert.equal(items[0].description.length, 500)
    assert.equal(items[0].description, '甲'.repeat(500))
  })

  it('title 或 link 缺失的 item 被跳过', async () => {
    const xml = `<rss><channel>
      <item><title>无链接</title></item>
      <item><link>http://nolink.com</link></item>
      <item><title>有效条目</title><link>http://valid.com</link><pubDate>2026-10-09</pubDate></item>
    </channel></rss>`
    mockFetch({ text: xml })
    const items = await fetchRssFeed('http://feed.example.com/rss')
    assert.equal(items.length, 1)
    assert.equal(items[0].title, '有效条目')
    assert.equal(items[0].link, 'http://valid.com')
  })

  it('无 item 的 feed 返回空数组', async () => {
    const xml = `<?xml version="1.0"?><rss><channel><title>空feed</title></channel></rss>`
    mockFetch({ text: xml })
    const items = await fetchRssFeed('http://feed.example.com/empty')
    assert.deepEqual(items, [])
  })

  it('HTTP 错误状态码抛出异常', async () => {
    mockFetch({ ok: false, status: 404, text: 'Not Found' })
    await assert.rejects(fetchRssFeed('http://feed.example.com/404'), /HTTP 404/)
  })

  it('fetch 抛出网络错误时向上传播', async () => {
    mockFetch({ error: new Error('network down') })
    await assert.rejects(fetchRssFeed('http://feed.example.com/err'), /network down/)
  })

  it('请求超时触发 abort 并抛出异常', async () => {
    mockFetch({ hang: true })
    await assert.rejects(fetchRssFeed('http://feed.example.com/slow', 30), /abort/i)
  })

  it('使用自定义 timeoutMs 参数', async () => {
    const xml = `<rss><channel><item><title>x</title><link>http://x.com</link></item></channel></rss>`
    mockFetch({ text: xml })
    await fetchRssFeed('http://feed.example.com/rss', 5000)
    assert.equal(fetchCalls.length, 1)
    assert.ok(fetchCalls[0]!.init.signal instanceof AbortSignal)
  })
})

// ============================================================
// extractArticleText：HTML 正文提取
// ============================================================
describe('extractArticleText', () => {
  it('空输入返回空字符串', () => {
    assert.equal(extractArticleText(''), '')
  })

  it('优先提取 article 标签内容', () => {
    const pad = '内容'.repeat(10)
    const html = `<article><p>这是文章正文${pad}</p></article><main><p>这是main内容不应被提取${pad}</p></main>`
    const text = extractArticleText(html)
    assert.ok(text.includes('文章正文'))
    assert.ok(!text.includes('main内容'))
  })

  it('无 article 时回退到 main 标签', () => {
    const pad = '内容'.repeat(10)
    const html = `<main><p>这是main正文${pad}</p></main>`
    const text = extractArticleText(html)
    assert.ok(text.includes('main正文'))
  })

  it('无 article 和 main 时使用整个 html', () => {
    const pad = '内容'.repeat(10)
    const html = `<div><p>普通段落${pad}</p></div>`
    const text = extractArticleText(html)
    assert.ok(text.includes('普通段落'))
  })

  it('script style nav footer 内容被移除', () => {
    const pad = '内容'.repeat(10)
    const html = [
      '<script>alert(1)</script>',
      '<style>.x{color:red}</style>',
      '<nav>导航栏链接</nav>',
      '<footer>页脚版权信息</footer>',
      `<p>正文段落${pad}</p>`,
    ].join('')
    const text = extractArticleText(html)
    assert.ok(!text.includes('alert'))
    assert.ok(!text.includes('color'))
    assert.ok(!text.includes('导航栏'))
    assert.ok(!text.includes('页脚'))
    assert.ok(text.includes('正文段落'))
  })

  it('长度不超过 20 的短段落被过滤', () => {
    const pad = '内容'.repeat(10)
    const html = `<p>短</p><p>这是一个足够长的段落${pad}</p>`
    const text = extractArticleText(html)
    assert.ok(!text.includes('短'))
    assert.ok(text.includes('足够长的段落'))
  })

  it('最多保留 15 个段落', () => {
    const pad = '内容'.repeat(10)
    const paragraphs: string[] = []
    for (let i = 0; i < 20; i++) paragraphs.push(`<p>段落${i}号${pad}</p>`)
    const text = extractArticleText(paragraphs.join(''))
    const lines = text.split('\n')
    assert.equal(lines.length, 15)
    assert.ok(lines[0].includes('段落0'))
    assert.ok(lines[14].includes('段落14'))
    assert.ok(!text.includes('段落15'))
  })

  it('总长度截断到 2000 字符', () => {
    const paragraphs: string[] = []
    for (let i = 0; i < 15; i++) paragraphs.push(`<p>${'字'.repeat(150)}</p>`)
    const text = extractArticleText(paragraphs.join(''))
    assert.equal(text.length, 2000)
  })

  it('多段落用换行符连接', () => {
    const pad = '内容'.repeat(10)
    const html = `<p>第一段${pad}</p><p>第二段${pad}</p>`
    const text = extractArticleText(html)
    assert.ok(text.includes('第一段'))
    assert.ok(text.includes('第二段'))
    assert.ok(text.includes('\n'))
  })
})

// ============================================================
// normalizeText：文本归一化
// ============================================================
describe('normalizeText', () => {
  it('小写化并去除标点', () => {
    assert.equal(normalizeText('Hello, World!'), 'hello world')
  })

  it('空字符串返回空字符串', () => {
    assert.equal(normalizeText(''), '')
  })

  it('null 返回空字符串', () => {
    assert.equal(normalizeText(null), '')
  })

  it('undefined 返回空字符串', () => {
    assert.equal(normalizeText(undefined), '')
  })

  it('中文字符保留', () => {
    assert.equal(normalizeText('你好，世界！'), '你好世界')
  })

  it('多个空白字符合并为单个空格', () => {
    assert.equal(normalizeText('a   b\n\tc'), 'a b c')
  })

  it('数字与字母混合保留', () => {
    assert.equal(normalizeText('Plan 29元 100GB!'), 'plan 29元 100gb')
  })
})

// ============================================================
// textSimilarity：bigram Jaccard 相似度
// ============================================================
describe('textSimilarity', () => {
  it('相同文本返回 1', () => {
    assert.equal(textSimilarity('hello world', 'hello world'), 1)
  })

  it('一方为空返回 0', () => {
    assert.equal(textSimilarity('', 'abc'), 0)
    assert.equal(textSimilarity('abc', ''), 0)
  })

  it('null 输入返回 0', () => {
    assert.equal(textSimilarity(null, 'abc'), 0)
    assert.equal(textSimilarity('abc', null), 0)
  })

  it('完全不同的文本返回 0', () => {
    assert.equal(textSimilarity('abcdef', 'ghijkl'), 0)
  })

  it('单字符不同文本无法构成 bigram 返回 0', () => {
    assert.equal(textSimilarity('a', 'b'), 0)
  })

  it('单字符相同文本返回 1', () => {
    assert.equal(textSimilarity('a', 'a'), 1)
  })

  it('部分相似文本返回 0 到 1 之间的值', () => {
    const sim = textSimilarity('hello world', 'hello word')
    assert.ok(sim > 0 && sim < 1, `期望 0<sim<1，实际 ${sim}`)
    // he,el,ll,lo,'o ',' w',wo,or 共 8 个交集；并集 11
    assert.ok(Math.abs(sim - 8 / 11) < 1e-9, `期望约 ${8 / 11}，实际 ${sim}`)
  })

  it('相似度具有对称性', () => {
    const a = '人工智能文章生成'
    const b = '人工智能内容生成'
    assert.equal(textSimilarity(a, b), textSimilarity(b, a))
  })
})
