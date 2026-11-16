"use client";

import { ArrowLeft, ArrowUpRight, Layers3 } from "lucide-react";
import { useLanguage } from "../lib/use-language";
import ReleaseCheck from "./release-check";

const REPOSITORY = "https://github.com/lexmount/webstone-site";

export default function SubmissionGuide() {
  const [language, chooseLanguage] = useLanguage();
  const text = (english: string, chinese: string) => language === "zh" ? chinese : english;
  const steps = [
    {
      title: text("Install the CLI", "安装 CLI"),
      description: text("Install Webstone from its maintained source until a PyPI release containing the results CLI is available. Python 3.11+ and GitHub CLI are required.", "包含结果提交 CLI 的 PyPI 版本发布前，请从维护中的源码安装。需要 Python 3.11+ 和 GitHub CLI。"),
      command: 'pip install "git+https://github.com/lexmount/webstone.git"\ngh auth login',
    },
    {
      title: text("Prepare public measurements", "准备公开结果"),
      description: text("Generate a template, then fill actual measurements, configuration, scope and a public evidence URL. Empty template values are placeholders, not scores. Use null for undisclosed metrics.", "生成模板后，填写真实测量值、配置、评测范围及公开证据链接。模板空值只是占位符，不是分数；未披露的指标使用 null。"),
      command: 'webstone results template --benchmark lexbench-webfetch --definition split-media --output report.json\nwebstone results validate report.json',
    },
    {
      title: text("Preview and submit", "预览并提交"),
      description: text("The same command is used by Lexmount and external contributors. It creates a result-only PR from your personal fork; it never writes directly to main. Add a project URL for each new method.", "揽岳内部和外部贡献者使用同一命令。工具从个人 fork 创建仅含结果的 PR，不会直接写入 main。新方案需提供项目链接。"),
      command: 'webstone results submit report.json --provider-url your-method=https://example.com/project --dry-run\nwebstone results submit report.json --provider-url your-method=https://example.com/project',
    },
    {
      title: text("Review, then publish", "审核后发布"),
      description: text("CI checks the data contract and immutable history. Maintainers review evidence, denominators and configuration. Only an approved, passing PR may merge; Rainbond then builds and publishes it. Merge success alone does not prove deployment success.", "CI 检查数据合同与历史不可变性；维护者审核证据、分母和方案配置。审批与检查通过后才能合入，再由 Rainbond 构建发布。合入成功不等于部署成功。"),
      command: 'webstone results status 123 --verify-published\n# If another result version was merged first:\nwebstone results rebase 123',
    },
  ];
  return <div className="submission-shell">
    <ReleaseCheck />
    <header className="submission-header"><a href="/" className="brand"><span className="brand-heading"><Layers3 size={24} /><span>Webstone</span></span></a><div className="language-control" role="group" aria-label="Language / 语言"><button lang="en" aria-pressed={language === "en"} onClick={() => chooseLanguage("en")}>EN</button><button lang="zh" aria-pressed={language === "zh"} onClick={() => chooseLanguage("zh")}>中文</button></div></header>
    <main className="submission-content">
      <a className="back-link" href="/"><ArrowLeft size={14} />{text("Back to benchmarks", "返回评测榜单")}</a>
      <span className="eyebrow">{text("CONTRIBUTE / RESULTS", "贡献 / 评测结果")}</span>
      <h1>{text("Submit a benchmark result", "提交评测结果")}</h1>
      <p className="submission-intro">{text("Publish a reproducible, versioned result through review. Use your GitHub account; no separate Webstone account is needed.", "通过审核发布可追溯的版本化结果。使用已有 GitHub 账号，无需另建 Webstone 账号。")}</p>
      <div className="submission-links"><a href={REPOSITORY + "/pulls"} target="_blank" rel="noreferrer">{text("Result pull requests", "结果提交 PR")}<ArrowUpRight size={13} /></a><a href={REPOSITORY + "/blob/main/docs/submitting-results.md"} target="_blank" rel="noreferrer">{text("Format and review guide", "格式与审核指南")}<ArrowUpRight size={13} /></a><a href="https://cli.github.com/" target="_blank" rel="noreferrer">GitHub CLI<ArrowUpRight size={13} /></a></div>
      <p className="scope-warning">{text("Only submit public, non-sensitive data. Pending pull requests are public too. Keep credentials, raw private logs and large artifacts outside Git.", "仅提交可公开且不含敏感信息的数据；待审 PR 同样公开。凭证、私有原始日志和大型产物不得放入 Git。")}</p>
      <ol className="submission-steps">{steps.map((step, index) => <li key={index}><span className="step-number">0{index + 1}</span><div><h2>{step.title}</h2><p>{step.description}</p><pre><code>{step.command}</code></pre></div></li>)}</ol>
      <section className="submission-review"><h2>{text("What reviewers check", "审核内容")}</h2><ul>
        <li>{text("The benchmark definition, dataset revision, actual sample population and scoring provenance are stated.", "说明所用评测定义、数据集版本、实际样本范围和评分出处。")}</li>
        <li>{text("Measurements are traceable to public evidence; missing metrics stay null, and denominators and units are explicit.", "测量值可追溯到公开证据；缺失指标保留 null，并明确分母和单位。")}</li>
        <li>{text("Participant versions, configuration and billing/timing conditions are disclosed. Validation checks structure, not scientific truth.", "披露方案版本、配置及计费和计时条件；自动校验只能检查结构，不能证明结果真实。")}</li>
        <li>{text("Corrections add a new version with an explanation. Published result files are never overwritten or deleted.", "修正结果需新增版本并说明原因，不覆盖或删除已发布文件。")}</li>
      </ul></section>
    </main>
  </div>;
}
