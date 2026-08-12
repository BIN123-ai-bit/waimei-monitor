// 搜狗微信搜索抓取
// 解析 weixin.sogou.com 搜索结果
// 基于 2026年8月 实际页面结构

export interface WechatArticle {
  title: string;
  url: string;
  date: string;
  media: string;
  snippet: string;
}

// 全局 cookie 存储（同一进程内复用，减少反爬）
let _sogouCookies: string | null = null;

/**
 * 通过搜狗微信搜索抓取微信公众号文章
 * @param keyword 搜索关键词
 * @param maxResults 最多返回条数（默认30）
 */
export async function searchWechatArticles(
  keyword: string,
  maxResults: number = 30
): Promise<WechatArticle[]> {
  try {
    const encodedQuery = encodeURIComponent(keyword);
    const allArticles: WechatArticle[] = [];

    // 搜索第1页和第2页，增加覆盖率
    for (let page = 1; page <= 2; page++) {
      if (allArticles.length >= maxResults) break;

      const url = `https://weixin.sogou.com/weixin?type=2&query=${encodedQuery}&ie=utf8&page=${page}`;

      const html = await fetchSogouWithCookie(url);
      if (!html) break;

      const articles = parseSogouHTML(html);
      if (articles.length === 0) break;

      allArticles.push(...articles);

      // 页间延迟，避免触发反爬
      if (page < 2) {
        await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));
      }
    }

    return allArticles.slice(0, maxResults);
  } catch (error) {
    console.error("搜狗微信搜索异常:", error);
    return [];
  }
}

/**
 * 带 Cookie 的搜狗请求（先获取 Cookie，再请求搜索页）
 */
async function fetchSogouWithCookie(url: string): Promise<string | null> {
  const userAgents = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  ];

  const ua = userAgents[Math.floor(Math.random() * userAgents.length)];

  // 如果没有 cookie，先访问首页获取
  if (!_sogouCookies) {
    try {
      const homeResp = await fetch("https://weixin.sogou.com/", {
        headers: { "User-Agent": ua, Accept: "text/html" },
        signal: AbortSignal.timeout(8000),
        redirect: "follow",
      });
      const setCookie = homeResp.headers.get("set-cookie");
      if (setCookie) {
        _sogouCookies = setCookie;
      }
    } catch {
      // 获取 cookie 失败不致命
    }
  }

  try {
    const headers: Record<string, string> = {
      "User-Agent": ua,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: "https://weixin.sogou.com/",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    };

    if (_sogouCookies) {
      headers["Cookie"] = _sogouCookies;
    }

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });

    if (!response.ok) {
      console.warn(`搜狗微信搜索返回 ${response.status}`);
      return null;
    }

    // 更新 cookie
    const newCookie = response.headers.get("set-cookie");
    if (newCookie) {
      _sogouCookies = newCookie;
    }

    const html = await response.text();

    // 检查反爬
    if (
      html.includes("请输入验证码") ||
      html.includes("antispider") ||
      html.includes("302")
    ) {
      console.warn("搜狗微信触发验证，已跳过");
      _sogouCookies = null; // 清除 cookie 下次重试
      return null;
    }

    if (html.length < 1000) {
      console.warn("搜狗微信返回内容过少");
      return null;
    }

    return html;
  } catch {
    return null;
  }
}

/**
 * 解析搜狗微信搜索结果 HTML
 *
 * 每条结果的结构（在 class="txt-box" 的 div 中）：
 * <div class="txt-box">
 *   <h3><a href="/link?url=...">文章标题</a></h3>
 *   <p class="txt-info">
 *     <span>公众号名称</span>
 *   </p>
 *   <p class="s-p">摘要内容</p>
 * </div>
 * 日期以 JavaScript 形式出现：document.write(timeConvert('1689848555'))
 */
function parseSogouHTML(html: string): WechatArticle[] {
  // 正则提取日期时间戳映射
  // 格式: document.write(timeConvert('UNIX_TIMESTAMP'))
  const timeMap = new Map<number, string>();
  const timeRe = /timeConvert\('(\d+)'\)/g;
  let timeMatch;
  let idx = 0;
  while ((timeMatch = timeRe.exec(html)) !== null) {
    const ts = parseInt(timeMatch[1]);
    const date = timestampToDate(ts);
    timeMap.set(idx, date);
    idx++;
  }

  // 按 txt-box 分割结果
  const blocks = html.split(/class="txt-box"/);
  if (blocks.length <= 1) return [];

  const results: WechatArticle[] = [];
  let blockIdx = 0;

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];

    // 提取标题（第一个有实际内容的 a 标签）
    const titleRe = /<a[^>]*href="(\/link\?url=[^"]*)"[^>]*>([\s\S]*?)<\/a>/i;
    const titleMatch = block.match(titleRe);
    if (!titleMatch) continue;

    const rawTitle = titleMatch[2].replace(/<[^>]+>/g, "").trim();
    const title = decodeHtmlEntities(rawTitle);

    if (!title || title.length < 4) continue;

    const linkUrl = "https://weixin.sogou.com" + titleMatch[1];

    // 提取公众号名称（第一个有内容的 span）
    const spanRe = /<span[^>]*>([^<]{2,})<\/span>/gi;
    let media = "微信公众号";
    const spans = [];
    let spanMatch;
    while ((spanMatch = spanRe.exec(block)) !== null) {
      const text = spanMatch[1].trim();
      // 过滤掉JS代码和空内容
      if (
        text &&
        !text.includes("document.write") &&
        !text.includes("timeConvert") &&
        text.length > 1 &&
        text.length < 50
      ) {
        spans.push(text);
      }
    }
    if (spans.length > 0) {
      media = spans[0];
    }

    // 提取摘要（s-p 段落）
    const snippetRe = /<p[^>]*class="[^"]*s-p[^"]*"[^>]*>([\s\S]*?)<\/p>/i;
    const snippetMatch = block.match(snippetRe);
    let snippet = "";
    if (snippetMatch) {
      snippet = snippetMatch[1].replace(/<[^>]+>/g, "").trim();
      snippet = decodeHtmlEntities(snippet);
    }

    // 提取日期
    const date = timeMap.get(blockIdx) || "";

    results.push({
      title,
      url: linkUrl,
      date,
      media,
      snippet: snippet.slice(0, 200),
    });

    blockIdx++;
  }

  return results;
}

/**
 * Unix 时间戳 → 日期字符串
 */
function timestampToDate(ts: number): string {
  if (!ts || ts < 1000000000 || ts > 2000000000) return "";
  const d = new Date(ts * 1000);
  return d.toISOString().split("T")[0];
}

/**
 * 解码 HTML 实体 (&ldquo; → " 等)
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    "&ldquo;": "“",
    "&rdquo;": "”",
    "&lsquo;": "‘",
    "&rsquo;": "’",
    "&mdash;": "—",
    "&ndash;": "–",
    "&hellip;": "…",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&nbsp;": " ",
  };

  let result = text;
  for (const [entity, char] of Object.entries(entities)) {
    result = result.replace(new RegExp(entity, "g"), char);
  }
  return result;
}
