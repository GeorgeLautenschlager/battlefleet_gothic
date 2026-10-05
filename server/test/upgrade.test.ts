import { expect, test } from "vitest";
import { isWebSocketUpgrade } from "../src/cf/deps";

test("WebSocket upgrades are recognised in any case", () => {
  const req = (upgrade?: string) => new Request("https://x/", upgrade === undefined ? {} : { headers: { Upgrade: upgrade } });
  expect(isWebSocketUpgrade(req("websocket"))).toBe(true);
  expect(isWebSocketUpgrade(req("WebSocket"))).toBe(true);
  expect(isWebSocketUpgrade(req("h2c"))).toBe(false);
  expect(isWebSocketUpgrade(req())).toBe(false);
});
