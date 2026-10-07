/**
 * A dumb but legal-move-seeking bot: every transform it would consider in a
 * state, best first. The caller plays the first one `validate` accepts.
 * Shared by the engine's full-game test and the server's fuzz test, and it
 * only ever *validates*, so it works on a redacted state too.
 */
import { actor, isWave, launchCapacity, onTable, partlyDeployedSquadron, planetaryDefence, squadronOf, weaponDisabled } from "../src/state/derived";
import { rolesCarried, waveSpeed } from "../src/rules/craft";
import { removableBlastMarkers } from "../src/reducer/steps";
import { baseRadius, distance, headingVector, quadrantsOfPoint, tableBearing } from "../src/geometry/basic";
import { alertCount, unitIds } from "../src/rules/surprise";
import { boardingsToFight } from "../src/rules/boarding";
import { deploymentDivisions, emptyDivisions, setupOptions } from "../src/rules/engagement";
import { canArrive, entryEdges } from "../src/rules/reserves";
import { exitDistance, walkShipPath } from "../src/geometry/path";
import { allAheadFullEnd, moveParameters, movingOrder } from "../src/rules/move";
import type { AttackCraftWave, CraftRole, GameState, PathStep, PlayerId, Point } from "../src/state/types";
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
  // Nowhere to go: a ship slowed to 0 cm (crippled, thrusters, Blast Markers) stays put
  [],
];
const ARCS = [undefined, "front", "left", "right", "rear"] as const;

const REROLLABLE = new Set(["declare_order", "fire", "move", "answer_brace"]);

/** Every transform the bot would consider now, best first; every other time, with a fleet commander re-roll asked for. */
export function candidates(s: GameState, n: number): Transform[] {
  const plain = baseCandidates(s, n);
  if (n % 2 === 1) return plain;
  return plain.flatMap((t) => (REROLLABLE.has(t.type) ? [{ ...t, reroll: true } as Transform, t] : [t]));
}

function baseCandidates(s: GameState, n: number): Transform[] {
  const who = actor(s);
  const top = s.pending[s.pending.length - 1];
  if (top !== undefined) return [{ type: "answer_brace", player: top.player, pendingId: top.id, attempt: n % 3 === 0 }];
  const { clock } = s;
  if (clock.stage === "setup") {
    const p: PlayerId = who === "p2" ? "p2" : "p1";
    switch (clock.setupStep) {
      case "choose_formation":
        return [{ type: "choose_formation", player: p, formation: (["sphere", "wedge", "cross"] as const)[(n + (p === "p2" ? 1 : 0)) % 3]! }];
      case "choose_setup":
        return setupOptions(s).map((o) => ({ type: "choose_setup", player: p, map: o.map, colour: o.colours[p] }));
      case "deploy": {
        // Any undeployed ship, spread along the zone so a fleet's bases don't overlap.
        // A part-deployed squadron goes first, next to its members (T80).
        const partial = partlyDeployedSquadron(s, p);
        const waiting = s.ships.filter((x) => x.owner === p && x.status === "undeployed" && (partial === undefined || partial.shipIds.includes(x.id)));
        const ship = waiting[n % 2 === 0 ? 0 : waiting.length - 1]!;
        const mates = (squadronOf(s, ship)?.shipIds ?? []).flatMap((id) => s.ships.find((x) => x.id === id && x.position !== null) ?? []);
        // Surprise Attack's defender gives a heading: broadside to the planet on standby, any way on alert.
        const planet = s.table.features?.[0];
        const headed = (position: Point): Transform => {
          const free = planetaryDefence(ship) || deploymentDivisions(s, p, ship).some((d) => d.heading === null);
          const heading = !free ? undefined : ship.standby === true && planet !== undefined ? (tableBearing(position, planet.position) + (n % 2 === 0 ? 90 : 270)) % 360 : (n * 45) % 360;
          return { type: "deploy_ship", player: p, shipId: ship.id, position, ...(heading === undefined ? {} : { heading }) };
        };
        const near: Transform[] = mates.flatMap((m) =>
          [[5, 0], [-5, 0], [10, 0], [-10, 0], [0, 5], [0, -5], [7, 7], [-7, 7], [7, -7], [-7, -7], [12, 0], [-12, 0]].map(([dx, dy]): Transform =>
            headed({ x: m.position!.x + dx!, y: m.position!.y + dy! }),
          ),
        );
        if (near.length > 0) return near;
        if (planetaryDefence(ship) && planet !== undefined) {
          // Planetary defences: rings inside the gravity well, off the template (state N93).
          const r0 = planet.diameter / 2;
          return [r0 + 3, r0 + planet.well / 2, r0 + planet.well - 2].flatMap((r) =>
            [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((k) => {
              const b = ((k * 30 + n * 11) % 360) * (Math.PI / 180);
              return headed({ x: planet.position.x + r * Math.sin(b), y: planet.position.y + r * Math.cos(b) });
            }),
          );
        }
        if (ship.standby === true && planet !== undefined) {
          // On standby: rings round the planet, the first within 15 cm of it.
          const r0 = planet.diameter / 2;
          return [r0 + 6, r0 + 12, r0 + 20, r0 + 30].flatMap((r) =>
            [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((k) => {
              const b = ((k * 30 + n * 7) % 360) * (Math.PI / 180);
              return headed({ x: planet.position.x + r * Math.sin(b), y: planet.position.y + r * Math.cos(b) });
            }),
          );
        }
        if (s.setup.engagement !== undefined || s.scenario.id === "the_bait" || s.scenario.id === "raiders" || s.scenario.id === "surprise_attack" || s.scenario.id === "blockade_run") {
          // Fleet Engagement and The Bait: empty divisions first, at spots across each one.
          const divisions = deploymentDivisions(s, p, ship);
          // A ship-specific list (Surprise Attack, Blockade Run) has no divisions to fill first.
          const empty = s.scenario.id === "blockade_run" || s.scenario.id === "surprise_attack" ? [] : emptyDivisions(s, p);
          const order = [...empty, ...divisions.map((_, i) => i).filter((i) => !empty.includes(i))];
          return order.flatMap((i) => {
            const { rect } = divisions[i]!;
            return [0.5, 0.2, 0.8, 0.35, 0.65, 0.1, 0.9].flatMap((fx) =>
              [0.5, 0.2, 0.8].map((fy): Transform => headed({ x: rect.x + rect.width * fx, y: rect.y + rect.height * fy })),
            );
          });
        }
        return [0, 1, 2, 3, 4, 5, 6].flatMap((k) =>
          [15, 30, 90, 105].map((y): Transform => ({ type: "deploy_ship", player: p, shipId: ship.id, position: { x: 50 + ((k * 13 + n) % 80), y } })),
        );
      }
      case "choose_facing":
        return [{ type: "choose_facing", player: p, heading: ([0, 90, 180, 270] as const)[n % 4]! }];
      case "choose_alert": {
        const units = unitIds(s, p);
        const k = n % units.length;
        return [{ type: "choose_alert", player: p, units: [...units.slice(k), ...units.slice(0, k)].slice(0, alertCount(s, p)) }];
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
    case "move_ships": {
      // Now and then, release CAP at the start of the phase.
      if (n % 3 === 0) {
        for (const o of s.ordnance) if (isWave(o) && o.owner === p && o.cap !== null) out.push({ type: "release_cap", player: p, ordnanceId: o.id });
      }
      // Reserves (The Bait): usually bring the next unit on before moving, now and then after, or leave it waiting.
      const arrivals = canArrive(s, p) ? arrivalCandidates(s, p, n) : [];
      if (n % 4 !== 3) out.push(...arrivals);
      for (const ship of mine.filter((x) => x.status === "active" && !s.turnState.ships[x.id]?.moved)) {
        if (s.activation === null && ship.specialOrder === null && !s.turnState.commandCheckFailed) {
          const { x, y } = ship.position!;
          const edge = Math.min(x, y, s.table.width - x, s.table.height - y);
          // Planetary defences only reload (state N95).
          const order = planetaryDefence(ship)
            ? ship.loaded.torpedoes === false ? "reload_ordnance" : null
            : edge < 30 ? (n % 2 ? "come_to_new_heading" : "burn_retros") : n % 5 === 0 ? "lock_on" : n % 11 === 0 && edge > 60 ? "all_ahead_full" : null;
          if (order !== null) out.push({ type: "declare_order", player: p, shipId: ship.id, order });
        }
        // Stay on the table and close to about 20 cm of the nearest enemy; a little noise to vary the games.
        const foe = [...enemies].sort((x, y) => distance(x.position!, ship.position!) - distance(y.position!, ship.position!))[0];
        const score = (path: PathStep[]) => {
          const walk = walkShipPath(ship, path);
          const off = exitDistance(walk, s.table) === null ? 0 : 1000;
          const gap = foe?.position ? Math.abs(distance(walk.end.position, foe.position) - 15) : 0;
          const broadside = foe?.position && quadrantsOfPoint(walk.end.position, walk.end.heading, foe.position).some((q) => q === "left" || q === "right") ? 0 : 10;
          return off + gap + broadside + ((n * 13 + path.length * 7 + walk.total) % 5);
        };
        const params = moveParameters(ship, movingOrder(s, ship));
        const aaf = params.order === "all_ahead_full" ? [[a(allAheadFullEnd(s, ship, params.d0).end)]] : [];
        // With boarding on, try first to end the move touching an enemy and board it.
        if (s.meta.options.boarding) {
          for (const e of enemies.filter((x) => x.status === "active" && x.grapple === null)) {
            for (const path of boardingPaths(ship, e)) {
              out.push({ type: "move", player: p, shipId: ship.id, path, disengage: false, boardTargetId: e.id });
            }
          }
        }
        const ranked = [...aaf, ...PATHS].sort((x, y) => score(x) - score(y));
        for (const path of ranked) out.push({ type: "move", player: p, shipId: ship.id, path, disengage: false });
        // A disengaging escort squadron's members must try to (state N41); so must the rest once its first mover asked.
        for (const path of ranked) out.push({ type: "move", player: p, shipId: ship.id, path, disengage: true });
      }
      if (n % 4 === 3) out.push(...arrivals);
      if (arrivals.length > 0) out.push({ type: "end_step", player: p });
      break;
    }
    case "direct_fire":
      for (const ship of mine.filter((x) => x.status === "active")) {
        // A nova cannon at each enemy's stem, or just short of it (the validator sorts out range, arc and orders).
        for (const w of ship.profile.weapons.filter((x) => x.kind === "nova_cannon" && !done(ship.id, x.id))) {
          for (const e of enemies) {
            for (const dy of [0, -3, 3]) {
              out.push({ type: "fire_nova_cannon", player: p, shipId: ship.id, weaponId: w.id, aim: { x: e.position!.x, y: e.position!.y + dy } });
            }
          }
        }
        for (const w of ship.profile.weapons.filter((x) => (x.kind === "battery" || x.kind === "lance") && !done(ship.id, x.id))) {
          if (weaponDisabled(s, ship, w)) continue;
          // Enemy attack craft first, now and then.
          if (n % 4 === 0) {
            for (const o of s.ordnance.filter((x) => x.owner !== p)) {
              for (const arc of ARCS) out.push({ type: "fire", player: p, shipId: ship.id, weaponId: w.id, target: { kind: "ordnance", id: o.id }, ...(arc === undefined ? {} : { arc }) });
            }
          }
          // A squadron volley first, now and then (T84): every squadron-mate's unfired weapon of this kind, at each target and aspect.
          const sq = squadronOf(s, ship);
          if (sq !== undefined && n % 2 === 0) {
            const mates = sq.shipIds.filter((id) => id !== ship.id).flatMap((id) => s.ships.find((x) => x.id === id && x.status === "active") ?? []);
            const withShips = mates
              .map((m) => ({ shipId: m.id, weaponIds: m.profile.weapons.filter((x) => x.kind === w.kind && !done(m.id, x.id) && !weaponDisabled(s, m, x)).map((x) => x.id) }))
              .filter((e) => e.weaponIds.length > 0);
            // Drop mates whose weapons can't reach: try the whole squadron, then each mate alone.
            const options = withShips.length > 0 ? [withShips, ...withShips.map((e) => [e])] : [];
            for (const e of enemies) {
              for (const ws of options) for (const targetAspect of [undefined, "closing", "abeam", "moving_away"] as const) {
                out.push({ type: "fire", player: p, shipId: ship.id, weaponId: w.id, target: { kind: "ship", id: e.id }, withShips: ws, ...(targetAspect === undefined ? {} : { targetAspect }) });
              }
            }
          }
          for (const e of enemies) {
            // Batteries: first with every other unfired battery that bears on this target, in one volley (T32), then alone.
            const bearing = quadrantsOfPoint(ship.position!, ship.heading!, e.position!);
            const others =
              w.kind === "battery"
                ? ship.profile.weapons
                    .filter((x) => x.kind === "battery" && x.id !== w.id && !done(ship.id, x.id) && !weaponDisabled(s, ship, x))
                    .filter((x) => x.arcs.some((q) => bearing.includes(q)) && distance(ship.position!, e.position!) <= (x.range ?? 0))
                    .map((x) => x.id)
                : [];
            const volleys = others.length > 0 && n % 3 !== 0 ? [others, undefined] : [undefined];
            for (const combineWith of volleys) for (const arc of ARCS) for (const aspect of ARCS) {
              out.push({
                type: "fire", player: p, shipId: ship.id, weaponId: w.id, target: { kind: "ship", id: e.id },
                ...(combineWith === undefined ? {} : { combineWith }),
                ...(arc === undefined ? {} : { arc }), ...(aspect === undefined ? {} : { aspect }),
              });
            }
          }
        }
      }
      out.push({ type: "end_step", player: p });
      break;
    case "launch_ordnance":
      for (const ship of mine.filter((x) => x.status === "active" && x.loaded.launchBays === true)) {
        const roles = rolesCarried(ship);
        const cap = launchCapacity(ship);
        const pick = (k: number): CraftRole[] => Array.from({ length: k }, (_, i) => roles[(n + i) % roles.length]!);
        const free = s.ordnance.filter((o) => isWave(o) && o.owner === p && o.cap === null).map((o) => o.id);
        for (let k = cap; k >= 1; k--) {
          const waves = n % 3 === 0 && k >= 2 ? [{ roles: pick(k - 1), cap: false }, { roles: ["fighter" as const], cap: true }] : [{ roles: pick(k), cap: false }];
          out.push({ type: "launch_attack_craft", player: p, shipId: ship.id, waves, recall: [] });
          out.push({ type: "launch_attack_craft", player: p, shipId: ship.id, waves, recall: free });
        }
      }
      for (const ship of mine.filter((x) => x.status === "active")) {
        for (const w of ship.profile.weapons.filter((x) => x.kind === "torpedoes" && !done(ship.id, x.id))) {
          out.push({ type: "launch_torpedoes", player: p, shipId: ship.id, weaponId: w.id, bearing: (n * 7) % 90 < 45 ? (n * 7) % 45 : 315 + ((n * 7) % 45) });
        }
      }
      out.push({ type: "end_step", player: p });
      break;
    case "active_ordnance":
    case "inactive_ordnance":
      for (const o of s.ordnance) {
        if (!isWave(o)) {
          out.push({ type: "move_ordnance", player: o.owner, ordnanceId: o.id });
          continue;
        }
        if (o.cap !== null && n % 4 !== 0) continue; // CAP usually stays
        const friend = s.ships.find((x) => x.owner === o.owner && x.status === "active" && x.position !== null);
        if (friend !== undefined && o.squadrons.every((q) => q.role === "fighter") && n % 5 === 0) {
          out.push({ type: "move_ordnance", player: o.owner, ordnanceId: o.id, path: [toward(s, o, friend.position!, 2)], cap: friend.id });
        }
        const foe = s.ships
          .filter((x) => x.owner !== o.owner && onTable(x))
          .sort((x, y) => distance(x.position!, o.position) - distance(y.position!, o.position))[0];
        if (foe !== undefined) out.push({ type: "move_ordnance", player: o.owner, ordnanceId: o.id, path: [toward(s, o, foe.position!, 0)] });
        out.push({ type: "move_ordnance", player: o.owner, ordnanceId: o.id, path: [] });
      }
      break;
    case "boarding":
      for (const g of boardingsToFight(s)) {
        out.push({ type: "board", player: p, targetId: g.targetId, together: n % 2 === 0, priority: g.shipIds });
      }
      for (const ship of mine.filter((x) => x.status === "active")) {
        for (const e of enemies.filter((x) => x.status === "active")) out.push({ type: "teleport", player: p, shipId: ship.id, targetId: e.id });
      }
      out.push({ type: "end_step", player: p });
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

/** A waypoint as far toward `target` as the wave flies, stopping `short` cm before it, kept on the table. */
/** One unit of reserves along the entry edges: stems a few centimetres apart, facing straight in. */
function arrivalCandidates(s: GameState, p: PlayerId, n: number): Transform[] {
  const waiting = s.ships.filter((x) => x.owner === p && x.status === "reserve");
  const first = waiting[n % waiting.length]!;
  const unit = squadronOf(s, first)?.shipIds ?? [first.id];
  const out: Transform[] = [];
  for (const edge of entryEdges(s, p)) {
    for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
      const along = { x: edge.to.x - edge.from.x, y: edge.to.y - edge.from.y };
      const len = Math.max(Math.abs(along.x), Math.abs(along.y));
      const placements = unit.map((shipId, k) => {
        const t = Math.min(1, Math.max(0, f + ((k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 7) / len));
        return { shipId, position: { x: edge.from.x + along.x * t, y: edge.from.y + along.y * t }, heading: edge.inward };
      });
      out.push({ type: "arrive", player: p, placements });
    }
  }
  return out;
}

function toward(s: GameState, wave: AttackCraftWave, target: Point, short: number): Point {
  const d = distance(wave.position, target);
  const go = Math.max(0, Math.min(waveSpeed(wave) - 0.01, d - short));
  const f = d === 0 ? 0 : go / d;
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  return {
    x: clamp(wave.position.x + f * (target.x - wave.position.x), s.table.width),
    y: clamp(wave.position.y + f * (target.y - wave.position.y), s.table.height),
  };
}

/**
 * Paths that end with the ship's base just overlapping the target's: straight
 * on, or after a 45° turn either way. The validator decides which are legal.
 */
function boardingPaths(ship: GameState["ships"][number], target: GameState["ships"][number]): PathStep[][] {
  const reach = baseRadius(ship.profile.baseSize) + baseRadius(target.profile.baseSize) - 0.2;
  const out: PathStep[][] = [];
  for (const prefix of [[], [a(10), turn(45)], [a(10), turn(-45)]] as PathStep[][]) {
    const end = walkShipPath(ship, prefix).end;
    const dir = headingVector(end.heading);
    const dx = target.position!.x - end.position.x;
    const dy = target.position!.y - end.position.y;
    const along = dx * dir.x + dy * dir.y;
    const lateral = Math.abs(dx * dir.y - dy * dir.x);
    if (lateral >= reach) continue;
    const d = Math.round((along - Math.sqrt(reach * reach - lateral * lateral)) * 100) / 100;
    if (d > 0.01) out.push([...prefix, a(d)]);
    else if (prefix.length === 0 && d > -0.01) out.push([]);
  }
  return out;
}
