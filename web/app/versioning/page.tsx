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
      <p className="submission-intro">{zh ? "每个 Benchmark 独立使用 vMAJOR.MINOR.PATCH。结果发布后不可覆盖，任何更新都新增版本，并通过 PR 审批。" : "Each benchmark has independent vMAJOR.MINOR.PATCH result versions. Published files are immutable: every update creates a new version reviewed through a pull request."}</p>
      <ol className="submission-steps">
        <li><span className="step-number">01</span><div><h2>MAJOR · v2.0.0</h2><p>{zh ? "任务集合、参考答案或评分协议发生影响可比性的变化。指标含义改变时，需要新的 definitionId。" : "A change to the task population, reference answers or scoring protocol affects comparability. Changed metric semantics require a new definitionId."}</p></div></li>
        <li><span className="step-number">02</span><div><h2>MINOR · v1.1.0</h2><p>{zh ? "在相同任务集合和评分协议下，增加评测方案、更新方案配置或测量结果，包括纠正已公布的数值。" : "Add methods, change method configurations, publish new measurements or correct scores under the same task population and scoring protocol."}</p></div></li>
        <li><span className="step-number">03</span><div><h2>PATCH · v1.0.1</h2><p>{zh ? "只修正文案、证据或链接；分数、样本数、方案身份和配置均不变。" : "Correct wording, evidence or links without changing scores, sample counts, method identities or configurations."}</p></div></li>
      </ol>
      <section className="submission-review"><h2>{zh ? "日期与历史结果" : "Dates and historical results"}</h2><p>{zh ? "版本发布日期是审核时确认的 UTC 日期。旧结果未记录发布日期，保留原文件，将 vN 显示为 vN.0.0，并说明发布日期未记录；旧链接继续有效。站点部署时间、软件包版本和结果版本分别管理。" : "The result release date is recorded in UTC when the edition is approved. Historical versions appear as vN.0.0 and show that their release date was not recorded. Existing links remain valid. Website deployments, software versions and result versions are separate."}</p><a href="/submit">{zh ? "提交评测结果 →" : "Submit results →"}</a></section>
    </article>
  </main>;
}
