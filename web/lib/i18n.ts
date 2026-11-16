import type { Catalog, Snapshot } from "./results.ts";

export type Language = "en" | "zh";
export const LANGUAGE_KEY = "webstone-language";

const chinese: Record<string, string> = {
  "Skip to results": "跳至评测结果", "Close navigation": "关闭导航", "Open navigation": "打开导航",
  "Webstone home": "Webstone 首页", "Tracks": "评测方向", "TRACKS": "评测方向",
  "The touchstone for your agent's web tools": "智能体网页工具的试金石",
  "Download Report": "下载报告", "View website source on GitHub": "在 GitHub 查看网站源码",
  "SUBMIT YOUR RESULT": "提交评测结果", "Dataset": "数据集", "Track report": "方向汇总报告",
  "Version report": "版本评测报告", "Benchmarks": "评测基准", "Version": "结果版本",
  "Loading…": "正在加载…", "Retry": "重试", "Unable to load results. Please try again.": "无法加载评测结果，请重试。",
  "No results for this version": "此版本暂无结果", "No results for this benchmark": "此基准暂无结果",
  "View latest version": "查看最新版本", "no results": "暂无结果", "Best in this column": "本列最佳",
  "Not disclosed in the source": "来源未披露", "Passed / Total": "通过 / 总数", "Price / 1K": "每千次价格",
  "Results": "评测结果", "Selected insights": "精选分析", "Methodology & scope": "方法与范围",
  "Published methods": "已公布方案", "Evaluation cases": "评测样本", "Primary metric": "主指标",
  "Leaderboard": "排行榜", "Click a metric to sort. Open a method for its configuration and evidence.": "点击指标排序，打开方案详情查看配置与证据。",
  "Method details": "方案详情", "Close details": "关闭详情", "Configuration": "方案配置",
  "Billing basis": "计费口径", "Not supplied": "未提供", "Quality comparison": "质量对比",
  "Higher is better": "越高越好", "Lower is better": "越低越好", "95% confidence interval": "95% 置信区间",
  "Intervals are transcribed from the report; point estimates do not establish statistical significance.": "区间按原报告记录；点估计领先不代表差异具有统计显著性。",
  "Only disclosed values are shown. No scores are inferred from ranking or chart geometry.": "仅展示已披露数值，不根据排名或图形推算缺失分数。",
  "Category performance": "类别表现", "Choose a method": "选择方案", "Passed cases / category total": "通过数 / 类别总数",
  "Annotated source coverage": "标注来源覆盖", "Original URL": "原始网址", "Equivalent URL": "等价网址",
  "Verified copy": "已验证的同页副本", "Not found": "未命中", "Each bar uses the quality-scoring population, not the timing-call population.": "每条使用质量评分样本数，不使用计时调用次数。",
  "Latency distribution": "延迟分布", "P50 and P95 are published percentiles, not a reconstructed distribution.": "P50 和 P95 为已公布分位数，不是重建的完整分布。",
  "Different collection dates and concurrency: these timings are not a controlled same-window speed comparison.": "采集日期和并发不同：这些耗时不是同一时间窗口下的受控速度比较。",
  "Dataset difference": "数据集差异", "Read the full Track report": "阅读完整方向报告",
  "Selected charts use only the current benchmark and result version.": "精选图表仅使用当前基准与结果版本的数据。",
  "Scenario queries": "场景查询", "Factual questions": "事实问答", "Output layer": "输出层级",
  "L1 · Search results": "L1 · 搜索列表", "L2 · Supplemental text": "L2 · 补充原文", "L3 · Generated answers": "L3 · 生成答案",
  "Each layer is scored independently. Scores cannot be added or read as incremental gains.": "各层独立评分，分数不可相加，也不能直接解释为增益。",
  "opens in a new tab": "在新标签页打开", "project": "项目", "details": "详情", "samples": "样本",
  "Shared across both query sets.": "由两个查询集合共同统计。", "Pass criteria": "通过条件", "cases": "条样本",
  "Provider": "参与方案", "Browser": "浏览器", "Method": "方案", "Service": "服务",
  "Quoted prices and ranges are not realized total costs. Software-only prices exclude model usage.": "报价及区间不代表实际总成本；纯软件价格不含模型费用。",
  "The report does not disclose a comparable second timing metric.": "报告未披露可对照的第二项计时指标。",
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
