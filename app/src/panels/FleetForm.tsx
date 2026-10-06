/** Pieces of the fleet forms: hot-seat New game, Online, and the online lobby's join. */
import { CATALOGUE, type CommanderConfig, type Mark, type PlayerId } from "@bfg/engine";
import { classChoices, classIds, commandPoints, DEFAULT_ESCORT_SQUADRON, defaultCommand, defaultNames, FLEETS, MAX_POINTS_SHIPS, MAX_SHIPS, mostExpensive, optionIds, POINTS_LIMITS, profileOf, shipProfileOf, withOption, type Command, type Fleet, type NewGameOptions, type Side } from "../game/config";

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

export type Rules = { ramming: boolean; boarding: boolean; carriers: boolean; fleetLists?: boolean };

export type Battle = Pick<NewGameOptions, "scenario" | "forces" | "scoring" | "attacker">;

const PLAYER_LABELS: Record<PlayerId, string> = { p1: "Player 1", p2: "Player 2" };

/**
 * The scenario (T49): Cruiser Clash, classic or by points (p. 129), with its
 * scoring (T37); The Bait, with who is pursued (p. 130, T93); or Fleet Engagement
 * at a points limit. The last two are always victory points.
 * `players`: how to name the seats when choosing who is pursued ("You" online).
 */
export function BattleFields({ value, onChange, players = PLAYER_LABELS }: { value: Battle; onChange: (patch: Battle) => void; players?: Record<PlayerId, string> }) {
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
              : e.target.value === "the_bait"
              ? { scenario: "the_bait", forces: { kind: "points", limit: 500 }, scoring: "victory_points", attacker: "p2" }
              : { scenario: "cruiser_clash", forces: { kind: "cruiser_clash" }, scoring: "cruiser_clash" },
          )
        }
      >
        <option value="cruiser_clash">Cruiser Clash (p. 128)</option>
        <option value="the_bait">The Bait (p. 130)</option>
        <option value="fleet_engagement">Fleet Engagement (pp. 142–143)</option>
      </select>
    </label>
  );
  if (value.scenario === "the_bait") {
    const pursuers = value.attacker ?? "p2";
    const pursued: PlayerId = pursuers === "p1" ? "p2" : "p1";
    const l = limit ?? 500;
    return (
      <div className="battle-fields">
        {scenario}
        <label>
          Pursued
          <select value={pursued} onChange={(e) => onChange({ ...value, attacker: e.target.value === "p1" ? "p2" : "p1" })}>
            {(["p1", "p2"] as const).map((p) => (
              <option key={p} value={p}>
                {players[p]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Pursuers' points
          <select value={String(l)} onChange={(e) => onChange({ ...value, forces: { kind: "points", limit: Number(e.target.value) } })}>
            {POINTS_LIMITS.map((p) => (
              <option key={p} value={p}>
                {p} points
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">
          The pursuers field up to {l} points. The pursued field the bait, one ship or one squadron up to {Math.floor(l / 2)} points, and up to {l} points of
          reinforcements, which arrive from the far edge during the battle. Victory points, until one fleet is destroyed or disengages.
        </p>
      </div>
    );
  }
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
      {points && (
        <label className="check">
          <input type="checkbox" checked={value.fleetLists === true} onChange={(e) => onChange({ ...value, fleetLists: e.target.checked })} />
          Fleet lists: Gothic Sector and Chaos Incursion ratios, Admirals, Warmasters and Lords
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
  /** Fleet lists are on: the side buys its commanders (T60). */
  lists?: boolean;
  /** The Bait's pursued side: each ship is the bait or a reinforcement (T93). */
  reinforcements?: boolean;
};

/** Short names for options in summaries: "nova cannon", "targeting matrix"… */
const optionLabel = (id: string): string => id.replaceAll("_", " ");

/** "2 × Lunar class cruiser, 1 × Lunar class cruiser + nova cannon · 580 pts"; with fleet lists, commanders count too. */
function fleetSummary(side: Side, carriers: boolean, limit: number | null = null, lists = false): string {
  const counts = new Map<string, { n: number; points: number }>();
  side.ships.forEach((_, i) => {
    const p = shipProfileOf(side, i, carriers, limit !== null);
    const name = [p.className, ...(p.options ?? []).map(optionLabel)].join(" + ");
    const c = counts.get(name) ?? { n: 0, points: p.points };
    counts.set(name, { ...c, n: c.n + 1 });
  });
  const command = lists ? commandPoints(side, carriers, limit !== null) : 0;
  const total = [...counts.values()].reduce((t, c) => t + c.n * c.points, 0) + command;
  const ships = [...counts].map(([name, c]) => `${c.n} × ${name} (${c.points} pts)`);
  return `${[...ships, ...(command > 0 ? [`commanders (${command} pts)`] : [])].join(", ")} · ${total}${limit === null ? "" : ` of ${limit}`} pts`;
}

/** The Bait's pursued side (N48): "Bait 180 of 250 pts · reinforcements 285 of 500 pts". */
function baitSummary(side: Side, carriers: boolean, limit: number): string {
  let bait = 0;
  let reinforcements = 0;
  side.ships.forEach((_, i) => {
    const p = shipProfileOf(side, i, carriers, true).points;
    if (side.reserves?.[i] === true) reinforcements += p;
    else bait += p;
  });
  return `Bait ${bait} of ${Math.floor(limit / 2)} pts · reinforcements ${reinforcements} of ${limit} pts`;
}

/** One side: commander, fleet, and a name and class per ship. */
export function FleetFields({ legend, className, side, onChange, dupes, carriers = false, pointsLimit = null, taken = [], lists = false, reinforcements = false }: FieldsProps) {
  const count = side.ships.length;
  const choices = classChoices(side.fleet, carriers, pointsLimit !== null);
  const classes = classIds(side, carriers, pointsLimit !== null);
  const options = optionIds(side, carriers, pointsLimit !== null);
  // A new class drops the old one's options.
  const setClass = (i: number, classId: string) =>
    onChange({ classes: classes.map((c, j) => (j === i ? classId : c)), options: options.map((o, j) => (j === i ? [] : o)) });
  const toggle = (i: number, id: string, on: boolean) =>
    onChange({ options: options.map((o, j) => (j !== i ? o : withOption(classes[i] ?? "", o, id, on))) });
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
      <p className="muted small">{reinforcements && pointsLimit !== null ? baitSummary(side, carriers, pointsLimit) : fleetSummary(side, carriers, pointsLimit, lists)}</p>
      {lists && <CommandFields side={side} carriers={carriers} onChange={(command) => onChange({ command })} />}
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
          {pointsLimit !== null && (
            <label>
              {count === 1 ? "Squadron" : `Ship ${i + 1} squadron`}
              <input
                value={side.squadrons?.[i] ?? ""}
                placeholder={CATALOGUE[classes[i] ?? ""]?.profile.type === "escort" ? DEFAULT_ESCORT_SQUADRON : "none"}
                onChange={(e) => onChange({ squadrons: side.ships.map((_, j) => (j === i ? e.target.value : (side.squadrons?.[j] ?? ""))) })}
                maxLength={30}
              />
            </label>
          )}
          {reinforcements && (
            <label className="check">
              <input
                type="checkbox"
                checked={side.reserves?.[i] === true}
                onChange={(e) => onChange({ reserves: side.ships.map((_, j) => (j === i ? e.target.checked : side.reserves?.[j] === true)) })}
              />
              {count === 1 ? "Reinforcement" : `Ship ${i + 1} is a reinforcement`} (arrives during the battle)
            </label>
          )}
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

const MARKS: { id: Mark; name: string; points: number; blurb: string }[] = [
  { id: "slaanesh", name: "Slaanesh", points: 25, blurb: "−2 Ld to enemy ships within 15 cm" },
  { id: "khorne", name: "Khorne", points: 20, blurb: "double boarding value" },
  { id: "tzeentch", name: "Tzeentch", points: 30, blurb: "+1 re-roll" },
  { id: "nurgle", name: "Nurgle", points: 35, blurb: "+1 hit, can't be boarded" },
];
const ADMIRALS = [
  { leadership: 8, name: "Fleet-Admiral (Ld 8, 50 pts)" },
  { leadership: 9, name: "Admiral (Ld 9, 100 pts)" },
  { leadership: 10, name: "Solar Admiral (Ld 10, 150 pts)" },
] as const;
const EXTRA = ["none", "one (+25 pts)", "two (+75 pts)", "three (+150 pts)"];

/**
 * The fleet commanders a list allows (fleets book p. 35, p. 232): an Admiral and
 * his extra re-rolls, or the Warmaster, his Marks and up to three Chaos Lords.
 */
function CommandFields({ side, carriers, onChange }: { side: Side; carriers: boolean; onChange: (command: Command) => void }) {
  const command = side.command ?? defaultCommand(side.fleet);
  const set = (patch: Partial<Command>) => onChange({ ...command, ...patch });
  const shipOptions = side.ships.map((name, i) => (
    <option key={i} value={i}>
      {name || `Ship ${i + 1}`}
    </option>
  ));
  if (side.fleet === "imperial_navy") {
    const admiral = command.fleet?.kind === "admiral" ? command.fleet : null;
    const setAdmiral = (a: Extract<CommanderConfig, { kind: "admiral" }> | null) => set({ fleet: a });
    return (
      <fieldset className="command">
        <legend className="muted small">Fleet commander (required over 750 pts)</legend>
        <label>
          Admiral
          <select
            value={admiral?.leadership ?? 0}
            onChange={(e) => {
              const ld = Number(e.target.value);
              setAdmiral(ld === 0 ? null : { kind: "admiral", leadership: ld as 8 | 9 | 10, extraRerolls: admiral?.extraRerolls ?? 0 });
            }}
          >
            <option value={0}>None</option>
            {ADMIRALS.map((a) => (
              <option key={a.leadership} value={a.leadership}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        {admiral !== null && (
          <>
            <label>
              Extra re-rolls
              <select value={admiral.extraRerolls} onChange={(e) => setAdmiral({ ...admiral, extraRerolls: Number(e.target.value) as 0 | 1 | 2 | 3 })}>
                {EXTRA.map((label, n) => (
                  <option key={n} value={n}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Admiral aboard
              <select value={Math.min(command.flagship, side.ships.length - 1)} onChange={(e) => set({ flagship: Number(e.target.value) })}>
                {shipOptions}
              </select>
            </label>
          </>
        )}
      </fieldset>
    );
  }
  const warmaster = command.fleet?.kind === "warmaster" ? command.fleet : { kind: "warmaster" as const, leadership: 8 as const, marks: [] };
  const flagship = side.ships[mostExpensive(side, carriers, true)] ?? "";
  return (
    <fieldset className="command">
      <legend className="muted small">Chaos Warmaster, aboard the most expensive ship ({flagship})</legend>
      <label>
        Warmaster
        <select value={warmaster.leadership} onChange={(e) => set({ fleet: { ...warmaster, leadership: Number(e.target.value) as 8 | 9 } })}>
          <option value={8}>Ld 8 (50 pts)</option>
          <option value={9}>Ld 9 (100 pts)</option>
        </select>
      </label>
      <div className="marks">
        {MARKS.map((m) => (
          <label key={m.id} className="check" title={m.blurb}>
            <input
              type="checkbox"
              checked={warmaster.marks.includes(m.id)}
              onChange={(e) => set({ fleet: { ...warmaster, marks: e.target.checked ? [...warmaster.marks, m.id] : warmaster.marks.filter((x) => x !== m.id) } })}
            />
            Mark of {m.name} (+{m.points})
          </label>
        ))}
      </div>
      {command.lords.map((lord, i) => (
        <div key={i} className="lord">
          <label>
            {`Chaos Lord ${i + 1} (Ld 8, 50 pts) aboard`}
            <select value={lord.ship} onChange={(e) => set({ lords: command.lords.map((l, j) => (j === i ? { ...l, ship: Number(e.target.value) } : l)) })}>
              {shipOptions}
            </select>
          </label>
          <label>
            {`Chaos Lord ${i + 1} mark`}
            <select
              value={lord.mark ?? ""}
              onChange={(e) => set({ lords: command.lords.map((l, j) => (j === i ? { ...l, mark: e.target.value === "" ? null : (e.target.value as Mark) } : l)) })}
            >
              <option value="">No Mark</option>
              {MARKS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} (+{m.points})
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => set({ lords: command.lords.filter((_, j) => j !== i) })}>
            Remove
          </button>
        </div>
      ))}
      {command.lords.length < 3 && (
        <button type="button" onClick={() => set({ lords: [...command.lords, { ship: Math.min(command.lords.length + 1, side.ships.length - 1), mark: null }] })}>
          Add a Chaos Lord
        </button>
      )}
    </fieldset>
  );
}
