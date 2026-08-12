"use client";

import { useState, useCallback } from "react";
import {
  Search,
  Loader2,
  Download,
  ExternalLink,
  Calendar,
  Check,
  Copy,
  Plus,
  X,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Newspaper,
  MessageCircle,
  Layers,
} from "lucide-react";

// ============================================================
// 类型
// ============================================================

interface SearchResult {
  date: string;
  title: string;
  media: string;
  category: string;
  url: string;
  snippet: string;
  source: "news" | "wechat";
  project?: string;
}

interface FailedProject {
  keyword: string;
  error: string;
}

interface SearchResponse {
  keywords: string[];
  dateRange: { from: string; to: string };
  totalCount: number;
  results: SearchResult[];
  byProject: Record<string, number>;
  failed?: FailedProject[];
  stats: {
    byCategory: Record<string, number>;
    bySource: { news: number; wechat: number };
  };
}

// ============================================================
// 搜索方式
// ============================================================

type SearchMode = "all" | "news" | "wechat";

const SEARCH_MODES: { value: SearchMode; label: string; icon: React.ReactNode }[] = [
  { value: "all", label: "全部", icon: <Layers className="w-3.5 h-3.5" /> },
  { value: "news", label: "仅新闻", icon: <Newspaper className="w-3.5 h-3.5" /> },
  { value: "wechat", label: "仅微信", icon: <MessageCircle className="w-3.5 h-3.5" /> },
];

// ============================================================
// 预选项目列表
// ============================================================

const PRESET_PROJECTS = [
  "呼和浩特盛乐国际机场",
  "蒙牛乳业",
  "内蒙古博物院",
  "呼和浩特万象城",
  "乌兰察布数据中心",
  "大黑河军事公园",
  "呼和浩特欢乐冰雪节",
  "呼和浩特市第一中学",
  "伊利现代智慧健康谷",
  "呼和浩特市妇幼保健院",
  "内蒙古电力生产调度中心",
  "中国移动呼和浩特数据中心",
];

const CATEGORY_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  "人民日报/央视": { label: "人民日报/央视", bg: "bg-red-50", color: "text-red-700" },
  央广: { label: "央广", bg: "bg-orange-50", color: "text-orange-700" },
  中央级: { label: "中央级", bg: "bg-amber-50", color: "text-amber-700" },
  省部级: { label: "省部级", bg: "bg-blue-50", color: "text-blue-700" },
  地方: { label: "地方", bg: "bg-teal-50", color: "text-teal-700" },
  行业: { label: "行业", bg: "bg-purple-50", color: "text-purple-700" },
  微信公众号: { label: "微信公众号", bg: "bg-green-50", color: "text-green-700" },
  未分类: { label: "其他", bg: "bg-gray-50", color: "text-gray-600" },
};

// ============================================================
// 工具
// ============================================================

function today(): string {
  return new Date().toISOString().split("T")[0];
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

// ============================================================
// 主组件
// ============================================================

export default function Home() {
  // 日期
  const [dateFrom, setDateFrom] = useState(daysAgo(90));
  const [dateTo, setDateTo] = useState(today());

  // 搜索方式
  const [searchMode, setSearchMode] = useState<SearchMode>("all");

  // 项目选择
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [customInput, setCustomInput] = useState("");
  const [customProjects, setCustomProjects] = useState<string[]>([]);

  // 搜索状态
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [error, setError] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);

  // 折叠项目组
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());

  // 复制
  const [copied, setCopied] = useState(false);

  // 结果内筛选
  const [filterCategory, setFilterCategory] = useState<string>("全部");
  const [filterSource, setFilterSource] = useState<string>("全部");

  const allSelected = [...selectedProjects, ...customProjects];

  // ========== 项目选择 ==========
  const toggleProject = (name: string) => {
    setSelectedProjects((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const addCustomProject = () => {
    const v = customInput.trim();
    if (v && !customProjects.includes(v) && !selectedProjects.has(v)) {
      setCustomProjects((prev) => [...prev, v]);
    }
    setCustomInput("");
  };

  const removeCustomProject = (name: string) => {
    setCustomProjects((prev) => prev.filter((p) => p !== name));
  };

  // ========== 搜索 ==========
  const handleSearch = async () => {
    if (allSelected.length === 0) {
      setError("请至少选择一个项目");
      return;
    }
    setError("");
    setIsLoading(true);
    setData(null);
    setFilterCategory("全部");
    setFilterSource("全部");

    setLoadingText(`正在搜索 ${allSelected.length} 个项目…`);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords: allSelected,
          dateFrom,
          dateTo,
          mode: searchMode,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "搜索失败");
      }
      const result = await res.json();
      setData(result);

      if (result.failed && result.failed.length > 0) {
        setError(`${result.failed.length} 个项目搜索失败：${result.failed.map((f: FailedProject) => f.keyword).join("、")}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "搜索失败");
    } finally {
      setIsLoading(false);
      setLoadingText("");
    }
  };

  // ========== 导出 ==========
  const handleExport = useCallback(() => {
    if (!data || !data.results.length) return;

    const headers = ["日期", "项目", "文章标题", "刊发媒体", "媒体类别", "媒体链接"];
    const rows = data.results.map(
      (r) =>
        [
          r.date,
          r.project || "",
          `"${r.title.replace(/"/g, '""')}"`,
          r.media,
          r.category,
          r.url,
        ].join(",")
    );
    const csv = "﻿" + headers.join(",") + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `发稿统计_${dateFrom}_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, dateFrom, dateTo]);

  const handleCopyAll = async () => {
    if (!data) return;
    const text = data.results
      .map((r) => `${r.date}\t${r.project || ""}\t${r.title}\t${r.media}\t${r.category}\t${r.url}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  // ========== 结果筛选 ==========
  const filteredResults = data
    ? data.results.filter((r) => {
        if (filterCategory !== "全部" && r.category !== filterCategory) return false;
        if (filterSource === "新闻" && r.source !== "news") return false;
        if (filterSource === "微信" && r.source !== "wechat") return false;
        return true;
      })
    : [];

  // ========== 按项目分组 ==========
  const groupedResults: Record<string, SearchResult[]> = {};
  for (const r of filteredResults) {
    const p = r.project || "其他";
    if (!groupedResults[p]) groupedResults[p] = [];
    groupedResults[p].push(r);
  }

  const toggleCollapse = (p: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* ========== 搜索表单 ========== */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 mb-4">
        {/* 搜索方式 + 日期范围 */}
        <div className="flex flex-wrap items-end gap-4 mb-4">
          {/* 搜索方式 */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">搜索范围</label>
            <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
              {SEARCH_MODES.map((mode) => (
                <button
                  key={mode.value}
                  onClick={() => setSearchMode(mode.value)}
                  disabled={isLoading}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs transition-colors ${
                    searchMode === mode.value
                      ? "bg-blue-600 text-white"
                      : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  }`}
                >
                  {mode.icon}
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          {/* 日期 */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">开始日期</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="pl-10 pr-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">结束日期</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="pl-10 pr-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
          <button
            onClick={handleSearch}
            disabled={isLoading || allSelected.length === 0}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {isLoading ? (
              <><Loader2 className="w-4 h-4 animate-spin" />搜索中</>
            ) : (
              <><Search className="w-4 h-4" />批量搜索</>
            )}
          </button>
        </div>

        {/* 项目选择 */}
        <div>
          <label className="text-sm font-medium mb-2 block">
            选择项目（可多选+手动补充）
            <span className="text-zinc-400 font-normal ml-1">
              {allSelected.length > 0 && `已选 ${allSelected.length} 个`}
            </span>
          </label>
          <div className="flex flex-wrap gap-2 mb-2">
            {PRESET_PROJECTS.map((p) => {
              const active = selectedProjects.has(p);
              return (
                <button
                  key={p}
                  onClick={() => toggleProject(p)}
                  disabled={isLoading}
                  className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                    active
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-600 hover:border-blue-400"
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>

          {/* 手动输入 */}
          <div className="flex flex-wrap gap-2 items-center">
            {customProjects.map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs bg-green-600 text-white"
              >
                {p}
                <button
                  onClick={() => removeCustomProject(p)}
                  disabled={isLoading}
                  className="hover:bg-green-700 rounded-full p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <div className="flex gap-1">
              <input
                type="text"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCustomProject()}
                placeholder="手动输入项目名..."
                disabled={isLoading}
                className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs w-48 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <button
                onClick={addCustomProject}
                disabled={isLoading || !customInput.trim()}
                className="px-2 py-1.5 rounded-lg bg-green-600 text-white text-xs hover:bg-green-700 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 mt-3 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            {error}
          </p>
        )}
      </div>

      {/* ========== 加载中 ========== */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-500 gap-3">
          <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
          <p className="text-sm font-medium">{loadingText}</p>
          <p className="text-xs text-zinc-400">
            每个项目搜索约需 3-8 秒，共 {allSelected.length} 个项目
          </p>
        </div>
      )}

      {/* ========== 结果 ========== */}
      {data && !isLoading && (
        <>
          {/* 操作栏 */}
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div>
              <span className="text-sm font-medium">
                共 <span className="text-blue-600">{data.totalCount}</span> 条
              </span>
              <span className="text-xs text-zinc-500 ml-3">
                新闻{data.stats.bySource.news} · 微信{data.stats.bySource.wechat}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCopyAll}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-zinc-300 hover:bg-zinc-50 transition-colors"
              >
                {copied ? <><Check className="w-3.5 h-3.5" />已复制</> : <><Copy className="w-3.5 h-3.5" />复制全部</>}
              </button>
              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                导出 CSV
              </button>
            </div>
          </div>

          {/* 统计卡片 */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
            <StatCard label="总计" value={data.totalCount} bg="bg-blue-50" color="text-blue-700" />
            {Object.entries(CATEGORY_CONFIG).map(([k, cfg]) => {
              const c = data.stats.byCategory[k] || 0;
              if (!c) return null;
              return <StatCard key={k} label={cfg.label} value={c} bg={cfg.bg} color={cfg.color} />;
            })}
          </div>

          {/* 按项目统计 + 筛选栏 */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {Object.entries(data.byProject).map(([p, c]) => (
              <span key={p} className="text-xs px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800">
                {p}: <b>{c}条</b>
              </span>
            ))}
          </div>

          {/* 结果内筛选 */}
          <div className="flex items-center gap-3 mb-4 text-xs">
            <span className="text-zinc-500">结果筛选：</span>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
            >
              <option value="全部">全部类别</option>
              {Object.entries(CATEGORY_CONFIG).map(([k, cfg]) => (
                <option key={k} value={k}>{cfg.label}</option>
              ))}
            </select>
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
            >
              <option value="全部">全部来源</option>
              <option value="新闻">新闻</option>
              <option value="微信">微信公众号</option>
            </select>
            {filteredResults.length !== data.totalCount && (
              <span className="text-zinc-400">
                显示 {filteredResults.length}/{data.totalCount} 条
              </span>
            )}
          </div>

          {/* 按项目分组的结果 */}
          {filteredResults.length > 0 ? (
            <div className="space-y-3">
              {Object.entries(groupedResults).map(([project, items]) => {
                const collapsed = collapsedProjects.has(project);
                return (
                  <div
                    key={project}
                    className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden"
                  >
                    <button
                      onClick={() => toggleCollapse(project)}
                      className="w-full flex items-center gap-2 px-4 py-3 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 transition-colors text-left"
                    >
                      {collapsed ? (
                        <ChevronRight className="w-4 h-4 text-zinc-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-zinc-400" />
                      )}
                      <span className="text-sm font-medium">{project}</span>
                      <span className="text-xs text-zinc-500 ml-auto">{items.length} 条</span>
                    </button>
                    {!collapsed && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-zinc-50 dark:bg-zinc-900 border-b">
                              <th className="text-left px-3 py-2 text-xs font-medium text-zinc-500 w-24">日期</th>
                              <th className="text-left px-3 py-2 text-xs font-medium text-zinc-500">文章标题</th>
                              <th className="text-left px-3 py-2 text-xs font-medium text-zinc-500 w-28">刊发媒体</th>
                              <th className="text-left px-3 py-2 text-xs font-medium text-zinc-500 w-20">类别</th>
                              <th className="text-left px-3 py-2 text-xs font-medium text-zinc-500 w-14">来源</th>
                              <th className="text-left px-3 py-2 text-xs font-medium text-zinc-500 w-14">链接</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((item, i) => (
                              <tr
                                key={`${item.url}-${i}`}
                                className="border-b border-zinc-100 dark:border-zinc-800 last:border-none hover:bg-zinc-50 dark:hover:bg-zinc-900"
                              >
                                <td className="px-3 py-2 text-xs text-zinc-500 whitespace-nowrap">{item.date}</td>
                                <td className="px-3 py-2">
                                  <div className="text-sm">{item.title}</div>
                                  {item.snippet && (
                                    <div className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{item.snippet}</div>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-xs whitespace-nowrap">{item.media}</td>
                                <td className="px-3 py-2"><CatBadge cat={item.category} /></td>
                                <td className="px-3 py-2">
                                  <SourceBadge source={item.source} />
                                </td>
                                <td className="px-3 py-2">
                                  <a href={item.url} target="_blank" rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline text-xs flex items-center gap-1">
                                    <ExternalLink className="w-3 h-3" />查看
                                  </a>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-16 text-zinc-500">
              <Search className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">筛选后无结果</p>
            </div>
          )}
        </>
      )}

      {/* ========== 初始状态 ========== */}
      {!data && !isLoading && (
        <div className="text-center py-16 text-zinc-500">
          <Search className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <p className="text-base font-medium text-zinc-700 dark:text-zinc-300">外媒发稿统计助手</p>
          <p className="text-sm mt-1 text-zinc-400">
            选择项目 + 日期范围 → 双引擎搜索（新闻+微信）→ 一键导出
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 子组件
// ============================================================

function StatCard({ label, value, bg, color }: { label: string; value: number; bg: string; color: string }) {
  return (
    <div className={`rounded-lg px-3 py-2.5 ${bg}`}>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className={`text-xs ${color} opacity-70`}>{label}</div>
    </div>
  );
}

function CatBadge({ cat }: { cat: string }) {
  const c = CATEGORY_CONFIG[cat] || CATEGORY_CONFIG["未分类"];
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs border ${c.bg} ${c.color}`}>{c.label}</span>
  );
}

function SourceBadge({ source }: { source: "news" | "wechat" }) {
  if (source === "news") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-600">
        <Newspaper className="w-3 h-3" />
        新闻
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-green-50 text-green-600">
      <MessageCircle className="w-3 h-3" />
      微信
    </span>
  );
}
