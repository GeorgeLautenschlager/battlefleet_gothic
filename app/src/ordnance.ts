/** How ordnance reads in prose: "6 torpedoes", "Fury, Starhawk". */
import type { Ordnance } from "@bfg/engine";

export function ordnanceLabel(o: Ordnance): string {
  if (o.kind === "torpedo_salvo") return `${o.strength} torpedoes`;
  if (o.kind === "orbital_mine") return "an orbital mine";
  return o.squadrons.map((s) => s.name).join(", ");
}
