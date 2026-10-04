/**
 * Table coordinates (cm, +y up, aviation bearings) to SVG (y down).
 * Bearings stay clockwise on screen, so SVG `rotate(heading)` points a
 * shape drawn nose-up the right way.
 */
import type { Point } from "@bfg/engine";

export type View = { width: number; height: number };

export const toSvg = (view: View, p: Point): Point => ({ x: p.x, y: view.height - p.y });

export const fromSvg = (view: View, p: Point): Point => ({ x: p.x, y: view.height - p.y });

/** The table point under a pointer event, or null if the SVG isn't laid out. */
export function pointerToTable(svg: SVGSVGElement, view: View, clientX: number, clientY: number): Point | null {
  const m = svg.getScreenCTM();
  if (m === null) return null;
  const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
  return fromSvg(view, { x: p.x, y: p.y });
}

/** Round to the nearest millimetre, for tidy transforms and logs. */
export const mm = (p: Point): Point => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
