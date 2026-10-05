/**
 * A dumb but legal-move-seeking bot: every transform it would consider in a
 * state, best first. The caller plays the first one `validate` accepts.
 * Shared by the engine's full-game test and the server's fuzz test, and it
 * only ever *validates*, so it works on a redacted state too.
 */
import { actor, onTable, weaponDisabled } from "../src/state/derived";
import { removableBlastMarkers } from "../src/reducer/steps";
import { distance, quadrantsOfPoint } from "../src/geometry/basic";
import { exitDistance, walkShipPath } from "../src/geometry/path";
import { allAheadFullEnd, moveParameters } from "../src/rules/move";
import type { GameState, PathStep, PlayerId } from "../src/state/types";
import type { Transform } from "../src/transforms/types";

const a = (distance: number): PathStep => ({ kind: "advance", distance });
const turn = (degrees: number): PathStep => ({ kind: "turn", degrees });

const PATHS: PathStep[][] = [
  [a(10), turn(45), a(10)], [a(10), turn(-45), a(10)], [a(20)], [a(15), turn(45), a(5)], [a(15), turn(-45), a(5)],
  [a(25)], [a(15)], [a(10)], [a(10), turn(45), a(2)], [a(10), turn(-45), a(2)], [a(5)], [a(2)], [a(30)], [a(40)],
  // Come to New Heading: two turns
  [a(10), turn(45), a(10), turn(45), a(2)], [a(10), turn(-45), a(10), turn(-45), a(2)],
  // Burn Retros: turn on the spot
  [turn(45), a(5)], [turn(-45), a(5)],
];
const ARCS = [undefined, "front", "left", "right", "rear"] as const;

/** Every transform the bot would consider now, best first. */
export function candidates(s: GameState, n: number): Transform[] {
  const who = actor(s);
  const top = s.pending[s.pending.length - 1];
  if (top !== undefined) return [{ type: "answer_brace", player: top.player, pendingId: top.id, attempt: n % 3 === 0 }];
  const { clock } = s;
  if (clock.stage === "setup") {
    const p: PlayerId = who === "p2" ? "p2" : "p1";
    switch (clock.setupStep) {
      case "deploy": {
        const ship = s.ships.find((x) => x.owner === p && x.status === "undeployed")!;
        return [15, 30, 90, 105].flatMap((y) => [{ type: "deploy_ship", player: p, shipId: ship.id, position: { x: 80 + (n % 20), y } }]);
      }
      case "choose_first_turn":
        return [{ type: "choose_first_turn", player: p, goFirst: n % 2 === 0 }];
      default:
        return [{ type: clock.setupStep as "roll_leadership", player: "p1" }];
    }
  }
  const p = who as PlayerId;
  const mine = s.ships.filter((x) => x.owner === p);
  const enemies = s.ships.filter((x) => x.owner !== p && onTable(x));
  const done = (id: string, w: string) => s.turnState.ships[id]?.weaponsFired.includes(w) ?? false;
  const out: Transform[] = [];
  switch (clock.step) {
    case "hulks_drift":
      for (const h of mine.filter((x) => (x.status === "drifting_hulk" || x.status === "blazing_hulk") && !s.turnState.ships[x.id]?.drifted)) {
        out.push({ type: "drift_hulk", player: p, shipId: h.id });
      }
      break;
    case "move_ships":
      for (const ship of mine.filter((x) => x.status === "active" && !s.turnState.ships[x.id]?.moved)) {
        if (s.activation === null && ship.specialOrder === null && !s.turnState.commandCheckFailed) {
          const { x, y } = ship.position!;
          const edge = Math.min(x, y, s.table.width - x, s.table.height - y);
          const order = edge < 30 ? (n % 2 ? "come_to_new_heading" : "burn_retros") : n % 5 === 0 ? "lock_on" : n % 11 === 0 && edge > 60 ? "all_ahead_full" : null;
          if (order !== null) out.push({ type: "declare_order", player: p, shipId: ship.id, order });
        }
        // Stay on the table and close to about 20 cm of the nearest enemy; a little noise to vary the games.
        const foe = enemies[0];
        const score = (path: PathStep[]) => {
          const walk = walkShipPath(ship, path);
          const off = exitDistance(walk, s.table) === null ? 0 : 1000;
          const gap = foe?.position ? Math.abs(distance(walk.end.position, foe.position) - 15) : 0;
          const broadside = foe?.position && quadrantsOfPoint(walk.end.position, walk.end.heading, foe.position).some((q) => q === "left" || q === "right") ? 0 : 10;
          return off + gap + broadside + ((n * 13 + path.length * 7 + walk.total) % 5);
        };
        const params = moveParameters(ship, s.activation?.shipId === ship.id ? s.activation : null);
        const aaf = params.order === "all_ahead_full" ? [[a(allAheadFullEnd(s, ship, params.d0).end)]] : [];
        const ranked = [...aaf, ...PATHS].sort((x, y) => score(x) - score(y));
        for (const path of ranked) out.push({ type: "move", player: p, shipId: ship.id, path, disengage: false });
      }
      break;
    case "direct_fire":
      for (const ship of mine.filter((x) => x.status === "active")) {
        for (const w of ship.profile.weapons.filter((x) => (x.kind === "battery" || x.kind === "lance") && !done(ship.id, x.id))) {
          if (weaponDisabled(s, ship, w)) continue;
          for (const e of enemies) for (const arc of ARCS) for (const aspect of ARCS) {
            out.push({
              type: "fire", player: p, shipId: ship.id, weaponId: w.id, target: { kind: "ship", id: e.id },
              ...(arc === undefined ? {} : { arc }), ...(aspect === undefined ? {} : { aspect }),
            });
          }
        }
      }
      out.push({ type: "end_step", player: p });
      break;
    case "launch_ordnance":
      for (const ship of mine.filter((x) => x.status === "active")) {
        for (const w of ship.profile.weapons.filter((x) => x.kind === "torpedoes" && !done(ship.id, x.id))) {
          out.push({ type: "launch_torpedoes", player: p, shipId: ship.id, weaponId: w.id, bearing: (n * 7) % 90 < 45 ? (n * 7) % 45 : 315 + ((n * 7) % 45) });
        }
      }
      out.push({ type: "end_step", player: p });
      break;
    case "active_ordnance":
    case "inactive_ordnance":
      for (const o of s.ordnance) out.push({ type: "move_ordnance", player: o.owner, ordnanceId: o.id });
      break;
    case "damage_control":
      for (const ship of s.ships.filter((x) => x.status === "active")) {
        out.push({ type: "repair", player: ship.owner, shipId: ship.id, priority: ship.criticals.filter((c) => c.kind !== "bridge_smashed" && c.kind !== "shields_collapse").map((c) => c.id) });
      }
      break;
    case "blast_marker_removal":
      out.push({ type: "remove_blast_markers", player: p, priority: removableBlastMarkers(s) });
      break;
    default:
      break;
  }
  return out;
}

