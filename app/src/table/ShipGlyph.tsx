import { constants, type Ship } from "@bfg/engine";
import { toSvg, type View } from "./view";

/** A cruiser silhouette, nose up, about 7 cm long, centred on the stem. */
const HULL = "M0,-3.6 L0.9,-1.8 L1.1,2.4 L0.6,3.2 L-0.6,3.2 L-1.1,2.4 L-0.9,-1.8 Z";
/** A stationary defence (state §7.6): a platform, not a hull. It fires all round, so no bow. */
const PLATFORM = "M0,-2.2 L2.2,0 L0,2.2 L-2.2,0 Z M-1.2,0 L1.2,0 M0,-1.2 L0,1.2";

type Props = {
  ship: Pick<Ship, "id" | "name" | "owner" | "status" | "profile"> & { position: { x: number; y: number }; heading: number };
  view: View;
  ghost?: "ok" | "short" | "bad";
  selected?: boolean;
  /** A legal target for the weapon being aimed. */
  targeted?: boolean;
  /** Return true if the click was used up here, so it doesn't also count as a click on the table. */
  onSelect?: (id: string) => boolean;
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
      onClick={
        onSelect
          ? (e) => {
              if (onSelect(ship.id)) e.stopPropagation();
            }
          : undefined
      }
      data-ship={ship.id}
    >
      <circle className="base" r={r} />
      {ship.profile.type === "defence" ? (
        <path className="hull platform" d={PLATFORM} />
      ) : (
        <g transform={`rotate(${ship.heading})`}>
          <path className="hull" d={HULL} />
        </g>
      )}
      <circle className="stem" r={0.25} />
      {!ghost && (
        <text className="label" y={r + 3.2} textAnchor="middle">
          {ship.name}
        </text>
      )}
    </g>
  );
}
