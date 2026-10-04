import type { Page } from "@playwright/test";

// Newer Chromes return a Promise from scrollIntoView. Make every browser do so, so code that leaks its
// return value (e.g. as a React effect cleanup) fails here and not only on the newest browser.
export async function promiseScrollIntoView(page: Page) {
  await page.addInitScript(() => {
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element, ...args: Parameters<typeof original>) {
      original.apply(this, args);
      return Promise.resolve() as unknown as undefined;
    };
  });
}

/** Surface what the page was doing when a test fails: uncaught errors and console errors. */
export function logPageErrors(page: Page) {
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}\n${e.stack ?? ""}`));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log(`[console.${m.type()}] ${m.text()}`);
  });
}

/** Click the table at a point in table cm (+y up). */
export async function clickTable(page: Page, x: number, y: number) {
  const box = await page.locator("svg.table").boundingBox();
  if (box === null) throw new Error("no table");
  // viewBox is -2 -2 184 124 (table 180 × 120).
  const sx = box.x + ((x + 2) / 184) * box.width;
  const sy = box.y + ((120 - y + 2) / 124) * box.height;
  await page.mouse.move(sx, sy);
  await page.mouse.click(sx, sy);
}
