"use client";

import { useEffect } from "react";
import { RELEASE } from "../lib/release.generated";
import { shouldReloadRelease } from "../lib/release";

// An HTTP cache policy cannot replace JavaScript in an already-open page.
export default function ReleaseCheck() {
  useEffect(() => {
    let active = true, pending = false;
    const controller = new AbortController();
    const key = "webstone-release-reload";
    async function check() {
      if (!active || pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const response = await fetch(`/release.json?check=${Date.now()}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const { release } = await response.json();
        let previous: string | null = null;
        try { previous = sessionStorage.getItem(key); } catch { /* Storage may be disabled. */ }
        if (active && shouldReloadRelease(RELEASE, release, previous)) {
          try { sessionStorage.setItem(key, release); } catch { return; }
          window.location.reload();
        }
      } catch { /* An unavailable version check must not interrupt reading results. */ }
      finally { pending = false; }
    }
    const restored = (event: PageTransitionEvent) => { if (event.persisted) void check(); };
    window.addEventListener("pageshow", restored);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    const timer = window.setInterval(check, 60_000);
    void check();
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("pageshow", restored);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return null;
}
