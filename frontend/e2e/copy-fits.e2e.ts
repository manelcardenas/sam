import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * Does every label fit on a small phone, in the longest language?
 *
 * Catalan at 360 px: Catalan copy runs ~19 % longer than English for short
 * labels, Spanish ~15 %, and 360 px is the narrowest common Android width. If
 * it fits there, it fits everywhere.
 *
 * Fails on any label that is cut ("Recept…"), spills out of its box, runs off
 * the screen, or — for a button, tab or chip — wraps onto a second line, and
 * on a page that scrolls sideways. Every screen is also screenshotted into
 * `e2e/.output/` to look at.
 *
 * Cutting is allowed only where it is a decision: user data marked
 * `data-may-truncate` (an address on a card). App copy never is.
 *
 * Run: `npm run e2e -w frontend` with the local stack up. `E2E_LOCALE=es`
 * checks Spanish.
 */

const EMAIL = process.env.E2E_EMAIL ?? "test@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "TestPass123!";
const LOCALE = process.env.E2E_LOCALE ?? "ca";
const WIDTH = 360;
const OUT = path.join(__dirname, ".output");

type Problem = { kind: "cut" | "spills" | "off-screen" | "wraps" | "page-scrolls"; text: string; where: string };

/** Runs in the page: every visible element whose own text does not fit. */
function findProblems(): Problem[] {
  const vw = window.innerWidth;
  const problems: Problem[] = [];
  const describe = (el: Element) => {
    const parts: string[] = [];
    for (let e: Element | null = el; e && parts.length < 3 && e !== document.body; e = e.parentElement) {
      const label = e.getAttribute("aria-label") ?? e.getAttribute("data-testid");
      parts.unshift(`${e.tagName.toLowerCase()}${label ? `[${label}]` : ""}`);
    }
    return parts.join(" > ");
  };
  // A row that scrolls sideways on purpose (chip strips) is allowed to hold
  // things past the edge.
  const inScroller = (el: Element) => {
    for (let e = el.parentElement; e; e = e.parentElement) {
      const o = getComputedStyle(e).overflowX;
      if (o === "auto" || o === "scroll") return true;
    }
    return false;
  };

  if (document.documentElement.scrollWidth > vw + 1) {
    problems.push({ kind: "page-scrolls", text: `${document.documentElement.scrollWidth}px wide`, where: "page" });
  }

  // Controls whose label should sit on one line: a wrapped "La setmana" is the
  // deformed button, not a paragraph doing its job.
  const CONTROL = "button, a, [role=tab], [role=button], label, summary";

  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const textNodes = Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim());
    if (!textNodes.length) continue;
    const own = textNodes.map((n) => n.textContent ?? "").join("").trim();
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue; // sr-only
    const text = own.length > 40 ? `${own.slice(0, 40)}…` : own;

    // The text's own extent, measured — scrollWidth rounds, and an ellipsis
    // that hides two letters slips under a one-pixel tolerance.
    const range = document.createRange();
    range.setStartBefore(textNodes[0]);
    range.setEndAfter(textNodes[textNodes.length - 1]);
    const lines = new Set(Array.from(range.getClientRects()).map((q) => Math.round(q.top))).size;
    const clipped = cs.textOverflow === "ellipsis" || cs.overflowX !== "visible";
    const wider = el.scrollWidth > el.clientWidth || (clipped && cs.whiteSpace === "nowrap" && range.getBoundingClientRect().width > el.clientWidth + 0.5);

    if (wider && clipped) {
      // User data (an address, a list of names) may be cut, where somebody
      // decided so; app copy never is. See components/ui/Button.tsx.
      if (!el.closest("[data-may-truncate]")) problems.push({ kind: "cut", text, where: describe(el) });
    } else if ((r.right > vw + 1 || r.left < -1) && !inScroller(el)) {
      problems.push({ kind: "off-screen", text, where: describe(el) });
    } else if (wider && !inScroller(el)) {
      problems.push({ kind: "spills", text, where: describe(el) });
    } else if (lines > 1 && own.split(/\s+/).length <= 4 && el.closest(CONTROL)) {
      problems.push({ kind: "wraps", text, where: describe(el) });
    }
  }
  return problems;
}

async function signIn(page: Page) {
  await page.goto("/");
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/(dashboard|profile)/, { timeout: 30_000 });
}

/** Lets the page settle: data loaded, skeletons gone, fonts in. */
async function settle(page: Page) {
  // Capped: the shopping list polls while a kitchen is shared, so the
  // network never goes fully idle there.
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

/**
 * The id of the row with the longest name a list page loads — the worst case
 * for a title — read off the app's own API response rather than by clicking
 * around for a card, which risks pressing something destructive on the way.
 */
async function longestIdFrom(page: Page, url: string, apiPath: RegExp, field: "name" | "title"): Promise<string | null> {
  const response = page.waitForResponse((r) => apiPath.test(new URL(r.url()).pathname) && r.request().method() === "GET");
  await page.goto(url);
  const rows = (await (await response).json()) as (Record<string, string> & { id: string })[];
  const longest = rows.reduce<(typeof rows)[number] | null>((best, row) => (!best || (row[field] ?? "").length > (best[field] ?? "").length ? row : best), null);
  return longest?.id ?? null;
}

/** A week other than this one, so /plan shows its "back to this week" button. */
function weekAfterNext(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}

test.use({ locale: LOCALE }); // navigator.languages too, in case storage is ignored

test("copy fits at 360 px", async ({ page }) => {
  await page.addInitScript((locale) => window.localStorage.setItem("sam-locale", locale), LOCALE);
  await page.setViewportSize({ width: WIDTH, height: 800 });
  await signIn(page);
  await expect(page.locator("html")).toHaveAttribute("lang", LOCALE);

  const recipe = await longestIdFrom(page, "/dashboard", /^\/recipes$/, "title");
  const place = await longestIdFrom(page, "/dine", /^\/restaurants$/, "name");
  expect(recipe, "the local DB has no recipes: is it seeded?").not.toBeNull();
  expect(place, "the local DB has no restaurants: is it seeded?").not.toBeNull();

  const screens: [string, string][] = [
    ["cook-list", "/dashboard"],
    ["cook-new", "/dashboard?mode=new"],
    ["cook-detail", `/dashboard?recipe=${recipe}`],
    ["cook-edit", `/dashboard?recipe=${recipe}&mode=edit`],
    ["dine-list", "/dine"],
    ["dine-new", "/dine?mode=new"],
    ["dine-detail", `/dine?place=${place}`],
    ["dine-edit", `/dine?place=${place}&mode=edit`],
    ["dine-review", `/dine?place=${place}&mode=review`],
    ["plan-calendar", "/plan"],
    ["plan-list", "/plan?view=list"],
    ["plan-other-week", `/plan?week=${weekAfterNext()}`],
    ["profile-recipes", "/profile?tab=recipes"],
    ["profile-reviews", "/profile?tab=reviews"],
    ["profile-plans", "/profile?tab=plans"],
    ["profile-account", "/profile?tab=account"],
  ];

  mkdirSync(OUT, { recursive: true });
  const report: Record<string, Problem[]> = {};
  for (const [name, url] of screens) {
    await page.goto(url);
    await settle(page);
    await page.screenshot({ path: path.join(OUT, `${LOCALE}-${WIDTH}-${name}.png`), fullPage: true });
    report[name] = await page.evaluate(findProblems);
  }

  writeFileSync(path.join(OUT, `${LOCALE}-${WIDTH}-report.json`), JSON.stringify(report, null, 2));
  const total = Object.values(report).reduce((n, p) => n + p.length, 0);
  for (const [name, problems] of Object.entries(report)) {
    if (!problems.length) continue;
    console.log(`\n${name} (${problems.length})`);
    for (const p of problems) console.log(`  ${p.kind.padEnd(12)} "${p.text}"  ${p.where}`);
  }
  console.log(`\n${total} problems across ${screens.length} screens (${LOCALE}, ${WIDTH}px). Screenshots in e2e/.output/`);

  expect(total, "labels that do not fit: see the list above and the screenshots").toBe(0);
});
