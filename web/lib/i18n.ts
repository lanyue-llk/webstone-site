import type { Catalog, Snapshot } from "./results.ts";

export type Language = "en" | "zh";
export const LANGUAGE_KEY = "webstone-language";

const chinese: Record<string, string> = {
  "Cost": "成本", "Accuracy, latency and cost": "准确率、耗时与成本", "Bubble size represents reported cost: smaller is cheaper. Inner/outer circles show a quoted range; hollow markers have no disclosed total cost. Check billing units before comparing.": "气泡越小，报告中的成本越低。内外圈表示报价区间；空心标记表示总成本未披露。比较前请核对计费单位。",
  "More metrics": "更多指标",
  "Quality unavailable": "准确率未披露",
  "Quoted price / 1K": "每千次报价", "Profile data unavailable": "缺少能力维度数据",
  "Category breakdown": "展开分类指标", "Website updated": "网站最新更新", "Version released": "版本发布日期", "Not recorded": "未记录", "Release date not recorded for this historical version.": "此历史版本未记录发布日期。",
  "Cost was not disclosed in this report; unknown does not mean free.": "此报告未披露成本；未知不代表免费。", "Accuracy and cost": "准确率与成本", "Accuracy and latency": "准确率与耗时", "Cost unavailable": "成本未披露", "None": "无",
  "Further left and higher is better. Lines preserve quoted price ranges; no midpoint or combined score is calculated. Billing units may differ; check method details.": "越靠左上越好。线段保留报价区间，不取中间值、不合成总分。计费单位可能不同，请查看方案详情。",
  "Further left and higher is better. Compare accuracy, latency and billing together; there is no universal best method.": "越靠左上越好。结合准确率、耗时与计费口径选择，没有适用于所有场景的唯一最优方案。",
  "methods": "个方案", "Table columns": "表格列", "Overview": "主要指标", "All metrics": "全部指标", "Categories": "分类结果",
  "Released": "发布", "Imported": "导入", "Date unrecorded": "日期未记录", "Result versioning": "结果版本规范", "Historical publication date was not recorded; the version selector shows its import date.": "历史结果未记录发布日期；版本选择器显示的是导入日期。",
  "Compare methods": "方案对比", "Select up to three methods": "最多选择 3 个方案", "Methods to compare": "对比方案", "Incomplete metrics": "指标不完整",
  "Capability profile": "能力对比", "Quality and resources": "质量与资源", "Source coverage and quality": "来源覆盖与质量", "Original source coverage": "原始来源覆盖率",
  "Horizontal axis": "横轴指标", "log scale": "对数刻度",
  "Confidence intervals are available in method details.": "置信区间可在方案详情中查看。",
  "Confidence interval": "置信区间",
  "Category pass rates use each category's own sample count.": "各类别通过率使用各自的样本数。",
  "Axes show 0–100% of each metric's defined range, without combining them into a score.": "各轴按指标定义范围换算为 0–100%，不合成为总分。",
  "Observed measurements; methods may use different execution and billing conditions.": "图中为实际测量值，各方案的运行及计费条件可能不同。",
  "The horizontal axis is the share of evaluated cases with an original source URL. It does not imply causation.": "横轴为原始网址占评测样本的比例，图中关系不代表因果关系。",
  "Skip to results": "跳至评测结果", "Close navigation": "关闭导航", "Open navigation": "打开导航",
  "Webstone home": "Webstone 首页", "Tracks": "评测方向", "TRACKS": "评测方向",
  "The touchstone for your agent's web tools": "智能体网页工具的试金石",
  "Download Report": "下载报告", "View website source on GitHub": "在 GitHub 查看网站源码",
  "SUBMIT YOUR RESULT": "提交结果", "Dataset": "数据集", "Evaluation report": "评测报告",
  "Source report": "结果来源", "Evaluation notes": "评测说明", "Analysis": "分析",
  "Benchmarks for AI agents' web tools": "面向 AI Agent 的 Web 工具评测",
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
  const names = new Set([
    "L1 · Search results", "L2 · Supplemental text", "L3 · Generated answers",
    ...(catalog?.tracks.map(item => item.name) ?? []),
    ...(catalog?.benchmarks.flatMap(item => [item.name, item.datasetName, ...item.definitions.flatMap(definition => definition.metrics.map(metric => metric.label))]) ?? []),
  ]);
  return (text: string): string => {
    if (names.has(text)) return snapshot?.translations?.en?.[text] ?? catalog?.translations?.en?.[text] ?? text;
    if (language === "en") return snapshot?.translations?.en?.[text] ?? catalog?.translations?.en?.[text] ?? text;
    if (/^Software \$[0-9.]+ \+ model$/.test(text)) return text.replace("Software ", "软件 ").replace(" + model", " + 模型费用");
    return snapshot?.translations?.zh?.[text] ?? catalog?.translations?.zh?.[text] ?? chinese[text] ?? text;
  };
}
