/**
 * Gate G1, well-formedness (validator spec §3): a known type, a player of
 * "p1"/"p2", exactly the payload fields that type defines, with the right
 * JSON types, and finite numbers.
 */
import type { Transform } from "../transforms/types";

type FieldCheck = (value: unknown, path: string) => string | null;

const ORDER_KINDS = [
  "all_ahead_full",
  "come_to_new_heading",
  "burn_retros",
  "lock_on",
  "reload_ordnance",
  "brace_for_impact",
] as const;
const QUADRANTS = ["front", "left", "rear", "right"] as const;
const CRAFT_ROLES = ["fighter", "bomber", "assault_boat"] as const;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str: FieldCheck = (v, path) => (typeof v === "string" ? null : path);
const bool: FieldCheck = (v, path) => (typeof v === "boolean" ? null : path);
const num: FieldCheck = (v, path) => (typeof v === "number" && Number.isFinite(v) ? null : path);
const oneOf =
  (values: readonly string[]): FieldCheck =>
  (v, path) =>
    typeof v === "string" && values.includes(v) ? null : path;

/** An object with exactly these fields. */
const shape =
  (fields: Record<string, FieldCheck>): FieldCheck =>
  (v, path) => {
    if (!isObject(v)) return path;
    for (const key of Object.keys(v)) if (!(key in fields)) return `${path}.${key}`;
    for (const [key, check] of Object.entries(fields)) {
      const problem = check(v[key], `${path}.${key}`);
      if (problem !== null) return problem;
    }
    return null;
  };

const arrayOf =
  (item: FieldCheck): FieldCheck =>
  (v, path) => {
    if (!Array.isArray(v)) return path;
    for (const [i, element] of v.entries()) {
      const problem = item(element, `${path}[${i}]`);
      if (problem !== null) return problem;
    }
    return null;
  };

const point = shape({ x: num, y: num });

const pathStep: FieldCheck = (v, path) => {
  if (!isObject(v)) return path;
  if (v.kind === "advance") return shape({ kind: str, distance: num })(v, path);
  if (v.kind === "turn") return shape({ kind: str, degrees: num })(v, path);
  return `${path}.kind`;
};

const target = shape({ kind: oneOf(["ship", "ordnance"]), id: str });

/** Required and optional payload fields per transform type (transform spec §3). */
const PAYLOADS: Record<Transform["type"], { required: Record<string, FieldCheck>; optional?: Record<string, FieldCheck> }> = {
  roll_leadership: { required: {} },
  roll_zones: { required: {} },
  roll_deploy_order: { required: {} },
  deploy_ship: { required: { shipId: str, position: point } },
  roll_first_turn: { required: {} },
  choose_first_turn: { required: { goFirst: bool } },
  drift_hulk: { required: { shipId: str } },
  declare_order: { required: { shipId: str, order: oneOf(ORDER_KINDS) }, optional: { ramTargetId: str } },
  move: { required: { shipId: str, path: arrayOf(pathStep), disengage: bool }, optional: { boardTargetId: str } },
  release_cap: { required: { ordnanceId: str } },
  fire: {
    required: { shipId: str, weaponId: str, target },
    optional: { arc: oneOf(QUADRANTS), aspect: oneOf(QUADRANTS), combineWith: arrayOf(str) },
  },
  launch_torpedoes: { required: { shipId: str, weaponId: str, bearing: num } },
  launch_attack_craft: {
    required: { shipId: str, waves: arrayOf(shape({ roles: arrayOf(oneOf(CRAFT_ROLES)), cap: bool })), recall: arrayOf(str) },
  },
  end_step: { required: {} },
  move_ordnance: { required: { ordnanceId: str }, optional: { path: arrayOf(point), cap: str } },
  answer_brace: { required: { pendingId: str, attempt: bool } },
  repair: { required: { shipId: str, priority: arrayOf(str) } },
  remove_blast_markers: { required: { priority: arrayOf(str) } },
  board: { required: { targetId: str, together: bool, priority: arrayOf(str) } },
  teleport: { required: { shipId: str, targetId: str } },
};

/**
 * The path of the first malformed field, e.g. "path[2].degrees" ("$" for the
 * whole value), or null if the transform is well-formed.
 */
export function malformedField(value: unknown): string | null {
  const problem = firstProblem(value);
  return problem === null || problem === "$" ? problem : problem.replace(/^\$\./, "");
}

function firstProblem(value: unknown): string | null {
  if (!isObject(value)) return "$";
  const type = value.type;
  if (typeof type !== "string" || !Object.hasOwn(PAYLOADS, type)) return "$.type";
  if (value.player !== "p1" && value.player !== "p2") return "$.player";
  const spec = PAYLOADS[type as Transform["type"]];
  const optional = spec.optional ?? {};
  for (const key of Object.keys(value)) {
    if (key !== "type" && key !== "player" && !(key in spec.required) && !(key in optional)) return `$.${key}`;
  }
  for (const [key, check] of Object.entries(spec.required)) {
    const problem = check(value[key], `$.${key}`);
    if (problem !== null) return problem;
  }
  for (const [key, check] of Object.entries(optional)) {
    if (!(key in value)) continue;
    const problem = check(value[key], `$.${key}`);
    if (problem !== null) return problem;
  }
  return null;
}
