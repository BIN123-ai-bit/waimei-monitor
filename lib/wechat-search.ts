// 搜狗微信搜索抓取
// 用于补充微信公众号文章覆盖
// 注意：搜狗微信搜索是国内唯一可程序化访问的微信公众号文章搜索引擎
// 通过服务器端 HTTP 请求 + HTML 解析提取文章信息

export interface WechatArticle {
  title: string;
  url: string;
  date: string;
  media: string; // 公众号名称
  snippet: string;
}

// 搜狗微信搜索结果项
interface SogouWechatItem {
  title: string;
  url: string;
  date: string;
  accountName: string;
  snippet: string;
}

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
    const url = `https://weixin.sogou.com/weixin?type=2&query=${encodedQuery}&ie=utf8`;

    // 服务器端请求，模拟浏览器行为
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        Referer: "https://weixin.sogou.com/",
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(10000), // 10秒超时
    });

    if (!response.ok) {
      console.warn(`搜狗微信搜索返回 ${response.status}，可能需要验证`);
      return [];
    }

    const html = await response.text();

    // 检查是否被反爬
    if (html.includes("请输入验证码") || html.includes("302")) {
      console.warn("搜狗微信搜索触发验证码，跳过微信搜索");
      return [];
    }

    // 解析 HTML 提取文章信息
    const articles = parseSogouWechatHTML(html);

    return articles.slice(0, maxResults).map((a) => ({
      ...a,
      media: a.accountName,
    }));
  } catch (error) {
    console.error("搜狗微信搜索异常:", error);
    return [];
  }
}

/**
 * 解析搜狗微信搜索结果 HTML
 * 搜狗微信搜索结果页面结构：
 * <ul class="news-list2">
 *   <li>
 *     <div class="txt-box">
 *       <h3><a>标题</a></h3>
 *       <p class="txt-info">公众号名称 | 日期</p>
 *       <p class="s-p">摘要</p>
 *     </div>
 *   </li>
 * </ul>
 */
function parseSogouWechatHTML(html: string): SogouWechatItem[] {
  const results: SogouWechatItem[] = [];

  try {
    // 匹配每个 <li> 新闻项
    // 搜狗的 HTML 结构较复杂，使用正则提取关键信息
    const itemRegex =
      /<li[^>]*class="[^"]*news-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    // 备选：搜狗微信的列表项可能有不同的 class
    const altItemRegex = /<li[^>]*>([\s\S]*?)(?=<li[^>]*>|$)/gi;

    // 先用第一个正则尝试
    let match;
    const items: string[] = [];

    // 方法1：按 <li> 分割
    const liMatches = html.match(
      /<li[^>]*class="[^"]*(?:news-item|news-list-item|item)[^"]*"[^>]*>[\s\S]*?<\/li>/gi
    );
    if (liMatches && liMatches.length > 0) {
      items.push(...liMatches);
    } else {
      // 方法2：直接用正则提取标题+链接+摘要
      const titleRegex =
        /<a[^>]*href="(\/link\?url=[^"]*)"[^>]*>(.*?)<\/a>/gi;
      const titles: Array<{ url: string; text: string }> = [];

      while ((match = titleRegex.exec(html)) !== null) {
        titles.push({
          url: "https://weixin.sogou.com" + match[1],
          text: match[2].replace(/<[^>]+>/g, "").trim(),
        });
      }

      // 提取公众号名称和日期
      const infoRegex =
        /<p[^>]*class="[^"]*txt-info[^"]*"[^>]*>(.*?)<\/p>/gi;
      const infos: string[] = [];
      while ((match = infoRegex.exec(html)) !== null) {
        infos.push(match[1].replace(/<[^>]+>/g, "").trim());
      }

      // 提取摘要
      const snippetRegex = /<p[^>]*class="[^"]*s-p[^"]*"[^>]*>(.*?)<\/p>/gi;
      const snippets: string[] = [];
      while ((match = snippetRegex.exec(html)) !== null) {
        snippets.push(match[1].replace(/<[^>]+>/g, "").trim());
      }

      // 组合
      for (let i = 0; i < titles.length && i < 30; i++) {
        const infoParts = (infos[i] || "").split("|").map((s) => s.trim());
        const accountName = infoParts[0] || "微信公众号";
        const dateStr = infoParts[1] || "";

        results.push({
          title: titles[i].text || "无标题",
          url: titles[i].url || "",
          date: normalizeWechatDate(dateStr),
          accountName,
          snippet: snippets[i] || "",
        });
      }

      return results;
    }

    // 方法3：逐项解析
    for (const item of items) {
      const titleMatch = item.match(
        /<a[^>]*href="(\/link\?url=[^"]*)"[^>]*>(.*?)<\/a>/i
      );
      if (!titleMatch) continue;

      const url = "https://weixin.sogou.com" + titleMatch[1];
      const title = titleMatch[2].replace(/<[^>]+>/g, "").trim();

      // 提取公众号名称和日期
      const infoMatch = item.match(
        /<p[^>]*class="[^"]*txt-info[^"]*"[^>]*>(.*?)<\/p>/i
      );
      let accountName = "微信公众号";
      let dateStr = "";
      if (infoMatch) {
        const infoText = infoMatch[1].replace(/<[^>]+>/g, "").trim();
        const infoParts = infoText.split("|").map((s) => s.trim());
        accountName = infoParts[0] || accountName;
        dateStr = infoParts[1] || "";
      }

      // 提取摘要
      const snippetMatch = item.match(
        /<p[^>]*class="[^"]*s-p[^"]*"[^>]*>(.*?)<\/p>/i
      );
      const snippet = snippetMatch
        ? snippetMatch[1].replace(/<[^>]+>/g, "").trim()
        : "";

      if (title) {
        results.push({
          title,
          url,
          date: normalizeWechatDate(dateStr),
          accountName,
          snippet,
        });
      }
    }
  } catch (error) {
    console.error("解析搜狗微信 HTML 异常:", error);
  }

  return results;
}

/**
 * 标准化微信文章日期
 * 搜狗可能返回 "2小时前"、"昨天"、"2024-12-15" 等格式
 */
function normalizeWechatDate(dateStr: string): string {
  if (!dateStr) {
    // 返回今天的日期
    return new Date().toISOString().split("T")[0];
  }

  const now = new Date();

  // "x小时前"
  const hoursMatch = dateStr.match(/(\d+)\s*小时前/);
  if (hoursMatch) {
    const hours = parseInt(hoursMatch[1]);
    const d = new Date(now.getTime() - hours * 3600000);
    return d.toISOString().split("T")[0];
  }

  // "x天前"
  const daysMatch = dateStr.match(/(\d+)\s*天前/);
  if (daysMatch) {
    const days = parseInt(daysMatch[1]);
    const d = new Date(now.getTime() - days * 86400000);
    return d.toISOString().split("T")[0];
  }

  // "昨天"
  if (dateStr.includes("昨天")) {
    const d = new Date(now.getTime() - 86400000);
    return d.toISOString().split("T")[0];
  }

  // "x分钟前" → 今天
  if (dateStr.includes("分钟前") || dateStr.includes("刚刚")) {
    return now.toISOString().split("T")[0];
  }

  // 标准化日期格式
  const match = dateStr.match(/(\d{4})[-\/年](\d{1,2})[-\/月](\d{1,2})/);
  if (match) {
    const year = match[1];
    const month = match[2].padStart(2, "0");
    const day = match[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return now.toISOString().split("T")[0];
}
