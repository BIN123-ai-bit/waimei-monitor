// 百度新闻搜索抓取
// 免费替换 Bing News API，专注国内媒体覆盖
// 通过服务器端抓取 news.baidu.com 搜索结果并解析

import * as cheerio from "cheerio";

export interface BaiduNewsResult {
  title: string;
  url: string;
  date: string;
  media: string;
  snippet: string;
}

/**
 * 搜索百度新闻
 * @param keyword 搜索关键词
 * @param daysBack 搜索多少天内的新闻（最多30天）
 * @param maxResults 最多返回条数（默认30）
 */
export async function searchBaiduNews(
  keyword: string,
  daysBack: number = 30,
  maxResults: number = 30
): Promise<BaiduNewsResult[]> {
  const encodedKeyword = encodeURIComponent(keyword);

  // 计算时间戳（百度新闻用 Unix 时间戳做日期范围）
  // bt = begin time, et = end time
  const now = new Date();
  const et = Math.floor(now.getTime() / 1000);
  const startDate = new Date(now.getTime() - daysBack * 86400000);
  const bt = Math.floor(startDate.getTime() / 1000);

  const allResults: BaiduNewsResult[] = [];
  let page = 0;
  const maxPages = Math.ceil(maxResults / 20) + 1; // 多抓一页做保障

  try {
    while (allResults.length < maxResults && page < maxPages) {
      const pn = page * 10;
      const url = `https://news.baidu.com/ns?word=${encodedKeyword}&pn=${pn}&cl=2&ct=1&tn=news&rn=20&bt=${bt}&et=${et}&ie=utf-8`;

      const html = await fetchBaiduNews(url);
      if (!html) break;

      const results = parseBaiduNewsHTML(html);
      if (results.length === 0) break; // 没有更多结果

      allResults.push(...results);

      // 如果返回结果少于请求量，说明已到底
      if (results.length < 15) break;

      page++;

      // 请求间延迟，避免被反爬
      await delay(500 + Math.random() * 1000);
    }
  } catch (error) {
    console.error("百度新闻搜索异常:", error);
  }

  // 去重（百度偶尔会返回重复结果）
  const seen = new Set<string>();
  const unique: BaiduNewsResult[] = [];
  for (const r of allResults) {
    const key = r.url || r.title;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(r);
    }
  }

  return unique.slice(0, maxResults);
}

/**
 * 延迟工具函数
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 抓取百度新闻页面 HTML
 */
async function fetchBaiduNews(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        Referer: "https://news.baidu.com/",
      },
      signal: AbortSignal.timeout(15000), // 15秒超时
    });

    if (!response.ok) {
      console.warn(`百度新闻返回 HTTP ${response.status}`);
      return null;
    }

    // 检查返回内容类型
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      console.warn("百度新闻返回非 HTML 内容");
      return null;
    }

    return await response.text();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      console.warn("百度新闻请求超时");
    } else {
      console.warn(`百度新闻请求异常: ${error}`);
    }
    return null;
  }
}

/**
 * 解析百度新闻搜索结果 HTML
 *
 * 百度新闻搜索结果页面结构（可能随版本变化，使用多种备选解析策略）：
 * <div class="result">
 *   <h3 class="news-title_1YtI1"><a href="...">标题</a></h3>
 *   <div class="news-source">
 *     <span>媒体名</span>
 *     <span>日期</span>
 *   </div>
 *   <div class="news-content">摘要</div>
 * </div>
 */
function parseBaiduNewsHTML(html: string): BaiduNewsResult[] {
  const results: BaiduNewsResult[] = [];

  try {
    const $ = cheerio.load(html);

    // 策略1：查找所有 class 包含 "result" 的 div
    const resultSelectors = [
      'div[class*="result"]',
      'div.result',
      'div.news-result',
      'div.news-item',
      'div[class*="news-card"]',
      "div.card",
    ];

    // 优先使用包含最多结果的 selector
    let $results = $("div.result, div[class*='result']");
    if ($results.length === 0) {
      $results = $("div.news-item, div.news_");
    }

    // 遍历每个结果
    $results.each((_, element) => {
      const $el = $(element);

      // 提取标题和链接
      const $titleLink = $el.find("h3 a, .news-title a, [class*='title'] a").first();
      if ($titleLink.length === 0) {
        // 如果没有找到 h3，尝试直接找 a 标签
        const $anyLink = $el.find("a[href*='http']").first();
        if ($anyLink.length === 0) return; // 没链接就跳过
      }

      const $link = $titleLink.length > 0 ? $titleLink : $el.find("a[href*='http']").first();
      const title = $link.text().trim().replace(/\s+/g, " ");
      let url = $link.attr("href") || "";

      // 百度链接有时是跳转链接，尝试提取真实 URL
      if (url.startsWith("http") && !url.includes("baidu.com")) {
        // 已是真实 URL
      } else if (url) {
        // 可能是百度跳转链接，保留原样
        // 实际链接在百度跳转后面
      }

      if (!title || title.length < 3) return;

      // 提取媒体名称
      let media = "";
      const $source = $el.find(
        ".c-color-gray, .source, [class*='source'], [class*='author'], .c-author, span[class*='gray']"
      ).first();
      if ($source.length > 0) {
        media = $source.text().trim();
      }

      // 提取日期
      let date = "";
      const $date = $el.find(
        ".c-color-gray2, [class*='date'], [class*='time'], .news-time, span[class*='gray2']"
      );
      if ($date.length > 0) {
        date = $date.last().text().trim();
      } else {
        // 日期可能在 source 后面
        const $allSpans = $el.find("span");
        $allSpans.each((_, span) => {
          const text = $(span).text().trim();
          if (/\d{4}[-\/年]\d{1,2}[-\/月]\d{1,2}/.test(text) || /\d+小时前|\d+分钟前|\d+天前/.test(text)) {
            date = text;
            return false; // break
          }
        });
      }

      // 提取摘要
      let snippet = "";
      const $snippet = $el.find(
        ".c-summary, .c-span-last, [class*='summary'], [class*='abstract'], [class*='desc'], [class*='content']"
      );
      if ($snippet.length > 0) {
        snippet = $snippet.text().trim().replace(/\s+/g, " ");
      }

      // 清理媒体名称和日期
      if (media.includes("百度") || media.includes("baidu")) {
        media = "";
      }
      if (date && (date.includes("百度") || date.includes("baidu") || date === media)) {
        date = ""; // date 一般不会与 media 相同
      }

      results.push({
        title,
        url,
        date: normalizeDate(date),
        media: media || extractMediaFromTitle(title) || "未知来源",
        snippet: snippet || "",
      });
    });

    // 如果策略1没结果，尝试策略2：直接用正则
    if (results.length === 0) {
      return parseWithRegex(html);
    }

    return results;
  } catch (error) {
    console.error("解析百度新闻 HTML 异常:", error);
    return [];
  }
}

/**
 * 正则备用解析方案
 * 当 cheerio 选择器匹配不到时使用
 */
function parseWithRegex(html: string): BaiduNewsResult[] {
  const results: BaiduNewsResult[] = [];

  // 匹配百度新闻搜索结果中的新闻块
  // 格式：标题链接 + 来源 + 时间
  const newsBlockRegex = /<h3[^>]*class="[^"]*news-title[^"]*"[^>]*>[\s\S]*?<\/h3>/gi;
  const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i;
  const sourceRegex = /<span[^>]*class="[^"]*c-color-gray[^"]*"[^>]*>([^<]*)<\/span>/gi;

  let match;
  while ((match = newsBlockRegex.exec(html)) !== null) {
    const block = match[0];
    const linkMatch = block.match(linkRegex);
    if (!linkMatch) continue;

    const url = linkMatch[1];
    const title = linkMatch[2].replace(/<[^>]+>/g, "").trim();

    if (!title || title.length < 3) continue;
    results.push({
      title,
      url,
      date: "",
      media: "",
      snippet: "",
    });
  }

  // 提取来源和日期
  let sourceIdx = 0;
  let sourceMatch;
  while ((sourceMatch = sourceRegex.exec(html)) !== null) {
    const text = sourceMatch[1].trim();
    if (text && sourceIdx < results.length) {
      // 判断是来源还是日期
      if (/\d/.test(text) && text.length < 20) {
        results[sourceIdx].date = normalizeDate(text);
      } else if (!results[sourceIdx].media && text.length < 30) {
        results[sourceIdx].media = text;
      } else if (text.length < 20) {
        results[sourceIdx].date = normalizeDate(text);
      } else {
        results[sourceIdx].snippet = text;
      }
      sourceIdx = (sourceIdx + 1) % (results.length * 2);
    }
  }

  return results.filter((r) => r.title.length >= 3);
}

/**
 * 从标题中推断媒体名（兜底策略）
 */
function extractMediaFromTitle(title: string): string {
  // 常见模式："某某报/某某网：标题内容"
  const patterns = [
    /[：:]?\s*(.+?)[：:]\s*.+/,
  ];
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match && match[1] && match[1].length < 30) {
      return match[1];
    }
  }
  return "";
}

/**
 * 日期标准化
 * 支持的格式：
 * - "2024年12月15日" → "2024-12-15"
 * - "12月15日" → "2024-12-15" (当年)
 * - "12-15" → "2024-12-15"
 * - "2小时前" → 计算
 * - "昨天" → 昨天日期
 */
function normalizeDate(dateStr: string): string {
  if (!dateStr) return "";

  const now = new Date();
  const year = now.getFullYear();

  // 中文日期：2024年12月15日
  let match = dateStr.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }

  // 中文日期（无年）：12月15日
  match = dateStr.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (match) {
    return `${year}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  }

  // ISO 格式：2024-12-15
  match = dateStr.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }

  // "x小时前" / "x分钟前"
  match = dateStr.match(/(\d+)\s*小时前/);
  if (match) {
    const d = new Date(now.getTime() - parseInt(match[1]) * 3600000);
    return d.toISOString().split("T")[0];
  }
  match = dateStr.match(/(\d+)\s*分钟前/);
  if (match) {
    const d = new Date(now.getTime() - parseInt(match[1]) * 60000);
    return d.toISOString().split("T")[0];
  }

  // "昨天"
  if (dateStr.includes("昨天")) {
    const d = new Date(now.getTime() - 86400000);
    return d.toISOString().split("T")[0];
  }

  // "x天前"
  match = dateStr.match(/(\d+)\s*天前/);
  if (match) {
    const d = new Date(now.getTime() - parseInt(match[1]) * 86400000);
    return d.toISOString().split("T")[0];
  }

  // 只含数字的短格式：12-15
  match = dateStr.match(/(\d{1,2})-(\d{1,2})/);
  if (match && dateStr.length <= 5) {
    return `${year}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  }

  return dateStr;
}

/**
 * 百度新闻扩展关键词
 */
export function expandKeywords(keyword: string): string[] {
  const base = keyword.trim();
  if (!base) return [];

  const keywords = [base];

  // 如果包含公司/单位名，添加简称变体
  if (base.length > 4) {
    const shortName = base
      .replace(/有限公司|股份有限公司|集团有限公司|集团|有限责任公司/g, "")
      .trim();
    if (shortName !== base && shortName.length >= 2) {
      keywords.push(shortName);
    }
  }

  return keywords;
}
