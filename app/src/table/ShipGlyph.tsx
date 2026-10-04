import { constants, type Ship } from "@bfg/engine";
import { toSvg, type View } from "./view";

/** A cruiser silhouette, nose up, about 7 cm long, centred on the stem. */
const HULL = "M0,-3.6 L0.9,-1.8 L1.1,2.4 L0.6,3.2 L-0.6,3.2 L-1.1,2.4 L-0.9,-1.8 Z";

type Props = {
  ship: Pick<Ship, "id" | "name" | "owner" | "status" | "profile"> & { position: { x: number; y: number }; heading: number };
  view: View;
  ghost?: "ok" | "short" | "bad";
  selected?: boolean;
  /** A legal target for the weapon being aimed. */
  targeted?: boolean;
  onSelect?: (id: string) => void;
};

export function ShipGlyph({ ship, view, ghost, selected = false, targeted = false, onSelect }: Props) {
  const p = toSvg(view, ship.position);
  const r = constants.BASE_RADIUS[ship.profile.baseSize];
  const hulk = ship.status === "drifting_hulk" || ship.status === "blazing_hulk";
  const classes = ["ship", ship.owner, hulk ? "hulk" : "", ship.status === "blazing_hulk" ? "blazing" : "", ghost ? `ghost ${ghost}` : "", selected ? "selected" : "", targeted ? "targeted" : ""];
  return (
    <g
      className={classes.filter(Boolean).join(" ")}
      transform={`translate(${p.x} ${p.y})`}
      onClick={onSelect ? () => onSelect(ship.id) : undefined}
      data-ship={ship.id}
    >
      <circle className="base" r={r} />
      <g transform={`rotate(${ship.heading})`}>
        <path className="hull" d={HULL} />
      </g>
      <circle className="stem" r={0.25} />
      {!ghost && (
        <text className="label" y={r + 3.2} textAnchor="middle">
          {ship.name}
        </text>
      )}
    </g>
  );
}
