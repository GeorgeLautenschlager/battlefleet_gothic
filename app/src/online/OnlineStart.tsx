import { useState } from "react";
import { carriersAllowed, defaultNames, listsOn, MAX_SHIPS, pursuedOf, roleOf, shipEntries, sideProblem, type Side } from "../game/config";
import { BattleFields, CountSelect, duplicates, DuplicateNames, FleetFields, FleetProblem, PlanetField, resize, RulesChecks, type Battle, type Rules } from "../panels/FleetForm";
import type { PlanetSize } from "@bfg/engine";
import { createGame } from "./api";
import type { MyGame } from "./myGames";

/** New online game: you're Player 1 and set the size of the battle; your opponent joins with a link and brings their own fleet. */
export function OnlineStart({ onCreated }: { onCreated: (game: MyGame) => void }) {
  const [side, setSide] = useState<Side>({ name: "Player 1", fleet: "imperial_navy", ships: defaultNames("imperial_navy", 1) });
  const [rules, setRules] = useState<Rules>({ ramming: true, boarding: true, carriers: false, fleetLists: true });
  const [battle, setBattle] = useState<Battle>({});
  const [planet, setPlanet] = useState<PlanetSize | undefined>(undefined);
  const points = battle.forces?.kind === "points" ? battle.forces.limit : null;
  const carriers = carriersAllowed({ carriers: rules.carriers, ...battle });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dupes = duplicates(side.ships);
  const lists = listsOn({ fleetLists: rules.fleetLists === true, ...battle });
  // The Bait and The Raiders: you're Player 1, attacking or defending (T93, T100).
  const role = roleOf(battle.scenario, battle.attacker, "p1");
  const reinforcements = pursuedOf(battle) === "p1";
  const problem = dupes.length > 0 ? null : sideProblem(side, carriers, battle.forces, lists, role);
  return (
    <form
      className="new-game"
      onSubmit={(e) => {
        e.preventDefault();
        if (dupes.length > 0 || problem !== null) return;
        setBusy(true);
        setError(null);
        const name = side.name.trim();
        createGame({ name, side: "p1", faction: side.fleet, ships: shipEntries(side, carriers, battle.forces?.kind === "points", lists, reinforcements), ...rules, fleetLists: lists, ...battle, ...(planet !== undefined && battle.scenario !== "surprise_attack" ? { planet } : {}) })
          .then((g) => onCreated({ gameId: g.gameId, token: g.token, seat: g.seat, name, joinedAt: new Date().toISOString(), inviteToken: g.inviteToken }))
          .catch((err: unknown) => setError((err as Error).message))
          .finally(() => setBusy(false));
      }}
    >
      <h2>Online</h2>
      <p className="muted">Play a friend on another device. You'll get a link to send them; they pick their own fleet.</p>
      <BattleFields
        players={{ p1: "You", p2: "Your opponent" }}
        value={battle}
        onChange={(patch) => {
          setBattle(patch);
          // Back to Cruiser Clash: at most four.
          if (patch.forces?.kind !== "points" && side.ships.length > MAX_SHIPS) setSide({ ...side, ships: side.ships.slice(0, MAX_SHIPS) });
        }}
      />
      {battle.scenario !== "surprise_attack" && <PlanetField value={planet} onChange={setPlanet} />}
      {points === null && <CountSelect value={side.ships.length} onChange={(n) => setSide({ ...side, ships: resize(side.ships, side.fleet, n) })} />}
      <FleetFields
        legend="You"
        className="p1"
        side={side}
        onChange={(patch) =>
          setSide({ ...side, ...patch, ...(patch.fleet !== undefined && patch.fleet !== side.fleet ? { ships: defaultNames(patch.fleet, side.ships.length), classes: [], options: [], command: undefined } : {}) })
        }
        dupes={dupes}
        carriers={carriers}
        pointsLimit={points}
        lists={lists}
        reinforcements={reinforcements}
      />
      <RulesChecks value={rules} onChange={setRules} points={points !== null} />
      <DuplicateNames dupes={dupes} />
      <FleetProblem problem={problem} />
      <div className="buttons">
        <button type="submit" className="primary" disabled={busy || dupes.length > 0 || problem !== null}>
          {busy ? "Creating…" : "Create game"}
        </button>
      </div>
      {error && <p className="rejection">{error}</p>}
    </form>
  );
}
