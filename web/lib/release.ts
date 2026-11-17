export function shouldReloadRelease(current: string, served: unknown, previousAttempt: string | null) {
  return typeof served === "string" && /^[a-f0-9]{64}$/.test(served) && served !== current && served !== previousAttempt;
}

export const LEGACY_CACHE_RESET_KEY = "webstone-legacy-cache-reset-v1";

export async function clearLegacyCache(
  storage: () => Pick<Storage, "getItem" | "setItem">,
  request: () => Promise<{ status: number; headers: { get(name: string): string | null } }>,
) {
  try {
    const saved = storage();
    if (saved.getItem(LEGACY_CACHE_RESET_KEY) === "done") return true;
    const response = await request();
    if (response.status !== 204 || response.headers.get("clear-site-data") !== '"cache"') return false;
    saved.setItem(LEGACY_CACHE_RESET_KEY, "done");
    return true;
  } catch {
    // Cache migration is optional; storage/network failures must not interrupt release checks.
    return false;
  }
}
