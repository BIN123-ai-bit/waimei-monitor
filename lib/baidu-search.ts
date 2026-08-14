// 百度新闻搜索抓取
// 完全免费，专注国内媒体覆盖
// 解析 news.baidu.com 搜索结果

export interface BaiduNewsResult {
  title: string;
  url: string;
  date: string;
  media: string;
  snippet: string;
}

/**
 * 搜索百度新闻
 */
export async function searchBaiduNews(
  keyword: string,
  daysBack: number = 30,
  maxResults: number = 30
): Promise<BaiduNewsResult[]> {
  const encodedKeyword = encodeURIComponent(keyword);

  // 时间戳计算
  const now = new Date();
  const et = Math.floor(now.getTime() / 1000);
  const startDate = new Date(now.getTime() - daysBack * 86400000);
  const bt = Math.floor(startDate.getTime() / 1000);

  const allResults: BaiduNewsResult[] = [];
  let page = 0;
  const maxPages = Math.ceil(maxResults / 10) + 1;

  try {
    while (allResults.length < maxResults && page < maxPages) {
      const pn = page * 10;
      const url = `https://news.baidu.com/ns?word=${encodedKeyword}&pn=${pn}&cl=2&ct=1&tn=news&rn=10&bt=${bt}&et=${et}&ie=utf-8`;

      const html = await fetchPage(url);
      if (!html) break;

      const results = parseBaiduHTML(html);
      if (results.length === 0) break;

      allResults.push(...results);
      page++;

      // 请求间延迟
      await new Promise((r) => setTimeout(r, 600 + Math.random() * 800));
    }
  } catch (error) {
    console.error("百度新闻搜索异常:", error);
  }

  // 去重
  const seen = new Set<string>();
  return allResults
    .filter((r) => {
      const key = (r.url || r.title).slice(0, 100);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxResults);
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });

    if (!response.ok) return null;

    const ct = response.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml"))
      return null;

    return await response.text();
  } catch {
    return null;
  }
}

/**
 * 解析百度新闻 HTML（基于 2026 年 8 月实际页面结构）
 *
 * 每条结果的结构：
 * <div class="result-molecule new-pmd">
 *   <div>
 *     <h3 class="news-title_1YtI1">
 *       <a href="真实链接" target="_blank">文章标题</a>
 *     </h3>
 *   </div>
 *   <div> <!-- 摘要 --> </div>
 *   <div class="news-source_Xj4Dv">
 *     <a class="source-link_Ft1ov" href="来源链接">
 *       <span class="c-color-gray" aria-label="新闻来源：媒体名">媒体名</span>
 *     </a>
 *   </div>
 * </div>
 *
 * 日期以相对时间出现在摘要上方：如"5天前"、"1小时前"
 */
function parseBaiduHTML(html: string): BaiduNewsResult[] {
  // 1. 分割成独立的结果块
  const blocks = splitIntoBlocks(html);
  if (blocks.length === 0) return [];

  const results: BaiduNewsResult[] = [];

  for (const block of blocks) {
    // 提取标题和链接（从 news-title h3 中的 a 标签）
    const titleMatch = block.match(
      /<h3[^>]*class="[^"]*news-title[^"]*"[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i
    );
    if (!titleMatch) continue;

    const rawUrl = titleMatch[1];
    const title = titleMatch[2].replace(/<[^>]+>/g, "").trim();
    if (!title || title.length < 4) continue;

    // 提取媒体名（从 aria-label="新闻来源：XXX"）
    const sourceMatch = block.match(/aria-label="新闻来源：([^"]*)"/);
    let media = sourceMatch ? sourceMatch[1] : "";

    // 备用：从 source-link 的 href 提取域名
    if (!media) {
      const sourceUrlMatch = block.match(
        /<a[^>]*class="[^"]*source-link[^"]*"[^>]*href="([^"]*)"/
      );
      if (sourceUrlMatch) {
        media = extractDomainName(sourceUrlMatch[1]);
      }
    }

    // 提取日期（从 aria-label="发布于：XXX"）
    const dateMatch = block.match(/aria-label="发布于：([^"]*)"/);
    let date = dateMatch ? dateMatch[1] : "";

    // 如果 aria-label 没找到日期，用相对时间正则兜底
    if (!date) {
      const datePatterns = [
        /(\d+)\s*天前/,
        /(\d+)\s*小时前/,
        /(\d+)\s*分钟前/,
        /(\d{1,2})月(\d{1,2})日/,
      ];
      for (const pattern of datePatterns) {
        const m = block.match(pattern);
        if (m) {
          date = m[0];
          break;
        }
      }
    }

    // 提取摘要（去除 HTML 标签后的纯文本）
    const snippet = block
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .replace(new RegExp(title, "g"), "")
      .trim()
      .slice(0, 200);

    results.push({
      title,
      url: rawUrl,
      date: normalizeRelativeDate(date),
      media: media || "未知来源",
      snippet,
    });
  }

  return results;
}

/**
 * 把百度新闻 HTML 按结果块分割
 * 每条结果以包含 news-title_1YtI1 的 h3 开始
 */
function splitIntoBlocks(html: string): string[] {
  // 找到所有 h3 news-title 的位置，以此为分割点
  const titles = [];
  const re = /<h3[^>]*class="[^"]*news-title[^"]*"[^>]*>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    titles.push(match.index);
  }

  const blocks: string[] = [];
  // 每个 block：从 h3 开始，取 ~1500 字符（足够覆盖一条结果）
  for (const pos of titles) {
    const block = html.slice(pos, pos + 1500);
    blocks.push(block);
  }

  return blocks;
}

/**
 * 从 URL 提取域名简称
 */
function extractDomainName(url: string): string {
  try {
    const hn = new URL(url).hostname.replace(/^www\./, "");
    // 知名域名映射
    const domainMap: Record<string, string> = {
      "baijiahao.baidu.com": "百度百家号",
      "m.thepaper.cn": "澎湃新闻",
      "thepaper.cn": "澎湃新闻",
      "sina.com.cn": "新浪",
      "finance.sina.com.cn": "新浪财经",
      "sohu.com": "搜狐",
      "163.com": "网易",
      "qq.com": "腾讯",
      "ifeng.com": "凤凰网",
      "xinhuanet.com": "新华网",
      "people.com.cn": "人民网",
      "cctv.com": "央视网",
      "chinanews.com": "中新网",
      "gmw.cn": "光明网",
      "youth.cn": "中国青年网",
      "ce.cn": "中国经济网",
      "huanqiu.com": "环球网",
      "cscec.com": "中国建筑",
    };
    for (const [domain, name] of Object.entries(domainMap)) {
      if (hn.includes(domain)) return name;
    }
    return hn;
  } catch {
    return url;
  }
}

/**
 * 日期标准化
 */
function normalizeRelativeDate(dateStr: string): string {
  if (!dateStr) return "";

  const now = new Date();

  // "今天" / "昨天" / "前天"
  if (dateStr.includes("今天")) return toDateStr(now);
  if (dateStr.includes("昨天")) return toDateStr(new Date(now.getTime() - 86400000));
  if (dateStr.includes("前天")) return toDateStr(new Date(now.getTime() - 2 * 86400000));

  // "5天前"
  let m = dateStr.match(/(\d+)\s*天前/);
  if (m) {
    return toDateStr(new Date(now.getTime() - parseInt(m[1]) * 86400000));
  }

  // "3小时前"
  m = dateStr.match(/(\d+)\s*小时前/);
  if (m) {
    return toDateStr(new Date(now.getTime() - parseInt(m[1]) * 3600000));
  }

  // "10分钟前"
  m = dateStr.match(/(\d+)\s*分钟前/);
  if (m) {
    return toDateStr(new Date(now.getTime() - parseInt(m[1]) * 60000));
  }

  // "8月12日" → 当年
  m = dateStr.match(/(\d{1,2})月(\d{1,2})日/);
  if (m) {
    return `${now.getFullYear()}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }

  // "2026-08-12"
  m = dateStr.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }

  return dateStr;
}

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

/**
 * 扩展搜索关键词
 */
export function expandKeywords(keyword: string): string[] {
  const base = keyword.trim();
  if (!base) return [];

  const keywords = [base];

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
