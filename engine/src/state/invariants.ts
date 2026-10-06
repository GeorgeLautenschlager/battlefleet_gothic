/**
 * State invariants (state spec §13), plus the structural consistency the rest
 * of the spec implies. `checkInvariants` never throws: it returns every
 * violation it finds, so tests and debugging tools can show them all at once.
 */
import { EPS } from "../geometry/constants";
import { activePlayer, isHulk, onTable } from "./derived";
import { nonJsonPaths } from "./json";
import type { GameState, Phase, Step } from "./types";

export type Violation = {
  /** "I1"…"I14" for the numbered invariants in §13; "J" plain JSON; "C" consistency. */
  rule: string;
  message: string;
};

const STEPS_BY_PHASE: Record<Phase, readonly Step[]> = {
  movement: ["hulks_drift", "move_ships"],
  shooting: ["direct_fire", "launch_ordnance"],
  ordnance: ["active_ordnance", "inactive_ordnance"],
  end: ["boarding", "damage_control", "blast_marker_removal"],
};

const ID_PATTERN = /^([a-z]+)-([1-9][0-9]*)$/;

export function checkInvariants(state: GameState): Violation[] {
  const out: Violation[] = [];
  const fail = (rule: string, message: string) => out.push({ rule, message });

  // J: plain JSON (§1, principle 1)
  for (const path of nonJsonPaths(state)) fail("J", `not plain JSON at ${path}`);

  // I1: ids unique, <kind>-<n> with n < nextId
  const ids = [
    ...state.ships.map((s) => s.id),
    ...state.ships.flatMap((s) => s.criticals.map((c) => c.id)),
    ...state.blastMarkers.map((b) => b.id),
    ...state.ordnance.map((o) => o.id),
    ...state.pending.map((p) => p.id),
    ...state.log.map((l) => l.id),
  ];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) fail("I1", `duplicate id ${id}`);
    seen.add(id);
    const match = ID_PATTERN.exec(id);
    if (match === null) fail("I1", `malformed id ${id}`);
    else if (Number(match[2]) >= state.nextId) fail("I1", `id ${id} is not below nextId ${state.nextId}`);
  }

  const { clock, table } = state;

  for (const ship of state.ships) {
    const at = `${ship.id} (${ship.name})`;

    // I2: damage range, and damage = hits ⇔ hulk or destroyed
    if (!Number.isInteger(ship.damage) || ship.damage < 0 || ship.damage > ship.profile.hits) {
      fail("I2", `${at}: damage ${ship.damage} outside 0..${ship.profile.hits}`);
    }
    const wrecked = isHulk(ship) || ship.status === "destroyed";
    if ((ship.damage === ship.profile.hits) !== wrecked) {
      fail("I2", `${at}: damage ${ship.damage}/${ship.profile.hits} doesn't match status ${ship.status}`);
    }

    // I3: position/heading ⇔ on the table; stems inside the table
    const placed = ship.position !== null && ship.heading !== null;
    const partly = (ship.position === null) !== (ship.heading === null);
    if (partly || placed !== onTable(ship)) {
      fail("I3", `${at}: position/heading don't match status ${ship.status}`);
    }
    if (ship.position !== null) {
      const { x, y } = ship.position;
      if (x < -EPS || x > table.width + EPS || y < -EPS || y > table.height + EPS) {
        fail("I3", `${at}: stem (${x}, ${y}) is off the table`);
      }
    }
    if (ship.heading !== null && (ship.heading < 0 || ship.heading >= 360)) {
      fail("I3", `${at}: heading ${ship.heading} not in [0, 360)`);
    }

    // I4: only active ships carry special orders
    if (ship.specialOrder !== null && ship.status !== "active") {
      fail("I4", `${at}: ${ship.status} ship has a special order`);
    }

    // I8: no repeated unrepairable criticals
    for (const kind of ["bridge_smashed", "shields_collapse"] as const) {
      if (ship.criticals.filter((c) => c.kind === kind).length > 1) fail("I8", `${at}: ${kind} twice`);
    }

    // C: every ship has a turnState entry; Leadership rolled once battle starts
    if (state.turnState.ships[ship.id] === undefined) fail("C", `${at}: no turnState entry`);
    if (clock.stage !== "setup" && ship.leadership === null) fail("C", `${at}: Leadership not rolled`);
  }

  // I5: activation only while moving ships, for an unmoved ship of the active player
  const activation = state.activation;
  if (activation !== null) {
    if (clock.stage !== "battle" || clock.phase !== "movement" || clock.step !== "move_ships") {
      fail("I5", "activation open outside movement / move_ships");
    }
    const ship = state.ships.find((s) => s.id === activation.shipId);
    if (ship === undefined) {
      fail("I5", `activation for unknown ship ${activation.shipId}`);
    } else {
      if (state.setup.firstPlayer !== null && ship.owner !== activePlayer(state)) {
        fail("I5", `activation for ${ship.id}, which isn't the active player's`);
      }
      if (state.turnState.ships[ship.id]?.moved !== false) {
        fail("I5", `activation for ${ship.id}, which has already moved`);
      }
    }
    if (activation.stage === "moving") {
      if (state.pending.length === 0) fail("I5", "move in progress but nothing pending");
      if (!state.queue.some((w) => w.kind === "continue_move")) fail("I5", "move in progress with no continue_move queued");
    }
  }

  // I6, I7: queue waits only on a pending decision; decisions only in battle
  if (state.queue.length > 0 && state.pending.length === 0) fail("I6", "work queued with nothing pending");
  if (state.pending.length > 0 && clock.stage !== "battle") fail("I7", `pending decision during ${clock.stage}`);

  // I9: live torpedo salvoes have strength
  for (const salvo of state.ordnance) {
    if (salvo.kind === "torpedo_salvo" && salvo.strength < 1) fail("I9", `${salvo.id}: strength ${salvo.strength}`);
  }

  // I13: attack craft are consistent
  for (const wave of state.ordnance) {
    if (wave.kind !== "attack_craft") continue;
    if (wave.squadrons.length === 0) fail("I13", `${wave.id} has no squadrons`);
    if (wave.cap === null) continue;
    const ship = state.ships.find((s) => s.id === wave.cap);
    if (wave.squadrons.length !== 1 || wave.squadrons[0]?.role !== "fighter") fail("I13", `${wave.id} is on CAP but isn't a single fighter`);
    if (ship === undefined || ship.owner !== wave.owner || ship.status !== "active") {
      fail("I13", `${wave.id} flies CAP for ${wave.cap}, which isn't an active friendly ship`);
    } else if (ship.position === null || Math.abs(ship.position.x - wave.position.x) > EPS || Math.abs(ship.position.y - wave.position.y) > EPS) {
      fail("I13", `${wave.id} isn't at ${ship.id}'s stem`);
    }
  }

  // I14: the scenario's blocks match its id
  const engagement = state.scenario.id === "fleet_engagement";
  if (engagement !== (state.setup.engagement !== undefined)) fail("I14", `setup.engagement doesn't match scenario ${state.scenario.id}`);
  if (engagement === (state.scenario.deploymentZones !== undefined)) fail("I14", `deploymentZones don't match scenario ${state.scenario.id}`);
  if (state.scenario.maxRounds !== (engagement ? null : 8)) fail("I14", `maxRounds ${state.scenario.maxRounds} for ${state.scenario.id}`);

  // I10: turnState belongs to this player turn
  if (state.turnState.playerTurn !== clock.playerTurn) {
    fail("I10", `turnState is for player turn ${state.turnState.playerTurn}, clock says ${clock.playerTurn}`);
  }

  // I11: ended ⇔ result
  if ((clock.stage === "ended") !== (state.result !== null)) fail("I11", `stage ${clock.stage} with result ${state.result === null ? "unset" : "set"}`);

  // I12: grapples are consistent
  const shipsById = new Map(state.ships.map((sh) => [sh.id, sh]));
  const grappledIn = new Map<string, string>();
  for (const ship of state.ships) {
    const g = ship.grapple;
    if (g === null) continue;
    if (ship.status !== "active") fail("I12", `${ship.id} is ${ship.status} but grappled`);
    if (g.attackerIds.length === 0 || g.attackerIds.includes(g.defenderId)) fail("I12", `${ship.id} has a malformed grapple`);
    const key = JSON.stringify(g);
    for (const id of [g.defenderId, ...g.attackerIds]) {
      const member = shipsById.get(id);
      if (member === undefined || member.status !== "active") fail("I12", `${ship.id}'s grapple names ${id}, which isn't active`);
      else if (JSON.stringify(member.grapple) !== key) fail("I12", `${id} and ${ship.id} disagree about their grapple`);
      const seen = grappledIn.get(id);
      if (seen !== undefined && seen !== key) fail("I12", `${id} is in two grapples`);
      grappledIn.set(id, key);
    }
    const defender = shipsById.get(g.defenderId);
    if (defender !== undefined && g.attackerIds.some((id) => shipsById.get(id)?.owner === defender.owner)) {
      fail("I12", `${ship.id}'s grapple has the defender's own ship as an attacker`);
    }
  }

  // C: clock shape
  if (clock.stage === "setup") {
    if (clock.setupStep === null) fail("C", "setup without a setupStep");
    if (clock.playerTurn !== 0) fail("C", `playerTurn ${clock.playerTurn} during setup`);
    if (clock.phase !== null || clock.step !== null) fail("C", "phase/step set during setup");
  } else {
    if (clock.setupStep !== null) fail("C", `setupStep set during ${clock.stage}`);
    if (state.setup.firstPlayer === null) fail("C", `${clock.stage} without a first player`);
    const maxTurns = state.scenario.maxRounds === null ? Infinity : 2 * state.scenario.maxRounds;
    if (!Number.isInteger(clock.playerTurn) || clock.playerTurn < 1 || clock.playerTurn > maxTurns) {
      fail("C", `playerTurn ${clock.playerTurn} outside 1..${maxTurns}`);
    }
  }
  if (clock.stage === "battle") {
    if (clock.phase === null || clock.step === null) fail("C", "battle without phase/step");
    else if (!STEPS_BY_PHASE[clock.phase].includes(clock.step)) fail("C", `step ${clock.step} isn't in phase ${clock.phase}`);
  }

  // C: rng
  const { rng } = state;
  for (const [name, value] of [["seed", rng.seed], ["state", rng.state]] as const) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) fail("C", `rng.${name} ${value} is not a uint32`);
  }

  return out;
}
