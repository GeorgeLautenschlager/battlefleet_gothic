/** The determinism lint rules (validator spec §2.8, V6) actually fire on engine code. */
import { describe, expect, test } from "vitest";
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const eslint = new ESLint({ cwd });

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? "parse-error");
}

describe("engine lint rules", () => {
  test.each(["Math.sin(1)", "Math.atan2(1, 2)", "Math.hypot(3, 4)", "Math.pow(2, 3)", "Math.random()"])(
    "forbids %s in src/",
    async (call) => {
      expect(await ruleIds(`export const x = ${call};\n`, "src/probe.ts")).toContain("no-restricted-properties");
    },
  );

  test("forbids ** and the clock in src/", async () => {
    expect(await ruleIds("export const x = 2 ** 3;\n", "src/probe.ts")).toContain("no-restricted-syntax");
    expect(await ruleIds("export const x = Date.now();\n", "src/probe.ts")).toContain("no-restricted-syntax");
  });

  test("allows the IEEE-exact functions", async () => {
    expect(await ruleIds("export const x = Math.sqrt(2) + Math.abs(-1) + Math.floor(1.5) + Math.imul(3, 4);\n", "src/probe.ts")).toEqual([]);
  });

  test("tests may use platform maths (to compare against it)", async () => {
    expect(await ruleIds("export const x = Math.sin(1);\n", "test/probe.ts")).toEqual([]);
  });
});
