import { NextRequest, NextResponse } from "next/server";
import { searchAllNews, type SearchOptions } from "@/lib/multi-search";
import { searchWechatArticles } from "@/lib/tikhub-search";
import {
  classifyResults,
  classifyWithAI,
  applyAIClassifications,
  sortByCategory,
  isSelfMediaPlatform,
  type ClassifiedResult,
} from "@/lib/media-classifier";
import { deduplicate } from "@/lib/deduplicate";
import { scoreReportQuality } from "@/lib/report-scorer";
import { matchProjectKeywords, generateSearchQueries, generateLiteralVariants, buildLiteralCoOccur } from "@/data/project-keywords";

// ============================================================
// 类型
// ============================================================

interface SearchOneProjectResult {
  results: ClassifiedResult[];
  /** 被过滤掉的内容及原因（返回给用户分类展示） */
  filtered: FilteredItem[];
  projectName: string;
  /** 过滤前原始搜索到的数量（用于向用户展示过滤效果） */
  rawCount: number;
}

interface FilteredItem {
  date: string;
  title: string;
  media: string;
  url: string;
  snippet: string;
  source: "news" | "wechat";
  filterReason: string;
}

// ============================================================
// 噪音规则（每条规则对应一个过滤原因，用于展示）
// ============================================================

const NOISE_RULES: { re: RegExp; reason: string }[] = [
  { re: /专利/, reason: "专利公告" },
  { re: /招聘|求职|招人|诚聘|年薪|五险一金|岗位|社招|校招|实习|管培生/, reason: "招聘求职" },
  { re: /招标公告|中标候选人|中标公示|招标文件|采购公告|询价公告|竞争性磋商|比选公告/, reason: "招标中标" },
  { re: /^(关于|关于做好|关于组织|关于开展|关于召开).*(通知|公告)$/, reason: "通知公告" },
  { re: /股票|基金净值|A股|港股|涨停|跌停/, reason: "股票基金" },
  { re: /广告|推广|促销|优惠|打折|免费领取/, reason: "广告推广" },
];

function findNoiseReason(title: string, snippet: string): string | null {
  const t = title + snippet;
  for (const rule of NOISE_RULES) {
    if (rule.re.test(t)) return rule.reason;
  }
  return null;
}

interface FailedProject {
  keyword: string;
  error: string;
}

// ============================================================
// 并发执行（限制并发数，避免搜索引擎限流）
// ============================================================

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

// ============================================================
// Google News 跳转链接还原
// news.google.com/rss/articles/... 在国内无法访问，
// 由服务器（海外）还原成文章真实网址：
//   方案1：跟随跳转（快速，多数链接直接 302）
//   方案2：Google batchexecute 接口解码（新格式链接）
// ============================================================

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

// URL 清洗：去掉 HTML 转义符（&amp; 等），否则链接打不开
function cleanUrlEntities(url: string): string {
  return url
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

async function decodeViaBatchExecute(base64Str: string): Promise<string | null> {
  try {
    // 1. 从 Google 页面获取签名和时间戳（先 /articles/ 后 /rss/articles/ 备用）
    let html = "";
    for (const pathPrefix of ["articles", "rss/articles"]) {
      try {
        const pageRes = await fetch(`https://news.google.com/${pathPrefix}/${base64Str}`, {
          headers: { "User-Agent": BROWSER_UA },
          signal: AbortSignal.timeout(5000),
        });
        if (pageRes.ok) {
          html = await pageRes.text();
          if (html.includes("data-n-a-sg")) break;
        }
      } catch {
        // 尝试下一个路径
      }
    }
    const sg = html.match(/data-n-a-sg="([^"]*)"/);
    const ts = html.match(/data-n-a-ts="([^"]*)"/);
    if (!sg || !ts) return null;

    // 2. 调用 batchexecute 接口解码
    const payload = [
      "Fbv4je",
      `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${base64Str}",${ts[1]},"${sg[1]}"]`,
    ];
    const formBody = `f.req=${encodeURIComponent(JSON.stringify([[payload]]))}`;
    const res = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": BROWSER_UA,
      },
      body: formBody,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    const jsonPart = text.split("\n\n")[1];
    if (!jsonPart) return null;
    const parsed = JSON.parse(jsonPart);
    const inner = parsed[0][2];
    const decoded = JSON.parse(inner)[1];
    if (typeof decoded === "string" && decoded.startsWith("http")) return decoded;
    return null;
  } catch {
    return null;
  }
}

async function resolveGoogleNewsUrls(
  results: Array<{ url: string }>,
  maxResolve: number = 25
): Promise<void> {
  const targets = results.filter((r) => r.url.includes("news.google.com"));
  const toResolve = targets.slice(0, maxResolve);
  if (toResolve.length === 0) return;

  let resolved = 0;
  await runWithConcurrency(toResolve, 6, async (item) => {
    const original = item.url;

    // 方案1：跟随跳转还原（最多尝试 2 次）
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(original, {
          redirect: "follow",
          signal: AbortSignal.timeout(5000),
          headers: { "User-Agent": BROWSER_UA },
        });
        if (res.url && !res.url.includes("news.google.com")) {
          item.url = res.url;
          resolved++;
          return;
        }
      } catch {
        // 单次失败继续重试
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    // 方案2：batchexecute 接口解码（新格式链接）
    const m = original.match(/\/articles\/([^?]+)/);
    if (m) {
      const real = await decodeViaBatchExecute(m[1]);
      if (real) {
        item.url = real;
        resolved++;
      }
    }
  });
  console.log(`[链接还原] 还原 ${resolved}/${toResolve.length} 个 Google 链接`);
}

// ============================================================
// 搜索单个项目（容错包装）
// ============================================================

async function searchOneProject(
  keyword: string,
  dateFrom: string,
  dateTo: string,
  mode: "all" | "news" | "wechat" = "all"
): Promise<SearchOneProjectResult> {
  // 1. 匹配项目关键词库获取别名
  const matched = matchProjectKeywords(keyword);
  const projectName = matched.length > 0 ? matched[0].matched.primary : keyword;

  // 2. 生成搜索查询词列表
  let searchQueries: string[];
  let aliases: string[];
  let matchTerms: string[];
  // 区域共现匹配（仅字面搜索使用）："青海"+"国家区域医疗中心"同时出现也算命中
  let coOccur: string[] | null = null;

  if (matched.length > 0) {
    const best = matched[0].matched;
    aliases = [best.primary, ...best.aliases];
    // 命中词：只认具体项目名（terms），简称不作为命中条件
    // 例如"文化客厅"太通用，必须出现"呼和浩特文化客厅"才算命中
    matchTerms = best.terms.length > 0 ? [...best.terms] : [best.primary];
    // 生成多路查询：具体项目名 + 主名称 + 别名 + 新闻关键词组合
    const generated = generateSearchQueries(keyword);
    searchQueries = generated.length > 0 ? generated : [best.primary];
  } else {
    // 字面搜索：生成全称/简称变体（去"项目/工程"后缀、去"省"字），
    // 文章提到任一变体就算命中，避免因表述差异漏掉报道
    const variants = generateLiteralVariants(keyword);
    aliases = variants;
    matchTerms = variants;
    searchQueries = variants.slice(0, 4);
    coOccur = buildLiteralCoOccur(keyword);
  }

  console.log(`[项目搜索] "${keyword}" → 项目名: ${projectName}`);
  console.log(`[项目搜索] 搜索查询: ${searchQueries.slice(0, 4).join(" | ")}`);
  console.log(`[项目搜索] 过滤别名: ${aliases.slice(0, 5).join(", ")}`);

  // 3. 并发搜索：新闻 + 微信（按模式跳过不需要的引擎，节省时间）
  const doNews = mode !== "wechat";
  const doWechat = mode !== "news";

  const [newsResults, wechatResults] = await Promise.all([
    doNews
      ? searchAllNews({
          queries: searchQueries,
          filterTerms: aliases,
          daysBack: 365, // 放宽到一年
          maxPerQuery: 40,
          maxTotal: 200,
        }).catch((err) => {
          console.error(`[新闻搜索失败] ${keyword}:`, err);
          return [];
        })
      : Promise.resolve([]),
    doWechat
      ? searchWechatArticles(projectName, 80).catch((err) => {
          console.error(`[微信搜索失败] ${keyword}:`, err);
          return [];
        })
      : Promise.resolve([]),
  ]);

  console.log(`[项目搜索] ${projectName}: 新闻=${newsResults.length}, 微信=${wechatResults.length}`);

  // 4. 合并新闻 + 微信
  const allResults = [
    ...newsResults.map((r) => ({
      date: r.date,
      title: r.title,
      media: r.media,
      url: r.url,
      snippet: r.snippet,
      source: "news" as const,
    })),
    ...wechatResults.map((r) => ({
      date: r.date,
      title: r.title,
      media: r.media,
      url: r.url,
      snippet: r.snippet,
      source: "wechat" as const,
    })),
  ];

  // ============================================================
  // 逐级过滤（每一级被过滤的内容都记录原因，返回给用户展示）
  // ============================================================
  const filtered: FilteredItem[] = [];
  const pushFiltered = (
    r: { date: string; title: string; media: string; url: string; snippet: string; source: "news" | "wechat" },
    reason: string
  ) => {
    filtered.push({
      date: r.date,
      title: r.title,
      media: r.media,
      url: r.url,
      snippet: r.snippet,
      source: r.source,
      filterReason: reason,
    });
  };

  // 5. 日期过滤（只有标准 YYYY-MM-DD 格式才做范围判断，避免把最近的报道误判为范围外）
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const dateFiltered = allResults.filter((r) => {
    if (!r.date || !ISO_DATE_RE.test(r.date)) return true; // 无法解析日期的保留
    const inRange = r.date >= dateFrom && r.date <= dateTo;
    if (!inRange) pushFiltered(r, "日期范围外");
    return inRange;
  });

  // 5.5 自有媒体过滤：中建八局官方公众号等自身发布的内容不属于外媒
  const selfMediaFiltered = dateFiltered.filter((r) => {
    const isSelfMedia = r.media.includes("中建八局");
    if (isSelfMedia) pushFiltered(r, "自身发布内容");
    return !isSelfMedia;
  });

  // 6. 内容噪音过滤 + 自媒体平台过滤（用户口径：规避个人发文账号）
  const contentFiltered = selfMediaFiltered.filter((r) => {
    const reason =
      findNoiseReason(r.title, r.snippet) ||
      (isSelfMediaPlatform(r.media, r.url) ? "自媒体账号" : null);
    if (reason) pushFiltered(r, reason);
    return !reason;
  });

  // 7. 精度过滤：结果必须至少匹配一个具体项目名（命中词）
  //    字面搜索额外支持区域共现："青海"+"国家区域医疗中心"同时出现也算命中
  const precisionFiltered = contentFiltered.filter((r) => {
    const text = r.title + r.snippet;
    const directHit = matchTerms.some((term) => text.includes(term));
    const coOccurHit =
      coOccur !== null &&
      coOccur.every((w) => text.includes(w));
    const hit = directHit || coOccurHit;
    if (!hit) pushFiltered(r, "未提到具体项目名");
    return hit;
  });

  console.log(
    `[项目搜索] ${projectName}: 原始=${allResults.length} → 日期过滤=${dateFiltered.length} → 内容过滤=${contentFiltered.length} → 项目名过滤=${precisionFiltered.length}`
  );

  // 8. 去重
  const deduplicated = deduplicate(precisionFiltered);
  const dedupUrls = new Set(deduplicated.map((r) => r.url));
  for (const r of precisionFiltered) {
    if (!dedupUrls.has(r.url)) pushFiltered(r, "重复内容");
  }

  // 9. 报道质量评分：只要提到项目名就保留（评分只用于排序和展示），
  //    只有"绝对排除/低质量源"（评分<0，如招聘/广告/内部管理/自媒体号）才进过滤区
  const allScored = deduplicated.map(scoreReportQuality);
  const scored = allScored.filter((r) => r.score >= 0);
  for (const r of allScored) {
    if (r.score < 0) pushFiltered(r, "报道评分不足");
  }
  console.log(
    `[项目搜索] ${projectName}: 去重=${deduplicated.length} → 评分保留=${scored.length} → 过滤记录=${filtered.length}`
  );

  // 10. 媒体分类（数据库 + AI 兜底）
  const { classified, unknownMedia } = classifyResults(scored);
  let finalResults = classified;
  if (unknownMedia.length > 0) {
    const aiResults = await classifyWithAI(unknownMedia).catch(() => new Map());
    finalResults = applyAIClassifications(classified, aiResults);
  }

  // 10.5 AI 识别为个人账号的，排除（用户口径：规避个人发文账号）
  const personalAccounts = finalResults.filter((r) => r.category === "个人账号");
  finalResults = finalResults.filter((r) => r.category !== "个人账号");
  for (const r of personalAccounts) pushFiltered(r, "个人账号");

  finalResults.sort(sortByCategory);

  // 11. 还原 Google News 跳转链接为真实网址（国内可直接打开）
  await resolveGoogleNewsUrls(finalResults);

  return { results: finalResults, filtered, projectName, rawCount: allResults.length };
}

// ============================================================
// API Route
// ============================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { dateFrom, dateTo } = body;
    const mode: "all" | "news" | "wechat" =
      body.mode === "news" || body.mode === "wechat" ? body.mode : "all";

    const rawKeywords: string[] = body.keywords
      ? body.keywords
      : body.keyword
        ? [body.keyword]
        : [];

    // ============================================================
    // 1. 参数校验
    // ============================================================
    if (rawKeywords.length === 0) {
      return NextResponse.json({ error: "请输入搜索关键词" }, { status: 400 });
    }

    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: "请选择日期范围" }, { status: 400 });
    }

    const from = new Date(dateFrom);
    const to = new Date(dateTo);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return NextResponse.json({ error: "日期格式不正确" }, { status: 400 });
    }
    if (from > to) {
      return NextResponse.json({ error: "开始日期不能晚于结束日期" }, { status: 400 });
    }

    const keywords = [...new Set(rawKeywords.map((k: string) => k.trim()).filter(Boolean))];

    console.log(`\n========================================`);
    console.log(`[批量搜索] 共 ${keywords.length} 个项目`);
    console.log(`[批量搜索] 日期: ${dateFrom} ~ ${dateTo}`);
    console.log(`[批量搜索] 项目列表: ${keywords.join(", ")}`);
    console.log(`========================================\n`);

    // ============================================================
    // 2. 并发搜索项目（限 3 个并发：单个项目内部新闻+微信并行，
    //    项目之间也并行，但限制并发数避免搜索引擎限流）
    // ============================================================
    const allProjectResults: ClassifiedResult[] = [];
    const allFiltered: (FilteredItem & { project: string })[] = [];
    const byProject: Record<string, number> = {};
    const rawByProject: Record<string, number> = {};
    const failed: FailedProject[] = [];
    const seenUrls = new Set<string>();

    await runWithConcurrency(keywords, 3, async (kw, i) => {
      console.log(`\n[批量搜索 ${i + 1}/${keywords.length}] ${kw}`);

      try {
        const { results, filtered: projFiltered, projectName, rawCount } = await searchOneProject(kw, dateFrom, dateTo, mode);

        // 去重合并到全局结果
        let added = 0;
        for (const r of results) {
          const key = r.url.slice(0, 120);
          if (seenUrls.has(key)) continue;
          seenUrls.add(key);
          (r as unknown as Record<string, unknown>).project = projectName;
          allProjectResults.push(r);
          added++;
        }

        // 汇总被过滤的内容
        for (const f of projFiltered) {
          allFiltered.push({ ...f, project: projectName });
        }

        byProject[projectName] = results.length;
        rawByProject[projectName] = (rawByProject[projectName] || 0) + rawCount;
        console.log(`[批量搜索] ✅ ${projectName}: ${results.length} 条（新增 ${added} 条）`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "搜索失败";
        console.error(`[批量搜索] ❌ ${kw}: ${errorMsg}`);
        failed.push({ keyword: kw, error: errorMsg });
        byProject[kw] = 0;
      }
    });

    // ============================================================
    // 3. 全局排序
    // ============================================================
    allProjectResults.sort(sortByCategory);

    // ============================================================
    // 4. 统计
    // ============================================================
    const byCategory: Record<string, number> = {};
    let newsCount = 0;
    let wechatCount = 0;

    for (const r of allProjectResults) {
      byCategory[r.category] = (byCategory[r.category] || 0) + 1;
      if (r.source === "news") newsCount++;
      else wechatCount++;
    }

    // ============================================================
    // 5. 被过滤内容的 Google 链接也尽量还原（上限 40 个）
    // ============================================================
    await resolveGoogleNewsUrls(allFiltered, 40);

    // ============================================================
    // 6. URL 清洗：去掉 HTML 转义符（&amp; 等），否则链接打不开
    // ============================================================
    for (const r of allProjectResults) r.url = cleanUrlEntities(r.url);
    for (const f of allFiltered) f.url = cleanUrlEntities(f.url);

    // ============================================================
    // 7. 返回
    // ============================================================
    console.log(`\n[批量搜索] 完成！共 ${allProjectResults.length} 条结果`);
    if (failed.length > 0) {
      console.log(`[批量搜索] ⚠️ ${failed.length} 个项目失败: ${failed.map((f) => f.keyword).join(", ")}`);
    }

    // 被过滤内容按原因统计
    const byReason: Record<string, number> = {};
    for (const f of allFiltered) {
      byReason[f.filterReason] = (byReason[f.filterReason] || 0) + 1;
    }

    return NextResponse.json({
      keywords,
      dateRange: { from: dateFrom, to: dateTo },
      totalCount: allProjectResults.length,
      results: allProjectResults,
      byProject,
      rawByProject,
      failed: failed.length > 0 ? failed : undefined,
      stats: {
        byCategory,
        bySource: { news: newsCount, wechat: wechatCount },
      },
      filtered: {
        total: allFiltered.length,
        items: allFiltered.slice(0, 150),
        byReason,
      },
    });
  } catch (error) {
    console.error("搜索失败:", error);
    const message =
      error instanceof Error ? error.message : "搜索失败，请稍后重试";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
