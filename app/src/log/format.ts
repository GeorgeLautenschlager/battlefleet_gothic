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
  const player = (key: string): string => {
    const p = d[key];
    return p === "p1" || p === "p2" ? state.players[p].name : "nobody";
  };

  switch (entry.kind) {
    case "leadership_roll":
      return `${ship("shipId")} rolls ${dice(d["rolls"])} for Leadership: Ld ${num(d["leadership"])}`;
    case "zone_roll":
      return `Zones rolled ${dice(d["rolls"])}`;
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
      return `${from} ${words(String(d["weapon"]))} at ${ship("targetId")}: ${dice(d["rolls"])} need ${num(d["need"])}+, ${num(d["hits"])} hit${d["hits"] === 1 ? "" : "s"}`;
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
    case "turrets":
      return `${ship("shipId")} turrets ${dice(d["rolls"])}: ${num(d["stopped"])} torpedoes stopped`;
    case "bm_test":
      return `Blast Marker test ${dice(d["rolls"])}: ${words(String(d["effect"]))}`;
    case "ordnance_launch":
      return `${ship("shipId")} launches ${num(d["strength"])} torpedoes`;
    case "ordnance_move":
      return "Torpedoes move";
    case "ordnance_removed":
      return `Torpedo salvo removed (${words(String(d["reason"]))})`;
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
    case "game_end":
      return `Game over (${words(String(d["reason"]))}): ${d["winner"] === null ? "a draw" : `${player("winner")} wins`}`;
    case "skipped":
      return `(${words(String(d["item"]))} skipped)`;
    default:
      return `${words(entry.kind)} ${JSON.stringify(d)}`;
  }
}
