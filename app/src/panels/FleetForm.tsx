/** Pieces of the fleet forms: hot-seat New game, Online, and the online lobby's join. */
import { CATALOGUE } from "@bfg/engine";
import { classChoices, classIds, defaultNames, FLEETS, MAX_POINTS_SHIPS, MAX_SHIPS, optionIds, POINTS_LIMITS, profileOf, shipProfileOf, type Fleet, type NewGameOptions, type Side } from "../game/config";

/** Every name used more than once (names are how the log and the cards tell ships apart). */
export function duplicates(names: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const name of names.map((s) => s.trim())) {
    if (seen.has(name)) dupes.add(name);
    seen.add(name);
  }
  return [...dupes];
}

/**
 * `ships` resized to `n`: names already typed stay; new ships get default
 * names for `fleet` that aren't in `taken` (or already in the list).
 */
export function resize(ships: string[], fleet: Fleet, n: number, taken: string[] = []): string[] {
  const used = new Set([...taken, ...ships]);
  const spare = [...defaultNames(fleet, MAX_SHIPS), ...defaultNames(fleet, MAX_SHIPS, true)].filter((s) => !used.has(s));
  const out = ships.slice(0, n);
  while (out.length < n) out.push(spare.shift() ?? `Ship ${out.length + 1}`);
  return out;
}

export function CountSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <label>
      Cruisers a side
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {Array.from({ length: MAX_SHIPS }, (_, i) => (
          <option key={i + 1} value={i + 1}>
            {i + 1}
          </option>
        ))}
      </select>
    </label>
  );
}

export type Rules = { ramming: boolean; boarding: boolean; carriers: boolean };

export type Battle = Pick<NewGameOptions, "scenario" | "forces" | "scoring">;

/**
 * The scenario (T49): Cruiser Clash, classic or by points (p. 129), with its
 * scoring (T37); or Fleet Engagement at a points limit, always victory points (pp. 142–143).
 */
export function BattleFields({ value, onChange }: { value: Battle; onChange: (patch: Battle) => void }) {
  const limit = value.forces?.kind === "points" ? value.forces.limit : null;
  const engagement = value.scenario === "fleet_engagement";
  const scenario = (
    <label>
      Scenario
      <select
        value={value.scenario ?? "cruiser_clash"}
        onChange={(e) =>
          onChange(
            e.target.value === "fleet_engagement"
              ? { scenario: "fleet_engagement", forces: { kind: "points", limit: limit ?? 750 }, scoring: "victory_points" }
              : { scenario: "cruiser_clash", forces: { kind: "cruiser_clash" }, scoring: "cruiser_clash" },
          )
        }
      >
        <option value="cruiser_clash">Cruiser Clash (p. 128)</option>
        <option value="fleet_engagement">Fleet Engagement (pp. 142–143)</option>
      </select>
    </label>
  );
  if (engagement) {
    return (
      <div className="battle-fields">
        {scenario}
        <label>
          Points a side
          <select value={String(limit ?? 750)} onChange={(e) => onChange({ ...value, forces: { kind: "points", limit: Number(e.target.value) } })}>
            {POINTS_LIMITS.map((p) => (
              <option key={p} value={p}>
                {p} points
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">Formations and set-up maps, victory points, and no round limit: it's fought until one fleet is destroyed or disengages.</p>
      </div>
    );
  }
  return (
    <div className="battle-fields">
      {scenario}
      <label>
        Battle
        <select
          value={limit === null ? "cruiser_clash" : String(limit)}
          onChange={(e) => {
            const v = e.target.value;
            // Points battles default to victory points; Cruiser Clash to its own scoring.
            if (v === "cruiser_clash") onChange({ scenario: "cruiser_clash", forces: { kind: "cruiser_clash" }, scoring: "cruiser_clash" });
            else onChange({ scenario: "cruiser_clash", forces: { kind: "points", limit: Number(v) }, scoring: limit === null ? "victory_points" : (value.scoring ?? "victory_points") });
          }}
        >
          <option value="cruiser_clash">Cruiser Clash (1–4 cruisers each, up to 185 pts)</option>
          {POINTS_LIMITS.map((p) => (
            <option key={p} value={p}>
              {p} points a side
            </option>
          ))}
        </select>
      </label>
      <label>
        Scoring
        <select value={value.scoring ?? "cruiser_clash"} onChange={(e) => onChange({ ...value, scoring: e.target.value as NonNullable<Battle["scoring"]> })}>
          <option value="victory_points">Victory points (pp. 122–123)</option>
          <option value="cruiser_clash">Cruiser Clash: damage, crippled, destroyed (p. 128)</option>
        </select>
      </label>
    </div>
  );
}

/** The game's rule switches: ramming (pp. 55–56), boarding with teleport attacks (pp. 89–92), and carriers (p. 129, Cruiser Clash only). */
export function RulesChecks({ value, onChange, points = false }: { value: Rules; onChange: (rules: Rules) => void; points?: boolean }) {
  return (
    <>
      <label className="check">
        <input type="checkbox" checked={value.ramming} onChange={(e) => onChange({ ...value, ramming: e.target.checked })} />
        Ramming (optional rule, pp. 55–56)
      </label>
      <label className="check">
        <input type="checkbox" checked={value.boarding} onChange={(e) => onChange({ ...value, boarding: e.target.checked })} />
        Boarding and teleport attacks (pp. 89–92)
      </label>
      {!points && (
        <label className="check">
          <input type="checkbox" checked={value.carriers} onChange={(e) => onChange({ ...value, carriers: e.target.checked })} />
          One carrier each, over the points cap (p. 129)
        </label>
      )}
    </>
  );
}

type FieldsProps = {
  legend: string;
  /** CSS class for the player's colour. */
  className: string;
  side: Side;
  onChange: (patch: Partial<Side>) => void;
  /** Names to flag as clashing. */
  dupes: string[];
  /** The game allows carriers: one each in Cruiser Clash (p. 129), any in a points battle. */
  carriers?: boolean;
  /** A points battle: the side sets its own number of ships, up to the limit (shown against its total). */
  pointsLimit?: number | null;
  /** Names the other side has taken, for new ships' defaults. */
  taken?: string[];
};

/** Short names for options in summaries: "nova cannon", "targeting matrix"… */
const optionLabel = (id: string): string => id.replaceAll("_", " ");

/** "2 × Lunar class cruiser, 1 × Lunar class cruiser + nova cannon · 580 pts" */
function fleetSummary(side: Side, carriers: boolean, limit: number | null = null): string {
  const counts = new Map<string, { n: number; points: number }>();
  side.ships.forEach((_, i) => {
    const p = shipProfileOf(side, i, carriers, limit !== null);
    const name = [p.className, ...(p.options ?? []).map(optionLabel)].join(" + ");
    const c = counts.get(name) ?? { n: 0, points: p.points };
    counts.set(name, { ...c, n: c.n + 1 });
  });
  const total = [...counts.values()].reduce((t, c) => t + c.n * c.points, 0);
  return `${[...counts].map(([name, c]) => `${c.n} × ${name} (${c.points} pts)`).join(", ")} · ${total}${limit === null ? "" : ` of ${limit}`} pts`;
}

/** One side: commander, fleet, and a name and class per ship. */
export function FleetFields({ legend, className, side, onChange, dupes, carriers = false, pointsLimit = null, taken = [] }: FieldsProps) {
  const count = side.ships.length;
  const choices = classChoices(side.fleet, carriers, pointsLimit !== null);
  const classes = classIds(side, carriers, pointsLimit !== null);
  const options = optionIds(side, carriers, pointsLimit !== null);
  // A new class drops the old one's options.
  const setClass = (i: number, classId: string) =>
    onChange({ classes: classes.map((c, j) => (j === i ? classId : c)), options: options.map((o, j) => (j === i ? [] : o)) });
  const toggle = (i: number, id: string, on: boolean) =>
    onChange({ options: options.map((o, j) => (j !== i ? o : on ? [...o.filter((x) => x !== id), id] : o.filter((x) => x !== id))) });
  return (
    <fieldset className={className}>
      <legend>
        {legend} · {FLEETS[side.fleet].name}
      </legend>
      <label>
        Commander
        <input value={side.name} onChange={(e) => onChange({ name: e.target.value })} required maxLength={40} />
      </label>
      <label>
        Fleet
        <select value={side.fleet} onChange={(e) => onChange({ fleet: e.target.value as Fleet })}>
          {(Object.keys(FLEETS) as Fleet[]).map((f) => (
            <option key={f} value={f}>
              {FLEETS[f].name}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">{fleetSummary(side, carriers, pointsLimit)}</p>
      {side.ships.map((name, i) => (
        <div key={i} className="ship-row">
          <label>
            {count === 1 ? "Ship name" : `Ship ${i + 1}`}
            <input
              value={name}
              onChange={(e) => onChange({ ships: side.ships.map((s, j) => (j === i ? e.target.value : s)) })}
              required
              maxLength={40}
              aria-invalid={dupes.includes(name.trim())}
            />
          </label>
          <label>
            {count === 1 ? "Class" : `Ship ${i + 1} class`}
            <select value={classes[i]} onChange={(e) => setClass(i, e.target.value)}>
              {choices.map((id) => {
                const p = profileOf(id);
                return (
                  <option key={id} value={id}>
                    {p.className.replace(" class cruiser", "")} · {p.points} pts
                  </option>
                );
              })}
            </select>
          </label>
          {(CATALOGUE[classes[i] ?? ""]?.options ?? []).length > 0 && (
            <fieldset className="ship-options">
              <legend className="muted small">{count === 1 ? "Options" : `Ship ${i + 1} options`}</legend>
              {(CATALOGUE[classes[i] ?? ""]?.options ?? []).map((o) => (
                <label key={o.id} className="check">
                  <input type="checkbox" checked={options[i]?.includes(o.id) ?? false} onChange={(e) => toggle(i, o.id, e.target.checked)} />
                  {o.name} ({o.points >= 0 ? "+" : "−"}
                  {Math.abs(o.points)} pts)
                </label>
              ))}
            </fieldset>
          )}
        </div>
      ))}
      {pointsLimit !== null && (
        <div className="buttons">
          <button type="button" disabled={count >= MAX_POINTS_SHIPS} onClick={() => onChange({ ships: resize(side.ships, side.fleet, count + 1, taken) })}>
            Add a ship
          </button>
          <button type="button" disabled={count <= 1} onClick={() => onChange({ ships: side.ships.slice(0, -1) })}>
            Remove the last
          </button>
        </div>
      )}
    </fieldset>
  );
}

/** The engine's reason this fleet can't play, if there is one. */
export function FleetProblem({ problem }: { problem: string | null }) {
  return problem !== null ? <p className="rejection">{problem}</p> : null;
}

export function DuplicateNames({ dupes }: { dupes: string[] }) {
  return dupes.length > 0 ? <p className="rejection">Every ship needs its own name ({dupes.join(", ")}).</p> : null;
}
