# TODO — Quick wins on the web app

> **Status: In progress — 1 and 2 done, 3 next.**

Three small problems on the current web app. Worth fixing now, whatever is decided in
[web or mobile](./TODO_web-or-mobile-decision.md), because the app is in daily use.

## 1. Back button in `/dine` goes to the wrong place

The detail is `/dine?place=<id>`; views push history, filters replace (AGENTS.md).

- **Bug 1 — the first restaurant opened after landing on `/dine` adds no history entry.**
  `applyUrl` (`app/dine/page.tsx:345-387`) sets `applyingHistory.current = true`, then sets
  state the page already has, so the writer effect never runs and the flag stays set. The first
  `openRestaurant` is then swallowed by the guard at `:397-401`. Back leaves `/dine` and goes to
  wherever you were before (Plan, Cook…). Only the second restaurant gets a proper entry.
  `/dashboard` avoids this because its `applyUrl` always sets a new filters object.
- **Bug 2 — deep links** (`/profile` → `/dine?place=X`): back returns to `/profile`, and the
  in-app Back pushes `/dine`, so the next back gesture loops into the detail again.

- [x] Flag dropped: `applyUrl` records the view it applies in `lastViewKey`, so the writer's
      echo is a same-URL no-op. Popping onto an `edit-review` entry now rewrites it to the
      detail URL, which is what it decodes to anyway.
- [x] On landing in a non-list view: the entry is rewritten as the list and the view pushed on
      top — both back paths land on the list.
- [x] Refreshing a restaurant you opened from the list no longer stacks a second list below
      it. The page's history depth now lives in `history.state` (`lib/url-state.ts`), which a
      reload keeps, instead of a counter in memory that reset to 0 and mistook the reload for
      a deep link. The counter also miscounted a *forward* as a back.
- [x] Tapping the tab you are already on (bottom bar and desktop switch) goes to that tab's
      main screen: Cook's list, Dine's list, this week in Plan, You's first tab. Before, the
      link changed the address bar and the mounted page ignored it. The shell announces the
      tap (`announceTabHome`) and the page pops the entries it pushed (`useTabHome`), so the
      back gesture afterwards leaves the tab instead of reopening what you left. Tests in
      `components/shell/AppShell.spec.tsx` and both page specs.
- [x] Tests: `app/dine/page.spec.tsx` (both fail on the old code) and
      `app/plan/page.spec.tsx`. /plan never had the bug: its URL is restored on mount, so the
      writer's mount run clears the flag; the test keeps it that way.
- [ ] Optional, not done: `view=map` as a replace-only param, and restore `scrollY` from
      history state

## 2. Long Spanish/Catalan strings deform the page on phones

Main culprit: the `/plan` header row (`app/plan/page.tsx:564`) — `KitchenBar` is
`shrink-0 whitespace-nowrap` (`KitchenBar.tsx:207`) next to the calendar/list toggle whose label
"Lista de la compra" (18 chars, 13 in English) wraps inside a pill. Total ≈ 390 px against 328 px
of content on a 360 px phone. Nothing in `AppShell` stops one wide child from widening the page.

Done as part of [shared UI components](./TODO_ui-components.md) (PR A), which also fixed the
cause: no shared `Button`.

- [x] Plan toggle: `SegmentedControl` — on a phone only the selected view spells its label;
      the toolbar row wraps
- [x] "Volver a esta semana": icon on a phone, the text as its name
- [x] Header tagline `shell.cook-and-dine`: hidden below `sm`
- [x] Every screen checked at 360 px in es, ca and en — `e2e/copy-fits.e2e.ts`, 0 problems
- Not done, on purpose: `overflow-x-clip` on the `AppShell` root. It would hide a too-wide child
  instead of surfacing it; the check fails on sideways scroll instead. KitchenBar and the sort
  `<select>` were not flagged at 360 px, so they were left alone. Restaurant `h1` `break-words`:
  the longest seeded name fits; revisit if a real name breaks it.

## 3. Adding a list line can return a 500

On 16 Oct three requests failed with `UniqueViolation` on `uq_shopping_list_items_merge_key`
(`jamon cocido`, unit `Lonchas`): an insert collided with a line that already existed under the
same merge key instead of merging into it.

- [ ] Reproduce (probably: unit casing, or a key resolved after the existence check)
- [ ] Fix the merge so it can never insert a duplicate key, plus a regression test
