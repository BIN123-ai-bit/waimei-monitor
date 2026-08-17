// ============================================================
// 媒体名校对器
// 问题：搜索引擎给出的"来源"常是平台名（百度百家号/搜狐网/QQ News）
//       或原始域名（news.cnr.cn），不是文章的真实媒体名，
//       导致统计表里的媒体名需要人工逐一核对。
// 解决：
//   ① 域名 → 官方媒体名字典（零耗时，直接翻译原始域名）
//   ② 对平台链接抓取文章网页，提取网页上标注的真实来源
//   ③ 提取不到时保留原名（宁可不改，绝不改错）
// ============================================================

export interface MediaVerifyTarget {
  media: string;
  url: string;
  source: "news" | "wechat";
}

export interface MediaVerificationStats {
  /** 打开网页核对的条数 */
  checked: number;
  /** 成功修正媒体名的条数 */
  corrected: number;
  /** 需要核对但抓取失败/提取不到的条数（保留原名） */
  skipped: number;
}

// ============================================================
// ① 域名 → 官方媒体名字典
// 匹配方式：域名含关键字即命中（长域名优先，避免误匹配）
// ============================================================

const DOMAIN_MEDIA_MAP: Array<[string, string]> = [
  ["chinanews.com.cn", "中国新闻网"],
  ["nmgnews.com.cn", "内蒙古新闻网"],
  ["caacnews.com.cn", "中国民航网"],
  ["chinadaily.com.cn", "中国日报网"],
  ["legaldaily.com.cn", "法治日报"],
  ["mot.gov.cn", "交通运输部"],
  ["crecg.com", "中国中铁"],
  ["carnoc.com", "民航资源网"],
  ["xinhuanet.com", "新华网"],
  ["people.com.cn", "人民网"],
  ["jiemian.com", "界面新闻"],
  ["52hrtt.com", "华人头条"],
  ["workercn.cn", "工人日报"],
  ["qstheory.cn", "求是网"],
  ["thepaper.cn", "澎湃新闻"],
  ["eastday.com", "东方网"],
  ["yicai.com", "第一财经"],
  ["caixin.com", "财新"],
  ["huanqiu.com", "环球网"],
  ["cctv.com", "央视网"],
  ["china.com.cn", "中国网"],
  ["youth.cn", "中国青年网"],
  ["cri.cn", "国际在线"],
  ["cnr.cn", "央广网"],
  ["81.cn", "中国军网"],
  ["gmw.cn", "光明网"],
  ["ce.cn", "中国经济网"],
];

/**
 * 从 URL 域名翻译出官方媒体名（含域名格式的媒体名，如 "news.cnr.cn"）
 */
export function mediaNameFromDomain(input: string): string | null {
  if (!input) return null;
  const lowered = input.toLowerCase();
  for (const [fragment, name] of DOMAIN_MEDIA_MAP) {
    if (lowered.includes(fragment)) return name;
  }
  return null;
}

// ============================================================
// ② 不可信媒体名识别
// 平台名（真实来源藏在网页里）或原始域名（字典翻译不了才抓网页）
// ============================================================

const PLATFORM_PREFIXES = [
  "百度百家号",
  "百家号",
  "搜狐",
  "网易",
  "腾讯",
  "QQ News",
  "新浪",
  "凤凰",
  "澎湃",
  "一点资讯",
  "今日头条",
  "头条号",
  "趣头条",
  "微信公众号",
  "未知来源",
];

const RAW_DOMAIN_RE =
  /^[a-zA-Z0-9.-]+\.(com|cn|net|org|gov\.cn|edu\.cn|com\.cn|cc|io|me)(\/.*)?$/i;

/** 媒体名是否是标题混入的垃圾标签（"XX亮相内蒙古博物院_凤凰网"这类） */
function isTitleArtifactName(name: string): boolean {
  return name.includes("_") || /[""“”]/.test(name);
}

/** 媒体名是否不可信（需要字典翻译或抓网页核对） */
export function isUnreliableMediaName(name: string): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  if (!trimmed || trimmed === "未知来源") return true;
  // 纯域名的名字（news.cnr.cn、CARNOC.com、qq.com）
  if (!/[一-龥]/.test(trimmed) && RAW_DOMAIN_RE.test(trimmed)) return true;
  // 标题混入媒体名的 Google 来源标签
  if (isTitleArtifactName(trimmed)) return true;
  // 平台名
  return PLATFORM_PREFIXES.some((p) => trimmed.startsWith(p));
}

// ============================================================
// ③ 网页抓取 + 真实来源提取
// ============================================================

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

async function fetchArticlePage(
  url: string
): Promise<{ html: string; finalUrl: string } | null> {
  try {
    // 完整浏览器请求头（百家号等站点会校验，缺了返回"百度安全验证"）
    const response = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(4000),
      redirect: "follow",
    });

    if (!response.ok) return null;
    const ct = response.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml"))
      return null;

    const text = await response.text();
    // 安全验证页/空页直接放弃
    if (text.length < 1000) return null;
    if (/百度安全验证|安全验证|请输入验证码/.test(text.slice(0, 3000))) return null;
    return { html: text, finalUrl: response.url };
  } catch {
    return null;
  }
}

/** 名称是否可信（提取到的名字必须通过校验才采用）
 *  allowPlatform=true 时允许平台名（用于原名是标题混入的垃圾标签时，
 *  网页里的平台名也比垃圾标签好——如"XX亮相_凤凰网"这类）
 */
function isPlausibleMediaName(name: string, allowPlatform = false): boolean {
  const n = name
    .replace(/^(官方|来自)?(账号|帐号|媒体|来源)[：:]?/, "")
    .replace(/(官方)?(百家号|搜狐号|网易号|企鹅号|头条号|澎湃号|公众号|账号|帐号)$/, "")
    .trim();

  if (n.length < 2 || n.length > 40) return false;
  // 必须含中文（排除纯域名/英文杂名）
  if (!/[一-龥]/.test(n)) return false;
  // 含引号的是标题残片（如"新疆历史文化展”亮相…"），不是媒体名
  if (/[""“”]/.test(n)) return false;
  if (!allowPlatform && PLATFORM_PREFIXES.some((p) => n.startsWith(p))) return false;
  if (/^[\d\s]+$/.test(n)) return false;
  return true;
}

function cleanCandidate(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[\s\xa0]+/g, " ")
    .trim()
    .replace(/^[，。；：:、\-_|/]+/, "")
    .replace(/[，。；：:、]+$/, "");
}

/**
 * 从文章网页 HTML 提取真实媒体名
 * 按可信度从高到低依次尝试：
 *   1. meta mediaid（搜狐号转载页，content 即真实来源）
 *   2. author-name 标签（百家号账号名）
 *   3. nickname（微信公众号）
 *   4. "来源：XXX" 标注（腾讯/新浪/网易/澎湃号等转载页通用）
 *   5. og:site_name / meta source
 *   6. <title> 末尾的 "标题_媒体名" / "标题 - 媒体名"
 * @param allowPlatform 允许返回平台名（原名是标题混入的垃圾标签时才开）
 */
export function extractRealMediaName(html: string, allowPlatform = false): string | null {
  if (!html) return null;

  // 1. meta mediaid（搜狐号）
  let m = html.match(/<meta[^>]*name="mediaid"[^>]*content="([^"]+)"/i);
  if (m && isPlausibleMediaName(m[1], allowPlatform)) return cleanCandidate(m[1]);

  // 2. 百家号账号名标签（data-testid 或 class 里的 author-name）
  m = html.match(/<[^>]*data-testid="[^"]*author-name[^"]*"[^>]*>\s*([^<]{2,40})\s*</i);
  if (!m) m = html.match(/<[^>]*class="[^"]*author-name[^"]*"[^>]*>\s*([^<]{2,40})\s*</i);
  if (m && isPlausibleMediaName(m[1], allowPlatform)) return cleanCandidate(m[1]);

  // 3. 微信公众号昵称
  m = html.match(/var\s+nickname\s*=\s*[^"']*["']([^"']{2,40})["']/i);
  if (!m) m = html.match(/["']nickname["']\s*[:=]\s*["']([^"']{2,40})["']/i);
  if (m && isPlausibleMediaName(m[1], allowPlatform)) return cleanCandidate(m[1]);

  // 4. "来源：XXX" 标注（转载页通用）
  //    逐个尝试所有出现位置，取第一个可信的（页面里常有空标注或 JSON 转义文本）
  const sourceRe = /来源[：:]\s*/g;
  let sm;
  while ((sm = sourceRe.exec(html)) !== null) {
    // 来源文本可能跨多个 span 拼接（腾讯新闻），先解码 JSON 转义再去除所有标签
    const tail = html.slice(sm.index + sm[0].length, sm.index + sm[0].length + 600);
    const decoded = tail.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
    let text = decoded.replace(/<[^>]*>/g, " ");
    // 被标签截断的同一个词拼回去（"呼和浩" + "特本地宝综合整理" → 一个词）
    text = text.replace(/([一-龥])\s+([一-龥])/g, "$1$2");
    // 截掉"责任编辑"等跟在来源后面的标注/正文
    const cut = text.search(
      /(责任编辑|审核|校对|编辑|作者|责编|声明|图片|摄影|版权|记者|文\/|图\/|综合整理|整理|供稿|原标题|素材来源|\s\d)/
    );
    const candidate = cleanCandidate(cut >= 0 ? text.slice(0, cut) : text);
    // 多来源行（"来源：A、B，C"）取最后一个——通常是本篇的最终来源
    const segs = candidate
      .split(/[、，,;；｜|]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const name = segs.length > 0 ? segs[segs.length - 1] : candidate;
    if (isPlausibleMediaName(name, allowPlatform)) return name;
  }

  // 5. og:site_name / meta source
  m = html.match(/<meta[^>]*property="og:site_name"[^>]*content="([^"]+)"/i);
  if (!m) m = html.match(/<meta[^>]*name="source"[^>]*content="([^"]+)"/i);
  if (m && isPlausibleMediaName(m[1], allowPlatform)) return cleanCandidate(m[1]);

  // 6. <title> 末尾的 "标题_媒体名" / "标题 - 媒体名"
  const t = html.match(/<title>([^<]*)<\/title>/i);
  if (t) {
    const title = cleanCandidate(t[1]);
    for (const sep of [" - ", "_", "—", "|"]) {
      const idx = title.lastIndexOf(sep);
      if (idx > 0 && idx + sep.length < title.length) {
        const suffix = title.slice(idx + sep.length).trim();
        if (isPlausibleMediaName(suffix, allowPlatform)) return suffix;
      }
    }
  }

  return null;
}

// ============================================================
// ④ 主入口：核对并修正媒体名（原地修改 item.media）
// ============================================================

async function runPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

/**
 * 核对结果里的媒体名并原地修正
 * - 微信结果跳过（TikHub 返回的公众号名已是真实来源）
 * - 先走域名字典（零耗时），翻译不了的平台名才抓网页
 * @param items 需要核对的结果数组（会被原地修改 media 字段）
 * @param opts.maxPages 每次最多打开多少个网页（保护请求时长）
 * @param opts.concurrency 网页抓取并发数
 * @param opts.deadlineMs 核对环节的总时长上限（到点不再开新网页，剩余条目保留原名。
 *                        Netlify 函数约 30 秒超时，核对必须留出预算）
 */
export async function verifyMediaNames(
  items: MediaVerifyTarget[],
  opts: { maxPages?: number; concurrency?: number; deadlineMs?: number } = {}
): Promise<MediaVerificationStats> {
  const { maxPages = 40, concurrency = 6, deadlineMs = 8000 } = opts;
  const stats: MediaVerificationStats = { checked: 0, corrected: 0, skipped: 0 };

  // 第一步：域名字典（零耗时）
  // 名字是原始域名 → 直接用名字翻译；URL 域名也试（如 Google 给的名字和域名不一致）
  for (const item of items) {
    if (item.source !== "news") continue;
    const fromName = mediaNameFromDomain(item.media);
    const fromUrl = mediaNameFromDomain(item.url);
    const fixed = fromName || fromUrl;
    if (fixed && isUnreliableMediaName(item.media)) {
      item.media = fixed;
      stats.corrected++;
    }
  }

  // 第二步：网页核对（域名字典翻译不了的平台名）
  const seenUrls = new Set<string>();
  const toFetch = items.filter((item) => {
    if (item.source !== "news") return false;
    if (!isUnreliableMediaName(item.media)) return false;
    if (!/^https?:\/\//i.test(item.url)) return false;
    if (seenUrls.has(item.url)) return false;
    seenUrls.add(item.url);
    return true;
  });

  const toVerify = toFetch.slice(0, maxPages);
  stats.skipped += toFetch.length - toVerify.length;

  // 总时限：到点不再开新网页，剩余条目保留原名
  const deadline = Date.now() + deadlineMs;
  await runPool(toVerify, concurrency, async (item) => {
    if (Date.now() > deadline) {
      stats.skipped++;
      return;
    }
    stats.checked++;
    const page = await fetchArticlePage(item.url);
    if (!page) {
      stats.skipped++;
      return;
    }
    // 跟随跳转得到真实网址，顺带修正链接（Google 链接还原失败的兜底）
    if (
      page.finalUrl &&
      page.finalUrl !== item.url &&
      !page.finalUrl.includes("news.google.com")
    ) {
      item.url = page.finalUrl;
    }
    // 原名是标题垃圾标签时，允许用网页里的平台名兜底（总比垃圾标签好）
    const name = extractRealMediaName(page.html, isTitleArtifactName(item.media));
    if (name) {
      item.media = name;
      stats.corrected++;
    } else {
      stats.skipped++;
    }
  });

  return stats;
}
