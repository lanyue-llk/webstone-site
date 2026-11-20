import type { Catalog, Snapshot } from "./results.ts";

export type Language = "en" | "zh";
export const LANGUAGE_KEY = "webstone-language";

const chinese: Record<string, string> = {
  "First published in the repository": "首次公开",
  "More metrics": "更多指标",
  "Category breakdown": "分类结果",
  "Website updated": "站点更新",
  "Version released": "发布日期",
  "Release date not recorded for this historical version.": "旧版未记录发布日期。",
  "Cost was not disclosed in this report.": "报告未提供成本数据。",
  "methods": "个方案",
  "Table columns": "表格列",
  "Result versioning": "版本规则",
  "Compare methods": "方案对比",
  "Methods to compare": "参与对比的方案",
  "Skip to results": "跳至评测结果",
  "Close navigation": "关闭导航",
  "Open navigation": "打开导航",
  "Webstone home": "Webstone 首页",
  "Tracks": "评测方向",
  "Download Report": "下载报告",
  "View website source on GitHub": "在 GitHub 查看网站源码",
  "Dataset": "数据集",
  "Evaluation report": "评测报告",
  "Evaluation notes": "评测说明",
  "Version report": "版本评测报告",
  "Benchmarks": "评测基准",
  "Version": "结果版本",
  "Loading…": "正在加载…",
  "Retry": "重试",
  "No results for this version": "此版本暂无结果",
  "No results for this benchmark": "此基准暂无结果",
  "View latest version": "查看最新版本",
  "no results": "暂无结果",
  "Best in this column": "本列最佳",
  "Not disclosed in the source": "未公布",
  "Passed / Total": "通过 / 总数",
  "Price / 1K": "每千次价格",
  "Leaderboard": "排行榜",
  "Method details": "方案详情",
  "Close details": "关闭详情",
  "Configuration": "方案配置",
  "Billing basis": "计费口径",
  "Not supplied": "未提供",
  "95% confidence interval": "95% 置信区间",
  "Output layer": "输出层级",
  "opens in a new tab": "在新标签页打开",
  "project": "项目",
  "details": "详情",
  "samples": "样本",
  "Shared across both query sets.": "包含两套题库的调用。",
  "Pass criteria": "通过条件",
  "cases": "条样本",
  "Method": "方案",
  "Quoted prices and ranges are not realized total costs. Software-only prices exclude model usage.": "报价及区间不代表实际总成本；纯软件价格不含模型费用。",
  "Quality": "质量",
  "Latency": "耗时",
  "Memory": "内存",
  "Pricing": "报价",
  "Quality breakdown": "分项质量",
  "Source coverage": "来源覆盖率",
  "Original source coverage": "原始网址命中率",
  "Price per 1,000 calls": "每千次调用报价",
  "Per 1,000 requests": "每千次请求",
  "Per 1,000 successful searches": "每千次成功搜索",
  "Filter methods": "筛选方案",
  "Select a method to show its results.": "请选择要对比的方案。",
  "Submit results": "提交结果",
  "Latency comes from separate runs with different concurrency.": "各服务分批测试，并发数不同。",
  "L1 · Search results": "L1 搜索结果",
  "L2 · Supplemental text": "L2 补充原文",
  "L3 · Generated answers": "L3 生成答案"
};

export function initialLanguage(saved: string | null): Language {
  return saved === "zh" ? "zh" : "en";
}

export function translator(language: Language, catalog?: Catalog | null, snapshot?: Snapshot | null) {
  return (text: string): string => {
    if (language === "en") return snapshot?.translations?.en?.[text] ?? catalog?.translations?.en?.[text] ?? text;
    if (/^Software \$[0-9.]+ \+ model$/.test(text)) return text.replace("Software ", "软件 ").replace(" + model", " + 模型费用");
    return snapshot?.translations?.zh?.[text] ?? catalog?.translations?.zh?.[text] ?? chinese[text] ?? text;
  };
}
