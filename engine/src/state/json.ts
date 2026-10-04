/** Plain-JSON helpers (state spec §1, principle 1). */

/** Deep copy of a plain-JSON value. */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Paths at which `value` isn't plain JSON: undefined, non-finite numbers, −0
 * (JSON turns it into 0), functions, or non-plain objects (Date, Map, class instances…).
 * An empty list means `JSON.parse(JSON.stringify(value))` deep-equals `value`.
 */
export function nonJsonPaths(value: unknown, path = "$"): string[] {
  if (value === null || typeof value === "boolean" || typeof value === "string") return [];
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return [`${path}: non-finite number`];
    if (Object.is(value, -0)) return [`${path}: -0`];
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown, i) =>
      item === undefined ? [`${path}[${i}]: undefined`] : nonJsonPaths(item, `${path}[${i}]`),
    );
  }
  if (typeof value === "object") {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return [`${path}: not a plain object`];
    return Object.entries(value).flatMap(([key, item]) =>
      item === undefined ? [`${path}.${key}: undefined`] : nonJsonPaths(item, `${path}.${key}`),
    );
  }
  return [`${path}: ${typeof value}`];
}
