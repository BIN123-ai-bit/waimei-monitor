"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Search,
  Loader2,
  Download,
  ExternalLink,
  Calendar,
  Check,
  Copy,
  X,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Newspaper,
  MessageCircle,
  Layers,
} from "lucide-react";
import { PROJECT_KEYWORDS } from "@/data/project-keywords";

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
  score?: number;
}

interface FailedProject {
  keyword: string;
  error: string;
}

interface FilteredItem {
  date: string;
  title: string;
  media: string;
  url: string;
  source: "news" | "wechat";
  filterReason: string;
  project?: string;
}

interface SearchResponse {
  keywords: string[];
  dateRange: { from: string; to: string };
  totalCount: number;
  results: SearchResult[];
  byProject: Record<string, number>;
  rawByProject?: Record<string, number>;
  failed?: FailedProject[];
  stats: {
    byCategory: Record<string, number>;
    bySource: { news: number; wechat: number };
  };
  filtered?: {
    total: number;
    items: FilteredItem[];
    byReason: Record<string, number>;
  };
  mediaVerification?: {
    checked: number;
    corrected: number;
    skipped: number;
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

// 本地存储键名
const LS_USER_PROJECTS = "waimei_user_projects";
const LS_HIDDEN_PROJECTS = "waimei_hidden_projects";

// 从 localStorage 读取字符串数组（容错）
function loadLSArray(key: string): string[] {
  try {
    const v = localStorage.getItem(key);
    const arr = v ? JSON.parse(v) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

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
  // 日期（默认近两年，覆盖更多历史报道）
  const [dateFrom, setDateFrom] = useState(daysAgo(730));
  const [dateTo, setDateTo] = useState(today());

  // 搜索方式
  const [searchMode, setSearchMode] = useState<SearchMode>("all");

  // 项目选择
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [customProjects, setCustomProjects] = useState<string[]>([]);

  // 常用项目管理（本地持久化）
  const [userProjects, setUserProjects] = useState<string[]>([]);
  const [hiddenProjects, setHiddenProjects] = useState<string[]>([]);
  const [manageMode, setManageMode] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  // 首次挂载时从 localStorage 读取
  useEffect(() => {
    setUserProjects(loadLSArray(LS_USER_PROJECTS));
    setHiddenProjects(loadLSArray(LS_HIDDEN_PROJECTS));
  }, []);

  const saveUserProjects = (list: string[]) => {
    setUserProjects(list);
    localStorage.setItem(LS_USER_PROJECTS, JSON.stringify(list));
  };

  const saveHiddenProjects = (list: string[]) => {
    setHiddenProjects(list);
    localStorage.setItem(LS_HIDDEN_PROJECTS, JSON.stringify(list));
  };

  // 预设项目 = 内置项目（去除被隐藏的） + 用户自建项目
  const presetProjects = [
    ...PROJECT_KEYWORDS.filter((p) => !hiddenProjects.includes(p.primary)).map((p) => p.primary),
    ...userProjects,
  ];

  // 添加常用项目（内置名 → 取消隐藏；其他 → 加入自定义列表）
  const addUserProject = () => {
    const v = newProjectName.trim();
    if (!v) return;
    const isBuiltin = PROJECT_KEYWORDS.some((p) => p.primary === v);
    if (isBuiltin) {
      saveHiddenProjects(hiddenProjects.filter((x) => x !== v));
    } else if (!userProjects.includes(v)) {
      saveUserProjects([...userProjects, v]);
    }
    setNewProjectName("");
  };

  // 删除项目（内置 → 隐藏；自建 → 移除）
  const removeProject = (name: string) => {
    if (userProjects.includes(name)) {
      saveUserProjects(userProjects.filter((x) => x !== name));
    } else {
      saveHiddenProjects([...hiddenProjects, name]);
    }
    setSelectedProjects((prev) => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  };

  // 搜索框（输入联想）
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  // 搜索状态
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [error, setError] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);

  // 折叠项目组
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());

  // 已过滤内容展示开关
  const [showFiltered, setShowFiltered] = useState(false);

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
    const v = query.trim();
    if (v && !customProjects.includes(v) && !selectedProjects.has(v)) {
      setCustomProjects((prev) => [...prev, v]);
    }
  };

  const removeCustomProject = (name: string) => {
    setCustomProjects((prev) => prev.filter((p) => p !== name));
  };

  // ========== 搜索（供按钮和回车共用） ==========
  // 项目多时分批请求（每组 3 个），避免单次请求超时
  const doSearch = async (keywords: string[]) => {
    if (keywords.length === 0) {
      setError("请至少选择一个项目");
      return;
    }
    setError("");
    setIsLoading(true);
    setData(null);
    setFilterCategory("全部");
    setFilterSource("全部");
    setShowFiltered(false);

    const CHUNK_SIZE = 4;
    const chunks: string[][] = [];
    for (let i = 0; i < keywords.length; i += CHUNK_SIZE) {
      chunks.push(keywords.slice(i, i + CHUNK_SIZE));
    }

    // 单组请求（失败自动重试一次）
    const fetchChunk = async (chunk: string[]): Promise<SearchResponse> => {
      const body = JSON.stringify({
        keywords: chunk,
        dateFrom,
        dateTo,
        mode: searchMode,
      });

      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch("/api/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
          }
          return await res.json();
        } catch (err) {
          lastErr = err;
          if (attempt === 0) {
            // 等待 2 秒后重试
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error("搜索失败");
    };

    // 合并容器
    const merged = {
      keywords,
      dateRange: { from: dateFrom, to: dateTo },
      totalCount: 0,
      results: [] as SearchResult[],
      byProject: {} as Record<string, number>,
      rawByProject: {} as Record<string, number>,
      failed: [] as FailedProject[],
      stats: {
        byCategory: {} as Record<string, number>,
        bySource: { news: 0, wechat: 0 },
      },
      filtered: {
        total: 0,
        items: [] as FilteredItem[],
        byReason: {} as Record<string, number>,
      },
      mediaVerification: { checked: 0, corrected: 0, skipped: 0 },
    };

    try {
      for (let i = 0; i < chunks.length; i++) {
        setLoadingText(
          `正在搜索 ${keywords.length} 个项目（第 ${i + 1}/${chunks.length} 组，每组约 10-20 秒）…`
        );

        try {
          const result = await fetchChunk(chunks[i]);

          // 合并结果
          merged.totalCount += result.totalCount || 0;
          merged.results.push(...(result.results || []));
          for (const [k, v] of Object.entries(result.byProject || {})) {
            merged.byProject[k] = (merged.byProject[k] || 0) + (v as number);
          }
          for (const [k, v] of Object.entries(result.rawByProject || {})) {
            merged.rawByProject[k] = (merged.rawByProject[k] || 0) + (v as number);
          }
          if (result.failed) merged.failed.push(...result.failed);
          if (result.stats) {
            for (const [k, v] of Object.entries(result.stats.byCategory || {})) {
              merged.stats.byCategory[k] = (merged.stats.byCategory[k] || 0) + (v as number);
            }
            merged.stats.bySource.news += result.stats.bySource?.news || 0;
            merged.stats.bySource.wechat += result.stats.bySource?.wechat || 0;
          }
          if (result.filtered) {
            merged.filtered.total += result.filtered.total || 0;
            merged.filtered.items.push(...(result.filtered.items || []));
            for (const [k, v] of Object.entries(result.filtered.byReason || {})) {
              merged.filtered.byReason[k] = (merged.filtered.byReason[k] || 0) + (v as number);
            }
          }
          if (result.mediaVerification) {
            merged.mediaVerification.checked += result.mediaVerification.checked || 0;
            merged.mediaVerification.corrected += result.mediaVerification.corrected || 0;
            merged.mediaVerification.skipped += result.mediaVerification.skipped || 0;
          }
        } catch (chunkErr) {
          // 单组失败不中断整体，记录后继续下一组
          const msg = chunkErr instanceof Error ? chunkErr.message : "搜索失败";
          merged.failed.push({ keyword: `第${i + 1}组(${chunks[i].join("、")})`, error: msg });
        }
      }

      setData(merged as unknown as SearchResponse);

      if (merged.failed.length > 0) {
        setError(
          `${merged.failed.length} 组搜索失败：${merged.failed.map((f) => f.keyword).join("；")}`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "搜索失败");
    } finally {
      setIsLoading(false);
      setLoadingText("");
    }
  };

  // ========== 搜索框联想（内置项目 + 用户自建项目） ==========
  const suggestions = (() => {
    const q = query.trim();
    if (!q) return [];
    const builtin = PROJECT_KEYWORDS.filter((p) =>
      [p.primary, ...p.aliases, ...p.terms].join(" ").includes(q)
    ).map((p) => ({ primary: p.primary, type: p.type }));
    const custom = userProjects
      .filter((n) => n.includes(q))
      .map((n) => ({ primary: n, type: "自定义项目" }));
    return [...builtin, ...custom].slice(0, 8);
  })();

  const selectSuggestion = (name: string) => {
    toggleProject(name);
    setQuery("");
    setShowSuggestions(false);
  };

  const handleQueryKeyDown = (e: { key: string }) => {
    if (e.key !== "Enter") return;
    const q = query.trim();
    if (!q) return;
    // 输入内容与联想第一项完全一致 → 搜该项目；否则按输入的名称直接搜索
    const first = suggestions[0];
    if (first && q === first.primary) {
      const next = new Set(selectedProjects);
      next.add(q);
      setSelectedProjects(next);
      setQuery("");
      setShowSuggestions(false);
      doSearch([...next, ...customProjects]);
    } else {
      const nextCustom = customProjects.includes(q) ? customProjects : [...customProjects, q];
      setCustomProjects(nextCustom);
      setQuery("");
      setShowSuggestions(false);
      doSearch([...selectedProjects, ...nextCustom]);
    }
  };

  // ========== 搜索 ==========
  const handleSearch = () => doSearch(allSelected);

  // ========== 导出 ==========
  const handleExport = useCallback(() => {
    if (!data || !data.results.length) return;

    const headers = ["日期", "项目", "文章标题", "刊发媒体", "媒体类别", "报道评分", "媒体链接"];
    const rows = data.results.map(
      (r) =>
        [
          r.date,
          r.project || "",
          `"${r.title.replace(/"/g, '""')}"`,
          r.media,
          r.category,
          r.score ?? "",
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

  // 导出已过滤内容
  const handleExportFiltered = useCallback(() => {
    if (!data || !data.filtered || !data.filtered.items.length) return;

    const headers = ["过滤原因", "日期", "项目", "文章标题", "刊发媒体", "媒体链接"];
    const rows = data.filtered.items.map(
      (f) =>
        [
          f.filterReason,
          f.date,
          f.project || "",
          `"${f.title.replace(/"/g, '""')}"`,
          f.media,
          f.url,
        ].join(",")
    );
    const csv = "﻿" + headers.join(",") + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `已过滤内容_${dateFrom}_${dateTo}.csv`;
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
        {/* 标题 + 版本号 */}
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-semibold">外媒发稿统计助手</h1>
          <span className="text-xs text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded-full">
            v2.2 · 任意名称直接搜索
          </span>
        </div>

        {/* 醒目搜索框（输入联想） */}
        <div className="relative mb-4">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onKeyDown={handleQueryKeyDown}
            placeholder="输入任意名称，回车按你输入的内容搜索（如：文化客厅、蒙牛5G数字工厂、新机场航站区…）"
            disabled={isLoading}
            className="w-full pl-11 pr-4 py-3 rounded-xl border-2 border-blue-200 dark:border-blue-900 bg-white dark:bg-zinc-900 text-base focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-colors"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-20 left-0 right-0 mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg overflow-hidden">
              {suggestions.map((s) => (
                <button
                  key={s.primary}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectSuggestion(s.primary);
                  }}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-blue-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  <span className="text-sm">{s.primary}</span>
                  <span className="text-xs text-zinc-400">{s.type}</span>
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-zinc-400 mt-1.5">
            提示：回车按你输入的名称直接搜索；只有与项目名完全一致时才按项目精准搜索。点击联想项可选中该项目
          </p>
        </div>

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
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium">
              选择项目（可多选）
              <span className="text-zinc-400 font-normal ml-1">
                {allSelected.length > 0 && `已选 ${allSelected.length} 个`}
              </span>
            </label>
            <button
              onClick={() => setManageMode((v) => !v)}
              disabled={isLoading}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                manageMode
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-600 hover:border-blue-400"
              }`}
            >
              {manageMode ? "✓ 完成管理" : "⚙ 管理项目"}
            </button>
          </div>

          {/* 管理面板：添加项目 */}
          {manageMode && (
            <div className="mb-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900">
              <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-2">
                添加常用项目：保存后直接出现在下方列表，点击即可搜索，不用每次输入
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addUserProject()}
                  placeholder="输入项目名称，如：青海省国家区域医疗中心项目"
                  className="flex-1 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <button
                  onClick={addUserProject}
                  disabled={!newProjectName.trim()}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs hover:bg-blue-700 disabled:opacity-50"
                >
                  添加
                </button>
              </div>
              <p className="text-xs text-zinc-400 mt-2">
                删除：点击项目右侧的 ✕ 即可（内置项目删除后是隐藏，可重新添加回来）
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2 mb-2">
            {presetProjects.map((p) => {
              const active = selectedProjects.has(p);
              return (
                <span
                  key={p}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs border transition-colors ${
                    active
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-600 hover:border-blue-400"
                  }`}
                >
                  <button onClick={() => toggleProject(p)} disabled={isLoading}>
                    {p}
                  </button>
                  {manageMode && (
                    <button
                      onClick={() => removeProject(p)}
                      disabled={isLoading}
                      className="rounded-full hover:opacity-70"
                      title="删除该项目"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </span>
              );
            })}
          </div>

          {/* 自定义关键词 */}
          {customProjects.length > 0 && (
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
            </div>
          )}
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
              {data.mediaVerification && data.mediaVerification.checked > 0 && (
                <span className="text-xs text-emerald-600 ml-3">
                  ✓ 已自动核对 {data.mediaVerification.checked} 条媒体名
                  {data.mediaVerification.corrected > 0 &&
                    `（修正 ${data.mediaVerification.corrected} 条）`}
                </span>
              )}
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

          {/* 按项目统计（罗列全部搜索项目，含0条项目） */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {data.keywords.map((p) => {
              const c = data.byProject[p] ?? 0;
              const raw = data.rawByProject?.[p] || 0;
              return (
                <span
                  key={p}
                  className={`text-xs px-2 py-1 rounded ${
                    c > 0
                      ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                  }`}
                >
                  {p}: <b>{c}条</b>
                  {raw > c && (
                    <span className="text-zinc-400 ml-1">
                      （原始搜到{raw}条，已过滤无关内容）
                    </span>
                  )}
                </span>
              );
            })}
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

          {/* 按项目分组的结果（罗列全部搜索的项目，含无报道的项目） */}
          {data.keywords.length > 0 ? (
            <div className="space-y-3">
              {data.keywords.map((project) => {
                const items = groupedResults[project] || [];

                // 无报道的项目：显示占位卡片，保证所有搜索项目都被罗列
                if (items.length === 0) {
                  return (
                    <div
                      key={project}
                      className="border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-2.5 flex items-center gap-2"
                    >
                      <span className="text-sm text-zinc-500">{project}</span>
                      <span className="text-xs text-zinc-400 ml-auto">
                        0 条 · 该时间范围内无符合条件的外媒报道
                      </span>
                    </div>
                  );
                }

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
                              <th className="text-left px-3 py-2 text-xs font-medium text-zinc-500 w-14">评分</th>
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
                                <td className="px-3 py-2"><ScoreBadge score={item.score} /></td>
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
              {data.totalCount === 0 ? (
                <>
                  <p className="text-sm">该时间范围内没有符合条件的报道</p>
                  <p className="text-xs mt-1 text-zinc-400">
                    系统只保留文章中提到具体项目名的内容；上方统计会显示原始搜到多少条。
                    如果没有，可以尝试把开始日期改得更早
                  </p>
                </>
              ) : (
                <p className="text-sm">筛选后无结果</p>
              )}
            </div>
          )}
        </>

      )}

      {/* ========== 已过滤的无关内容 ========== */}
      {data && !isLoading && data.filtered && data.filtered.total > 0 && (
        <div className="mt-6 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
          <div className="w-full flex items-center gap-2 px-4 py-3 bg-amber-50 dark:bg-amber-950/30">
            <button
              onClick={() => setShowFiltered((v) => !v)}
              className="flex items-center gap-2 text-left flex-1 hover:bg-amber-100 dark:hover:bg-amber-950/50 -m-1 p-1 rounded transition-colors"
            >
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="text-sm font-medium">已过滤的无关内容（共 {data.filtered.total} 条）</span>
              <span className="flex flex-wrap items-center gap-1 ml-3">
                {Object.entries(data.filtered.byReason).map(([reason, count]) => (
                  <span
                    key={reason}
                    className="text-xs px-1.5 py-0.5 rounded bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                  >
                    {reason} {count}
                  </span>
                ))}
              </span>
            </button>
            <button
              onClick={handleExportFiltered}
              className="text-xs px-2 py-1.5 rounded-lg border border-amber-300 bg-white dark:bg-zinc-800 hover:bg-amber-100 transition-colors flex items-center gap-1 shrink-0"
            >
              <Download className="w-3 h-3" />
              导出CSV
            </button>
            <span className="shrink-0">
              {showFiltered ? (
                <ChevronDown className="w-4 h-4 text-zinc-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-zinc-400" />
              )}
            </span>
          </div>

          {showFiltered && (
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-50 dark:bg-zinc-900 border-b sticky top-0">
                    <th className="text-left px-3 py-2 text-xs font-medium text-zinc-500 w-28">过滤原因</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-zinc-500">文章标题</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-zinc-500 w-28">项目</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-zinc-500 w-24">刊发媒体</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-zinc-500 w-24">日期</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-zinc-500 w-14">链接</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.filtered.items]
                    .sort((a, b) => a.filterReason.localeCompare(b.filterReason, "zh"))
                    .map((item, i) => (
                      <tr
                        key={`${item.url}-${i}`}
                        className="border-b border-zinc-100 dark:border-zinc-800 last:border-none hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      >
                        <td className="px-3 py-2">
                          <ReasonBadge reason={item.filterReason} />
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-sm">{item.title}</div>
                        </td>
                        <td className="px-3 py-2 text-xs text-zinc-500 whitespace-nowrap">{item.project || "-"}</td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap">{item.media}</td>
                        <td className="px-3 py-2 text-xs text-zinc-500 whitespace-nowrap">{item.date}</td>
                        <td className="px-3 py-2">
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline text-xs flex items-center gap-1"
                          >
                            <ExternalLink className="w-3 h-3" />查看
                          </a>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {data.filtered.total > data.filtered.items.length && (
                <p className="text-xs text-zinc-400 px-3 py-2 bg-zinc-50 dark:bg-zinc-900">
                  仅展示前 {data.filtered.items.length} 条，共 {data.filtered.total} 条
                </p>
              )}
            </div>
          )}
        </div>
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

function ScoreBadge({ score }: { score?: number }) {
  if (score === undefined) return <span className="text-xs text-zinc-300">-</span>;
  const cls =
    score >= 30
      ? "bg-green-50 text-green-700"
      : score >= 15
        ? "bg-blue-50 text-blue-600"
        : "bg-amber-50 text-amber-600";
  return <span className={`inline-flex px-1.5 py-0.5 rounded text-xs ${cls}`}>{score}</span>;
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

// ============================================================
// 过滤原因徽章
// ============================================================

const REASON_COLORS: Record<string, string> = {
  未提到具体项目名: "bg-amber-50 text-amber-700 border-amber-200",
  招聘求职: "bg-blue-50 text-blue-700 border-blue-200",
  招标中标: "bg-purple-50 text-purple-700 border-purple-200",
  通知公告: "bg-gray-50 text-gray-600 border-gray-200",
  股票基金: "bg-red-50 text-red-700 border-red-200",
  广告推广: "bg-pink-50 text-pink-700 border-pink-200",
  日期范围外: "bg-gray-50 text-gray-500 border-gray-200",
  重复内容: "bg-gray-50 text-gray-500 border-gray-200",
  报道评分不足: "bg-orange-50 text-orange-700 border-orange-200",
  自身发布内容: "bg-teal-50 text-teal-700 border-teal-200",
  专利公告: "bg-indigo-50 text-indigo-700 border-indigo-200",
  个人账号: "bg-rose-50 text-rose-700 border-rose-200",
  自媒体账号: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
};

function ReasonBadge({ reason }: { reason: string }) {
  const cls = REASON_COLORS[reason] || "bg-gray-50 text-gray-600 border-gray-200";
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs border ${cls} whitespace-nowrap`}>
      {reason}
    </span>
  );
}
