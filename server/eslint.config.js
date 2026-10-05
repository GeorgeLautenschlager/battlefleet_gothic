// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**", ".wrangler/**"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["src/**/*.ts"],
    ignores: ["src/cf/**"], // the Cloudflare adapter is where the real clock and crypto live
    rules: {
      // The room is pure: randomness, hashing and time come in through Deps.
      "no-restricted-properties": ["error", { object: "Math", property: "random", message: "Use Deps.random." }],
      "no-restricted-syntax": ["error", { selector: "MemberExpression[object.name='Date']", message: "Use Deps.now." }],
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
);
