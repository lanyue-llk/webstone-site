const semantic = /^v([1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?![\s\S])/;
const historical = /^v([1-9]\d*)(?![\s\S])/;

export function versionParts(version) {
  if (typeof version !== "string") throw new Error("Invalid result version");
  const match = semantic.exec(version) ?? historical.exec(version);
  if (!match) throw new Error("Invalid result version");
  return [BigInt(match[1]), BigInt(match[2] ?? 0), BigInt(match[3] ?? 0)];
}

export function isSemanticVersion(version) {
  return typeof version === "string" && semantic.test(version);
}

export function canonicalVersion(version) {
  return `v${versionParts(version).join(".")}`;
}

export function compareVersions(left, right) {
  const a = versionParts(left), b = versionParts(right);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  return 0;
}

export function nextVersion(latest, kind) {
  if (!["protocol", "results", "metadata"].includes(kind)) throw new Error("Unknown release kind");
  if (!latest) {
    if (kind !== "results") throw new Error("An initial release must contain results");
    return "v1.0.0";
  }
  const [major, minor, patch] = versionParts(latest);
  if (kind === "protocol") return `v${major + 1n}.0.0`;
  if (kind === "results") return `v${major}.${minor + 1n}.0`;
  return `v${major}.${minor}.${patch + 1n}`;
}

export function releaseDate(snapshot) {
  if (snapshot.release?.date) return { date: snapshot.release.date, kind: "released" };
  const imported = snapshot.source?.importedAt;
  return typeof imported === "string" && /^\d{4}-\d{2}-\d{2}T/.test(imported) && Number.isFinite(Date.parse(imported))
    ? { date: imported.slice(0, 10), kind: "imported" } : { date: null, kind: "unknown" };
}
