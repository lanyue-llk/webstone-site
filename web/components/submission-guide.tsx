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
      description: text("Ask your agent to prepare the pull request. It will need Git, GitHub CLI and Node.js 22.13 or later.", "让助手按提交 Skill 准备 PR。需要 Git、GitHub CLI 和 Node.js 22.13 或更高版本。"),
      command: 'gh repo clone lexmount/webstone-site\ncd webstone-site\n# Codex skills directory; use your agent’s equivalent if different.\nmkdir -p "$HOME/.codex/skills"\n# Inspect an existing destination before copying.\nmkdir "$HOME/.codex/skills/submit-webstone-result" && cp .agents/skills/submit-webstone-result/SKILL.md "$HOME/.codex/skills/submit-webstone-result/SKILL.md"',
    },
    {
      title: text("Prepare the result file", "准备结果文件"),
      description: text("Record the measurements, setup, sample counts and public evidence in a new result file. Use null for missing values. For a new method, add its official HTTPS link to the catalog.", "新建结果文件，记录测量值、配置、样本数和公开证据。缺失值填 null。新增方案时，在目录中填上官方 HTTPS 链接。"),
      command: 'git switch -c results/my-method\n# Ask your agent to read .agents/skills/submit-webstone-result/SKILL.md\n# Add results/<benchmark>/<benchmark>-vX.Y.Z-report.json',
    },
    {
      title: text("Validate and open a PR", "校验并创建 PR"),
      description: text("Run the checks and review the diff. Push the result branch to your fork and open a PR against lexmount/webstone-site.", "检查测试和改动后，把结果分支推送到自己的 fork，再向 lexmount/webstone-site 提交 PR。"),
      command: 'npm ci --ignore-scripts\nnpm test\nnpm run build\n# Commit and push only the result and necessary participant URLs.\ngh pr create --repo lexmount/webstone-site --base main --head YOUR_LOGIN:results/my-method',
    },
    {
      title: text("Check the published result", "核对上线结果"),
      description: text("Maintainers review the evidence. After deployment, open the new version on the leaderboard and check the JSON download.", "维护者审核评测证据。部署后，打开排行榜上的新版本，确认结果和 JSON 下载均可访问。"),
      command: 'gh pr checks NUMBER --repo lexmount/webstone-site\n# Follow review; maintainers control merge.\n# Then verify the new result on the live leaderboard.',
    },
  ];
  return <div className="submission-shell">
    <ReleaseCheck />
    <header className="submission-header"><a href="/" className="brand"><span className="brand-heading"><Layers3 size={24} /><span>Webstone</span></span></a><div className="language-control" role="group" aria-label="Language / 语言"><button lang="en" aria-pressed={language === "en"} onClick={() => chooseLanguage("en")}>EN</button><button lang="zh" aria-pressed={language === "zh"} onClick={() => chooseLanguage("zh")}>中文</button></div></header>
    <main className="submission-content">
      <a className="back-link" href="/"><ArrowLeft size={14} />{text("Back to benchmarks", "返回评测榜单")}</a>
      <h1>{text("Submit a benchmark result", "提交评测结果")}</h1>
      <p className="submission-intro">{text("Submit measured results and public evidence with a GitHub pull request.", "通过 GitHub PR 提交测量结果和公开证据。")}</p>
      <div className="submission-links"><a href={REPOSITORY + "/pulls"} target="_blank" rel="noreferrer">{text("Result pull requests", "结果提交 PR")}<ArrowUpRight size={13} /></a><a href={REPOSITORY + "/blob/main/docs/submitting-results.md"} target="_blank" rel="noreferrer">{text("Format and review guide", "格式与审核指南")}<ArrowUpRight size={13} /></a><a href={REPOSITORY + "/blob/main/.agents/skills/submit-webstone-result/SKILL.md"} target="_blank" rel="noreferrer">{text("Submission skill", "提交 Skill")}<ArrowUpRight size={13} /></a></div>
      <p className="scope-warning">{text("Pull requests are public. Keep credentials, private logs and large files out of Git.", "PR 公开可见。请勿提交凭证、私有日志或大文件。")}</p>
      <ol className="submission-steps">{steps.map((step, index) => <li key={index}><span className="step-number">0{index + 1}</span><div><h2>{step.title}</h2><p>{step.description}</p><pre><code>{step.command}</code></pre></div></li>)}</ol>
      <section className="submission-review"><h2>{text("What reviewers check", "审核内容")}</h2><ul>
        <li>{text("Benchmark definition, dataset revision, evaluated sample and scoring method.", "评测定义、数据集版本、实际样本范围和评分方式。")}</li>
        <li>{text("Public evidence for reported values, with denominators and units.", "数值对应的公开证据，以及分母和单位。")}</li>
        <li>{text("Method versions, configuration, billing units and timing conditions.", "方案版本、配置、计费单位和计时条件。")}</li>
        <li>{text("Corrections have a new version and explain what changed.", "更正结果时新增版本，并说明改动。")}</li>
      </ul></section>
    </main>
  </div>;
}
