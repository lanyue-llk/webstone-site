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
      title: text("Install the submission skill", "安装提交 Skill"),
      description: text("Ask your agent to prepare a pull request using the submission skill. Git, GitHub CLI and Node.js 22.13+ are sufficient; Webstone CLI is optional.", "让你的 Agent 按提交 Skill 准备 PR。仅需 Git、GitHub CLI 和 Node.js 22.13+，无需安装 Webstone CLI。"),
      command: 'gh repo clone lexmount/webstone-site\ncd webstone-site\n# Codex skills directory; use your agent’s equivalent if different.\nmkdir -p "$HOME/.codex/skills"\n# Inspect an existing destination before copying.\nmkdir "$HOME/.codex/skills/submit-webstone-result" && cp .agents/skills/submit-webstone-result/SKILL.md "$HOME/.codex/skills/submit-webstone-result/SKILL.md"',
    },
    {
      title: text("Prepare public measurements", "准备公开结果"),
      description: text("Use the current catalog and version guide to add a result JSON file with actual measurements, configuration, sample counts and public evidence. Unknown metrics stay null. Add a new method’s official HTTPS project URL to the catalog.", "按当前目录与版本指南新增结果 JSON，填写真实测量值、配置、样本数和公开证据。未知指标保留 null；新方案在目录中补充官方 HTTPS 项目链接。"),
      command: 'git switch -c results/my-method\n# Ask your agent to read .agents/skills/submit-webstone-result/SKILL.md\n# Add results/<benchmark>/<benchmark>-vX.Y.Z-report.json',
    },
    {
      title: text("Validate and open a PR", "校验并创建 PR"),
      description: text("Run the site’s checks, inspect the diff, then commit and push a feature branch to your fork. Open a result-only PR against lexmount/webstone-site. Internal and external contributors use the same process.", "运行网站校验、检查差异，再提交并推送到自己的 fork 分支，向 lexmount/webstone-site 创建仅含结果的 PR。内部和外部贡献者采用同一流程。"),
      command: 'npm ci --ignore-scripts\nnpm test\nnpm run build\n# Commit and push only the result and necessary participant URLs.\ngh pr create --repo lexmount/webstone-site --base main --head YOUR_LOGIN:results/my-method',
    },
    {
      title: text("Review, then verify publication", "审核后验证上线"),
      description: text("CI checks the contract and immutable history; maintainers review the evidence. After merge, verify the actual deployment commit, selected result and JSON download. A merged PR alone does not prove publication.", "CI 检查合同与历史不可变性，维护者审核证据。合入后核对实际部署提交、所选结果和 JSON 下载；PR 合入不等于上线成功。"),
      command: 'gh pr checks NUMBER --repo lexmount/webstone-site\n# Follow review; maintainers control merge.\n# Then verify the new result on the live leaderboard.',
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
      <div className="submission-links"><a href={REPOSITORY + "/pulls"} target="_blank" rel="noreferrer">{text("Result pull requests", "结果提交 PR")}<ArrowUpRight size={13} /></a><a href={REPOSITORY + "/blob/main/docs/submitting-results.md"} target="_blank" rel="noreferrer">{text("Format and review guide", "格式与审核指南")}<ArrowUpRight size={13} /></a><a href={REPOSITORY + "/blob/main/.agents/skills/submit-webstone-result/SKILL.md"} target="_blank" rel="noreferrer">{text("Submission skill", "提交 Skill")}<ArrowUpRight size={13} /></a></div>
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
