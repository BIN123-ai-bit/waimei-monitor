"use client";

import { useState } from "react";
import { Search, Loader2, Download, ExternalLink, Calendar } from "lucide-react";

// ============================================================
// 类型定义
// ============================================================

interface SearchResult {
  date: string;
  title: string;
  media: string;
  category: string;
  url: string;
  snippet: string;
  source: "baidu" | "wechat";
}

interface SearchResponse {
  keyword: string;
  dateRange: { from: string; to: string };
  totalCount: number;
  results: SearchResult[];
  stats: {
    byCategory: Record<string, number>;
    bySource: { baidu: number; wechat: number };
  };
}

// ============================================================
// 分类颜色+标签配置
// ============================================================

const CATEGORY_CONFIG: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  "人民日报/央视": {
    label: "人民日报/央视",
    color: "text-red-700",
    bg: "bg-red-50 border-red-200",
  },
  央广: {
    label: "央广",
    color: "text-orange-700",
    bg: "bg-orange-50 border-orange-200",
  },
  中央级: {
    label: "中央级",
    color: "text-amber-700",
    bg: "bg-amber-50 border-amber-200",
  },
  省部级: {
    label: "省部级",
    color: "text-blue-700",
    bg: "bg-blue-50 border-blue-200",
  },
  地方: {
    label: "地方",
    color: "text-teal-700",
    bg: "bg-teal-50 border-teal-200",
  },
  行业: {
    label: "行业",
    color: "text-purple-700",
    bg: "bg-purple-50 border-purple-200",
  },
  微信公众号: {
    label: "微信公众号",
    color: "text-green-700",
    bg: "bg-green-50 border-green-200",
  },
  未分类: {
    label: "其他",
    color: "text-gray-600",
    bg: "bg-gray-50 border-gray-200",
  },
};

// ============================================================
// 工具函数
// ============================================================

function getDefaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split("T")[0];
}

function getDefaultTo(): string {
  return new Date().toISOString().split("T")[0];
}

// ============================================================
// 主组件
// ============================================================

export default function Home() {
  const [keyword, setKeyword] = useState("");
  const [dateFrom, setDateFrom] = useState(getDefaultFrom());
  const [dateTo, setDateTo] = useState(getDefaultTo());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [sortField, setSortField] = useState<"date" | "category">("date");

  // 搜索
  const handleSearch = async () => {
    if (!keyword.trim()) {
      setError("请输入搜索关键词");
      return;
    }
    if (!dateFrom || !dateTo) {
      setError("请选择日期范围");
      return;
    }
    if (dateFrom > dateTo) {
      setError("开始日期不能晚于结束日期");
      return;
    }

    setError("");
    setIsLoading(true);
    setData(null);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: keyword.trim(),
          dateFrom,
          dateTo,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "搜索失败");
      }

      const result: SearchResponse = await res.json();
      setData(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "搜索失败，请稍后重试"
      );
    } finally {
      setIsLoading(false);
    }
  };

  // 导出 CSV
  const handleExportCSV = () => {
    if (!data || !data.results.length) return;

    const headers = [
      "日期",
      "文章标题",
      "刊发媒体",
      "媒体类别",
      "媒体链接",
    ];
    const rows = data.results.map((r) =>
      [
        r.date,
        `"${r.title.replace(/"/g, '""')}"`,
        r.media,
        r.category,
        r.url,
      ].join(",")
    );

    const csv =
      "﻿" + headers.join(",") + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `发稿统计_${keyword}_${dateFrom}_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 排序结果
  const sortedResults = data?.results
    ? [...data.results].sort((a, b) => {
        if (sortField === "date") {
          return b.date.localeCompare(a.date);
        }
        const order = [
          "人民日报/央视",
          "央广",
          "中央级",
          "省部级",
          "地方",
          "行业",
          "微信公众号",
          "未分类",
        ];
        return (
          order.indexOf(a.category) - order.indexOf(b.category) ||
          b.date.localeCompare(a.date)
        );
      })
    : [];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* ========== 搜索表单 ========== */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          {/* 关键词 */}
          <div className="md:col-span-2">
            <label className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1.5 block">
              搜索关键词
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                type="text"
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  if (error) setError("");
                }}
                placeholder="输入企业/品牌/人物名称…"
                className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                disabled={isLoading}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
            </div>
          </div>

          {/* 开始日期 */}
          <div>
            <label className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1.5 block">
              开始日期
            </label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                disabled={isLoading}
              />
            </div>
          </div>

          {/* 结束日期 + 搜索按钮 */}
          <div>
            <label className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1.5 block">
              结束日期
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  disabled={isLoading}
                />
              </div>
              <button
                onClick={handleSearch}
                disabled={isLoading || !keyword.trim()}
                className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 shrink-0"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    搜索中
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    搜索
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 font-medium mt-3">
            {error}
          </p>
        )}

        {/* 提示 */}
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-3">
          支持搜索企业名称、品牌名、项目名等。搜索结果来自百度新闻 + 微信公众号。
        </p>
      </div>

      {/* ========== 加载动画 ========== */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-500 gap-3">
          <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
          <p className="text-sm">正在搜索全网媒体发稿…</p>
          <p className="text-xs text-zinc-400">
            同时查询百度新闻和微信公众号，可能需要 10-30 秒
          </p>
        </div>
      )}

      {/* ========== 搜索结果 ========== */}
      {data && !isLoading && (
        <>
          {/* 标题 */}
          <div className="mb-6">
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3">
              搜索结果：
              <span className="text-blue-600 dark:text-blue-400">
                {data.keyword}
              </span>
              <span className="text-zinc-500 font-normal ml-2">
                {data.dateRange.from} ~ {data.dateRange.to} · 共{" "}
                {data.totalCount} 条
              </span>
            </h2>

            {/* 分类统计卡片 */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
              <StatCard
                label="总计"
                value={data.totalCount}
                bg="bg-blue-50 dark:bg-blue-950"
                color="text-blue-700 dark:text-blue-300"
              />
              {Object.entries(CATEGORY_CONFIG).map(([key, config]) => {
                const count = data.stats.byCategory[key] || 0;
                if (count === 0 && key !== "未分类") return null;
                if (key === "未分类" && count === 0) return null;
                return (
                  <StatCard
                    key={key}
                    label={config.label}
                    value={count}
                    bg={config.bg}
                    color={config.color}
                  />
                );
              })}
            </div>

            {/* 来源提示 */}
            <div className="text-xs text-zinc-500 mt-2">
              百度新闻：{data.stats.bySource.baidu} 条 · 微信公众号：
              {data.stats.bySource.wechat} 条
            </div>
          </div>

          {/* ========== 操作栏 ========== */}
          {data.results.length > 0 && (
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">排序：</span>
                <button
                  onClick={() => setSortField("date")}
                  className={`text-xs px-3 py-1 rounded-full transition-colors ${
                    sortField === "date"
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200"
                  }`}
                >
                  按日期
                </button>
                <button
                  onClick={() => setSortField("category")}
                  className={`text-xs px-3 py-1 rounded-full transition-colors ${
                    sortField === "category"
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200"
                  }`}
                >
                  按媒体级别
                </button>
              </div>
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                导出 CSV
              </button>
            </div>
          )}

          {/* ========== 结果表格 ========== */}
          {data.results.length > 0 ? (
            <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
                      <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 w-24">
                        日期
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500">
                        文章标题
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 w-36">
                        刊发媒体
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 w-24">
                        媒体类别
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 w-16">
                        链接
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedResults.map((item, index) => (
                      <tr
                        key={`${item.url}-${index}`}
                        className="border-b border-zinc-100 dark:border-zinc-800 last:border-none hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                      >
                        <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap">
                          {item.date}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm leading-relaxed">
                            {item.title}
                          </div>
                          {item.snippet && (
                            <div className="text-xs text-zinc-500 mt-1 line-clamp-2">
                              {item.snippet}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs whitespace-nowrap">
                          {item.media}
                        </td>
                        <td className="px-4 py-3">
                          <CategoryBadge category={item.category} />
                        </td>
                        <td className="px-4 py-3">
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline text-xs"
                          >
                            <ExternalLink className="w-3 h-3" />
                            查看
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : data.totalCount === 0 ? (
            <div className="text-center py-16 text-zinc-500">
              <Search className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">未找到相关发稿</p>
              <p className="text-xs mt-1 text-zinc-400">
                请尝试更换关键词或扩大日期范围
              </p>
            </div>
          ) : null}
        </>
      )}

      {/* ========== 初始状态 ========== */}
      {!data && !isLoading && (
        <div className="text-center py-20 text-zinc-500">
          <Search className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <p className="text-base font-medium text-zinc-700 dark:text-zinc-300">
            外媒发稿统计助手
          </p>
          <p className="text-sm mt-1 text-zinc-400">
            输入名称和日期范围，一键搜索全网媒体发稿
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 子组件
// ============================================================

function StatCard({
  label,
  value,
  bg,
  color,
}: {
  label: string;
  value: number;
  bg: string;
  color: string;
}) {
  return (
    <div className={`rounded-lg px-3 py-2.5 ${bg}`}>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className={`text-xs ${color} opacity-70`}>{label}</div>
    </div>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const config = CATEGORY_CONFIG[category] || CATEGORY_CONFIG["未分类"];
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded text-xs border ${config.bg} ${config.color}`}
    >
      {config.label}
    </span>
  );
}
