export function shouldReloadRelease(current: string, served: unknown, previousAttempt: string | null) {
  return typeof served === "string" && /^[a-f0-9]{64}$/.test(served) && served !== current && served !== previousAttempt;
}
