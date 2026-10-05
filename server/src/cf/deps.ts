/** The room's Deps on Cloudflare: Web Crypto and the clock. */
import type { Deps } from "../room";

export function workerDeps(engine: string): Deps {
  return {
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
    sha256: async (text) => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    },
    now: () => Date.now(),
    engine,
  };
}
