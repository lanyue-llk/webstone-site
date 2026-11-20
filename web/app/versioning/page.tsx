"use client";

import { useLanguage } from "../../lib/use-language";

export default function VersioningPage() {
  const [language, chooseLanguage] = useLanguage();
  const zh = language === "zh";
  return <main className="submission-shell">
    <header className="submission-header"><a className="brand" href="/">Webstone</a><div className="language-control" role="group" aria-label="Language / 语言"><button onClick={() => chooseLanguage("en")} aria-pressed={!zh}>EN</button><button onClick={() => chooseLanguage("zh")} aria-pressed={zh}>中文</button></div></header>
    <article className="submission-content">
      <a className="back-link" href="/">← {zh ? "返回排行榜" : "Back to leaderboard"}</a>
      <h1>{zh ? "结果版本规范" : "Result versioning"}</h1>
      <p className="submission-intro">{zh ? "每项评测单独使用 vMAJOR.MINOR.PATCH。更新结果时提交 PR，新增版本并保留已发布的文件。" : "Each benchmark uses its own vMAJOR.MINOR.PATCH numbering. Publish updates as new versions through pull requests and keep the published files."}</p>
      <ol className="submission-steps">
        <li><span className="step-number">01</span><div><h2>MAJOR · v2.0.0</h2><p>{zh ? "题目、参考答案或评分规则一旦变动，影响新旧结果对比，就升级主版本。指标含义变更时，使用新的 definitionId。" : "Use a major version when changes to tasks, references or scoring make results hard to compare. Use a new definitionId if a metric changes meaning."}</p></div></li>
        <li><span className="step-number">02</span><div><h2>MINOR · v1.1.0</h2><p>{zh ? "在相同任务集合和评分协议下，增加评测方案、更新方案配置或测量结果，包括纠正已公布的数值。" : "Add methods, change method configurations, publish new measurements or correct scores under the same task population and scoring protocol."}</p></div></li>
        <li><span className="step-number">03</span><div><h2>PATCH · v1.0.1</h2><p>{zh ? "适用于文案、证据或链接的修正。分数、样本数、方案和配置沿用原版本。" : "Correct wording, evidence or links without changing scores, sample counts, method identities or configurations."}</p></div></li>
      </ol>
      <section className="submission-review"><h2>{zh ? "日期与历史结果" : "Dates and historical results"}</h2><p>{zh ? "新结果记录审核时确认的 UTC 发布日期。旧版 vN 显示为 vN.0.0，原链接仍可用。可查到公开记录时，页面会链接到首次提交。站点更新时间单独显示。" : "New results record the UTC release date confirmed in review. Historical vN results appear as vN.0.0 and keep their original links. Where available, the first public date links to the commit. The site update time is shown separately."}</p><a href="/submit">{zh ? "提交评测结果 →" : "Submit results →"}</a></section>
    </article>
  </main>;
}
