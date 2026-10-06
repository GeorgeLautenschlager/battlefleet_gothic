/**
 * Log entries as sentences. The engine's log (reducer spec §12) is data;
 * this is the only place that turns it into prose. Unknown kinds fall back
 * to their raw data, so a new engine log kind never breaks the feed.
 */
import type { GameState, JsonValue, LogEntry } from "@bfg/engine";

type Data = LogEntry["data"];

const words = (s: string): string => s.replaceAll("_", " ");
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const dice = (v: JsonValue | undefined): string => (Array.isArray(v) ? `[${v.join(" ")}]` : "");
const num = (v: JsonValue | undefined): string => (typeof v === "number" ? String(Math.round(v * 10) / 10) : "?");
const pass = (v: JsonValue | undefined): string => (v === true ? "passed" : "failed");

export function describe(state: GameState, entry: LogEntry): string {
  const d: Data = entry.data;
  const ship = (key: string): string => {
    const id = d[key];
    return state.ships.find((s) => s.id === id)?.name ?? String(id);
  };
  const names = (v: JsonValue | undefined): string => (Array.isArray(v) && v.length > 0 ? v.join(", ") : "none");
  /** A wave by id, while it's still on the table: "Fortitude's Fury, Starhawk". */
  const wave = (key: string): string => {
    const o = state.ordnance.find((x) => x.id === d[key]);
    if (o === undefined || o.kind !== "attack_craft") return "Attack craft";
    const from = state.ships.find((x) => x.id === o.launchedBy)?.name;
    return `${from ? `${from}'s ` : ""}${o.squadrons.map((q) => q.name).join(", ")}`;
  };
  const player = (key: string): string => {
    const p = d[key];
    return p === "p1" || p === "p2" ? state.players[p].name : "nobody";
  };

  switch (entry.kind) {
    case "leadership_roll":
      return `${ship("shipId")} rolls ${dice(d["rolls"])} for Leadership: Ld ${num(d["leadership"])}`;
    case "zone_roll":
      return `Zones rolled ${dice(d["rolls"])}`;
    case "formation": {
      const f = d["formations"] as { p1?: string; p2?: string } | undefined;
      return f === undefined
        ? `${player("player")} picks a formation`
        : `Formations revealed: ${state.players.p1.name} ${String(f.p1)}, ${state.players.p2.name} ${String(f.p2)}`;
    }
    case "setup_roll": {
      const r = d["rolls"] as number[] | undefined;
      const b = d["bonus"] as number[] | undefined;
      const side = (i: 0 | 1) => `${num(r?.[i])}${(b?.[i] ?? 0) > 0 ? `+${num(b?.[i])}` : ""}`;
      return `Set-up roll-off [${side(0)} ${side(1)}]: ${d["winner"] === null ? "a tie, roll again" : `${player("winner")} picks the set-up`}`;
    }
    case "setup_choice": {
      const c = d["colours"] as { p1?: string; p2?: string } | undefined;
      const colour = (v: string | undefined) => (v === "dark" ? "dark grey" : String(v));
      return `${player("player")} picks map ${String(d["map"])}: ${state.players.p1.name} ${colour(c?.p1)}, ${state.players.p2.name} ${colour(c?.p2)}`;
    }
    case "deploy_order_roll":
      return `Deployment roll-off ${dice(d["rolls"])}: ${d["winner"] === null ? "a tie, roll again" : `${player("winner")} deploys first`}`;
    case "first_turn_roll":
      return `First-turn roll-off ${dice(d["rolls"])}: ${d["winner"] === null ? "a tie, roll again" : `${player("winner")} chooses`}`;
    case "deploy":
      return `${ship("shipId")} deploys at (${num((d["position"] as { x: number })?.x)}, ${num((d["position"] as { y: number })?.y)})`;
    case "first_turn_choice":
      return `${player("firstPlayer")} will go first`;
    case "battle_start":
      return "Battle begins";
    case "turn_start":
      return `Round ${num(d["round"])}: ${player("player")}'s turn`;
    case "step":
      return d["step"] === undefined ? cap(words(String(d["setupStep"]))) : `${cap(words(String(d["phase"])))} phase: ${words(String(d["step"]))}`;
    case "end_step":
      return `Ends ${words(String(d["step"]))}`;
    case "order_expired":
      return `${ship("shipId")}'s ${words(String(d["order"]))} expires`;
    case "command_check":
      return `${ship("shipId")} ${words(String(d["order"]))}: Command check ${dice(d["rolls"])} vs ${num(d["target"])}, ${pass(d["passed"])}`;
    case "ram_test":
    case "priority_test":
    case "disengage_test":
      return `${ship("shipId")} ${words(entry.kind.replace("_test", ""))} test ${dice(d["rolls"])} vs ${num(d["target"])}, ${pass(d["passed"])}`;
    case "aaf_roll":
      return `${ship("shipId")} All Ahead Full: ${dice(d["rolls"])} +${num(d["extra"])} cm`;
    case "move":
      return `${ship("shipId")} moves ${num(d["distance"])} cm${d["truncated"] === true ? " (cut short)" : ""}`;
    case "blast_marker_contact":
      return `${ship("shipId")} hits a Blast Marker: max ${num(d["maxDistance"])} cm`;
    case "ram":
      return `${ship("rammerId")} rams ${ship("targetId")}${d["headOn"] === true ? " head-on" : ""}: ${num(d["rammerHits"])} hits dealt, ${num(d["targetHits"])} taken`;
    case "attack": {
      const src = d["source"] as { id?: string } | undefined;
      const from = state.ships.find((s) => s.id === src?.id)?.name ?? words(String(d["weapon"]));
      const what = Array.isArray(d["weaponIds"]) ? `${d["weaponIds"].length} batteries (firepower ${num(d["firepower"])})` : words(String(d["weapon"]));
      return `${from} ${what} at ${ship("targetId")}: ${dice(d["rolls"])} need ${num(d["need"])}+, ${num(d["hits"])} hit${d["hits"] === 1 ? "" : "s"}`;
    }
    case "nova_cannon": {
      const scatter = d["scatter"] as { bearing?: number; distance?: number } | "hit" | undefined;
      const where = scatter === "hit" ? "on target" : `scatters ${num(scatter?.distance)} cm on ${num(scatter?.bearing)}°`;
      const hits = Array.isArray(d["ships"])
        ? (d["ships"] as { shipId?: string; hole?: boolean; hits?: number }[]).map(
            (h) => `${state.ships.find((x) => x.id === h.shipId)?.name ?? String(h.shipId)} ${num(h.hits)} hit${h.hits === 1 ? "" : "s"}${h.hole === true ? " (centre)" : ""}`,
          )
        : [];
      const removed = Array.isArray(d["ordnanceIds"]) ? d["ordnanceIds"].length : 0;
      const outcome = [...hits, ...(removed > 0 ? [`${removed} ordnance destroyed`] : [])];
      const miss = typeof d["blastMarkerId"] === "string" ? "touches nothing: a Blast Marker" : "touches nothing, off the table";
      return `${ship("shipId")} fires its nova cannon at ${num(d["range"])} cm ${dice(d["rolls"])}: ${where}, ${outcome.length > 0 ? outcome.join(", ") : miss}`;
    }
    case "shields":
      return `${ship("shipId")}'s shields absorb ${num(d["absorbed"])}`;
    case "brace_offer":
      return `${ship("shipId")} may brace for impact`;
    case "brace_check":
      return d["declined"] === true ? `${ship("shipId")} doesn't brace` : `${ship("shipId")} braces ${dice(d["rolls"])} vs ${num(d["target"])}, ${pass(d["passed"])}`;
    case "brace_saves":
      return `${ship("shipId")} brace saves ${dice(d["rolls"])}: ${num(d["saved"])} saved`;
    case "damage":
      return `${ship("shipId")} takes 1 damage (${words(String(d["cause"]))}), ${num(d["damageAfter"])} total`;
    case "critical":
      return `${ship("shipId")} critical ${dice(d["rolls"])}: ${words(String(d["kind"]))}`;
    case "catastrophic":
      return `${ship("shipId")} catastrophic damage ${dice(d["rolls"])}: ${words(String(d["outcome"]))}`;
    case "turrets": {
      const massed = Array.isArray(d["massed"]) ? d["massed"].length : 0;
      const what = d["against"] === "attack_craft" ? (d["stopped"] === 1 ? "squadron" : "squadrons") : "torpedoes";
      return `${ship("shipId")} turrets${massed > 0 ? ` (+${massed} massed)` : ""} ${dice(d["rolls"])}: ${num(d["stopped"])} ${what} stopped`;
    }
    case "bm_test":
      return `Blast Marker test ${dice(d["rolls"])}: ${words(String(d["effect"]))}`;
    case "ordnance_launch":
      return `${ship("shipId")} launches ${num(d["strength"])} torpedoes`;
    case "ordnance_move":
      return "Torpedoes move";
    case "ordnance_removed":
      return `Ordnance removed (${words(String(d["reason"]))})`;
    case "craft_launch": {
      const n = Array.isArray(d["ordnanceIds"]) ? d["ordnanceIds"].length : 0;
      const recalled = Array.isArray(d["recalled"]) ? d["recalled"].length : 0;
      return `${ship("shipId")} launches attack craft (${n} wave${n === 1 ? "" : "s"})${recalled > 0 ? `, recalling ${recalled}` : ""}`;
    }
    case "craft_move":
      return `${wave("ordnanceId")} ${d["stoppedBy"] === null ? "fly" : `fly into ${ship("stoppedBy")}`}`;
    case "intercept":
      return `${names(d["lost"])} intercepts torpedoes: the salvo is destroyed`;
    case "dogfight": {
      const lost = Array.isArray(d["lost"]) ? d["lost"] : [];
      return `Dogfight: ${names(lost[0])} lost against ${names(lost[1])}`;
    }
    case "cap_formed": {
      const n = Array.isArray(d["ordnanceIds"]) ? d["ordnanceIds"].length : 0;
      return `${n} fighter${n === 1 ? "" : "s"} fly CAP over ${ship("shipId")}`;
    }
    case "cap_released":
      return d["reason"] === "ship_lost"
        ? `${ship("shipId")} is gone: its CAP fighters fly on alone`
        : `Fighters leave CAP over ${ship("shipId")}`;
    case "cap_screen":
      return `CAP over ${ship("shipId")} intercepts torpedoes: one fighter and the salvo are lost`;
    case "craft_meets_ship":
      return `Fighters reach ${ship("targetId")}, but fighters alone do no harm`;
    case "craft_attack": {
      const bombers = typeof d["bombers"] === "number" ? d["bombers"] : 0;
      const boats = typeof d["boats"] === "number" ? d["boats"] : 0;
      const parts = [];
      if (bombers > 0) {
        parts.push(
          `${bombers} bomber${bombers === 1 ? "" : "s"} ${dice(d["bomberRolls"])} − ${num(d["own"])} turrets${num(d["escorts"]) !== "0" ? `, +${Math.min(Number(d["escorts"]), bombers)} escorts` : ""}: ${num(d["attacks"])} attacks ${dice(d["attackRolls"])} need ${num(d["need"])}+, ${num(d["hits"])} hit${d["hits"] === 1 ? "" : "s"}`,
        );
      }
      if (boats > 0) parts.push(`${boats} assault boat${boats === 1 ? "" : "s"} go${boats === 1 ? "es" : ""} in`);
      return `Attack craft strike ${ship("targetId")}: ${parts.join("; ") || "nothing left to attack"}`;
    }
    case "hit_and_run":
      return `Assault boats hit ${ship("targetId")} ${dice(d["rolls"])}: ${
        d["result"] === "failed" ? "beaten off" : d["result"] === "saved" ? `braced, saved ${dice(d["saveRolls"])}` : "critical hit"
      }`;
    case "hulk_drift":
      return `${ship("shipId")} drifts ${dice(d["rolls"])} ${num(d["distance"])} cm`;
    case "hulk_lost":
      return `${ship("shipId")} drifts off the table`;
    case "disengaged":
      return `${ship("shipId")} disengages${d["reason"] === "table_edge" ? " off the table edge" : ""}`;
    case "repair":
      return `${ship("shipId")} repairs ${dice(d["rolls"])}: ${Array.isArray(d["repaired"]) ? d["repaired"].length : 0} fixed`;
    case "fire_damage":
      return `${ship("shipId")} burns (${num(d["fires"])} fire${d["fires"] === 1 ? "" : "s"})`;
    case "bm_removal":
      return `Blast Marker removal ${dice(d["rolls"])}: ${Array.isArray(d["removed"]) ? d["removed"].length : 0} removed`;
    case "game_end": {
      const scores = d["scores"] as { p1?: number; p2?: number } | undefined;
      const vp = d["scoring"] === "victory_points" ? " victory points" : "";
      return `Game over (${words(String(d["reason"]))}): ${d["winner"] === null ? "a draw" : `${player("winner")} wins`}, ${num(scores?.p1)}–${num(scores?.p2)}${vp}`;
    }
    case "boarding_declared":
      return `${ship("shipId")} closes to board ${ship("targetId")}`;
    case "boarding_lapsed":
      return `${ship("shipId")} can't board ${ship("targetId")} after all (${words(String(d["reason"]))})`;
    case "boarding": {
      const attackers = Array.isArray(d["attackerIds"]) ? d["attackerIds"].map((id) => state.ships.find((s) => s.id === id)?.name ?? String(id)).join(" and ") : "?";
      const several = Array.isArray(d["attackerIds"]) && d["attackerIds"].length > 1;
      const totals = d["totals"] as { attackers?: number; defender?: number } | undefined;
      const outcome =
        d["loser"] === null
          ? "a draw: the ships grapple"
          : `${words(String(d["result"]))}, ${d["loser"] === "defender" ? ship("defenderId") : attackers} take${d["loser"] === "attackers" && several ? "" : "s"} ${num(d["damage"])} damage`;
      return `${attackers} board${several ? "" : "s"} ${ship("defenderId")}: ${dice(d["rolls"])} → ${num(totals?.attackers)} vs ${num(totals?.defender)}, ${outcome}`;
    }
    case "boarding_critical":
      return d["need"] === "auto"
        ? `${ship("shipId")} suffers a critical from the boarding action`
        : `${ship("shipId")} boarding critical check ${dice(d["rolls"])} need ${num(d["need"])}+: ${d["critical"] === true ? "critical" : "none"}`;
    case "boarded_hulk":
      return `${ship("shipId")} is overrun: a drifting hulk`;
    case "grapple":
      return `${ship("defenderId")} is locked in a grapple`;
    case "grapple_ended":
      return `The grapple around ${ship("defenderId")} ends`;
    case "grappled":
      return `${ship("shipId")} is grappled and can't move`;
    case "teleport":
      return `${ship("shipId")} teleports onto ${ship("targetId")} ${dice(d["rolls"])}: ${
        d["result"] === "failed" ? "the attack fails" : d["result"] === "saved" ? `braced, saved ${dice(d["saveRolls"])}` : "critical hit"
      }`;
    case "skipped":
      return `(${words(String(d["item"]))} skipped)`;
    default:
      return `${words(entry.kind)} ${JSON.stringify(d)}`;
  }
}
