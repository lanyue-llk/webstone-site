import type { Language } from "./i18n.ts";

type Copy = [english: string, chinese: string];

const webFetch: Copy = [
  "430 tasks across seven website and content categories, including 17 embedded-media and three direct-media tasks.",
  "430 道任务分为七类，其中嵌入媒体 17 道，直链媒体 3 道。",
];
const webMain: Copy = ["545 frozen HTML pages, scored on full text, code, formulas, table content and table structure.", "545 份冻结 HTML，评测全文、代码、公式、表格内容和表格结构。"];
const scenarios: Copy = ["149 scenario queries. Search results, supplemental text and generated answers are scored separately.", "149 道场景题，搜索结果、补充原文和生成答案分别评分。"];
const factual773: Copy = ["Quality scores use 773 questions with valid references; timing covers all 831 questions.", "质量评分采用参考资料有效的 773 道题，耗时统计覆盖全部 831 道题。"];
const factual831: Copy = ["Quality and timing cover the same 831 factual questions.", "质量评分和耗时统计均覆盖同一批 831 道事实题。"];
const replay: Copy = ["812 WebArena-Verified tasks executed as fixed action sequences.", "按固定操作序列执行 812 个 WebArena-Verified 任务。"];
const swde: Copy = ["800 archived pages. Full-page exact match uses 740 pages; null handling uses 25 empty reference fields across 24 pages.", "800 份归档网页；整页全对率按 740 页计算，空值处理使用 24 页中的 25 个空参考字段。"];
const zyte: Copy = ["140 product pages, with six empty reference fields across six pages for null handling.", "140 个商品页，空值处理使用 6 页中的 6 个空参考字段。"];

const scopes: Record<string, Copy> = {
  "lexbench-webfetch-v1": webFetch,
  "lexbench-webfetch-v1.1.0": webFetch,
  "lexbench-webfetch-v2.0.0": webFetch,
  "lexbench-webfetch-v2.1.0": webFetch,
  "webmainbench-v1": webMain,
  "webmainbench-v1.1.0": webMain,
  "webmainbench-v2.0.0": webMain,
  "webmainbench-v2.1.0": webMain,
  "lexbench-websearch-v1": ["149 scenario queries. Mean latency covers 980 calls across both question sets.", "149 道场景题，平均耗时按两套题库合计 980 次调用计算。"],
  "lexbench-websearch-v2": scenarios,
  "lexbench-websearch-excerpts-v1": scenarios,
  "lexbench-websearch-answers-v1": scenarios,
  "simpleqa-verified-v1": ["773 factual questions. Mean latency covers 980 calls across both question sets.", "773 道事实题，平均耗时按两套题库合计 980 次调用计算。"],
  "simpleqa-verified-v2": factual773,
  "simpleqa-verified-excerpts-v1": factual773,
  "simpleqa-verified-answers-v1": factual773,
  "simpleqa-verified-v3.0.0": factual831,
  "simpleqa-verified-excerpts-v2.0.0": factual831,
  "simpleqa-verified-answers-v2.0.0": factual831,
  "lexbench-headless-372-v1": ["372-task functional suite comparing Moli build and layout configurations.", "功能评测使用 372 道题，比较不同 Moli 构建和布局配置。"],
  "lexbench-headless-372-v2.0.0": ["372 functional tasks. Resource statistics cover 1,045 calls across 209 common-pass tasks.", "功能评测包含 372 道任务，资源统计覆盖 209 道共同通过任务的 1,045 次调用。"],
  "webarena-verified-v1": replay,
  "webarena-verified-v1.1.0": replay,
  "lexbench-swde-v1": swde,
  "lexbench-swde-v1.0.1": swde,
  "lexbench-zyte-product-extraction-v1": zyte,
  "lexbench-zyte-product-extraction-v1.0.1": zyte,
  "online-mind2web-v1.0.0": ["300 Online-Mind2Web tasks on live websites.", "300 道基于真实网站的 Online-Mind2Web 任务。"],
  "webvoyager-v1.0.0": ["512 WebVoyager tasks across 13 websites.", "13 个网站的 512 道 WebVoyager 任务。"],
  "osworld-v1.0.0": ["75 OSWorld browser and web-to-document tasks.", "75 道 OSWorld 浏览器及网页与文档联动任务。"],
};

export function evaluationScopeCopy(id: string, language: Language) {
  const copy = scopes[id];
  return copy?.[language === "zh" ? 1 : 0] ?? null;
}
