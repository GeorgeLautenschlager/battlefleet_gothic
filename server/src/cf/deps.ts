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

/** RFC 6455 §4.2.1: the Upgrade value "websocket" is matched case-insensitively (proxies may recase it). */
export function isWebSocketUpgrade(request: Request): boolean {
  return (request.headers.get("Upgrade") ?? "").toLowerCase() === "websocket";
}
