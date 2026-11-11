import type { Page } from "@playwright/test";

/**
 * Puts the page at rest before an accessibility audit. Contrast is defined for the resting state, and an audit that lands on
 * a frame of a fade-in measures blended colors. The stylesheet already honours prefers-reduced-motion by disabling every
 * animation and transition, so the audit asks for it. No accessibility rule is weakened or skipped.
 */
export async function settleAnimations(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
