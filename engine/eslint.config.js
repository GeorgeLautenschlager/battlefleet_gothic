// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Platform transcendental functions are implementation-approximated and can
// differ between JS engines. Engine code must use the deterministic `dmath`
// module instead (validator spec §2.8, ruling V6).
const FORBIDDEN_MATH = [
  "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
  "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
  "hypot", "pow", "exp", "expm1", "log", "log1p", "log2", "log10", "cbrt",
  "random",
];

export default tseslint.config(
  { ignores: ["node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        ...FORBIDDEN_MATH.map((property) => ({
          object: "Math",
          property,
          message: "Not deterministic across JS engines. Use dmath (validator spec §2.8).",
        })),
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "BinaryExpression[operator='**'], AssignmentExpression[operator='**=']",
          message: "`**` is Math.pow: not deterministic across JS engines (validator spec §2.8).",
        },
        {
          selector: "MemberExpression[object.name='Date']",
          message: "The engine never reads the clock.",
        },
      ],
    },
  },
  {
    // Tests index into fixtures they just built; `!` is clearer than a guard there.
    files: ["test/**/*.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
);
