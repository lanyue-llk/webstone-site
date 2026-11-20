// First publication on main, traced across the original dated filenames.
const firstPublications = [
  {
    date: "2026-11-11",
    commit: "9cd0c6d164b53731787ae896552a37974dcf27e9",
    reports: [
      "lexbench-headless-372-v1", "lexbench-webfetch-v1", "lexbench-websearch-v1",
      "simpleqa-verified-v1", "webarena-verified-v1", "webmainbench-v1",
    ],
  },
  {
    date: "2026-11-11",
    commit: "cce665b5118fdc2d6cf22cb0f395d7bf7b4a6e7c",
    reports: ["lexbench-swde-v1", "lexbench-zyte-product-extraction-v1"],
  },
  {
    date: "2026-11-16",
    commit: "768cb29bc4a234838473446514e419cf8aba72f5",
    reports: [
      "lexbench-websearch-v2", "lexbench-websearch-answers-v1", "lexbench-websearch-excerpts-v1",
      "simpleqa-verified-v2", "simpleqa-verified-answers-v1", "simpleqa-verified-excerpts-v1",
    ],
  },
];

export function historicalPublication(id: string) {
  return firstPublications.find(({ reports }) => reports.includes(id));
}
