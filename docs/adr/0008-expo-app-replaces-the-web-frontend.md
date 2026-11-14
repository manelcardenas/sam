# ADR-0008: An Expo app replaces the Next.js frontend, backend off Lambda first

- **Status:** Accepted (2026-11-14)
- **Context:** [`../todo/TODO_web-or-mobile-decision.md`](../todo/TODO_web-or-mobile-decision.md)
  (options, facts and prices as of 2026-11-14),
  [`../todo/TODO_backend-off-lambda.md`](../todo/TODO_backend-off-lambda.md)

## Context

SAM is a Next.js static export used as an installable PWA, almost only on phones, by two people
with one iPhone and one Android phone. It is meant to open to more people (friends, other
households), not to stay at two. The goal stated on 2026-11-14 is **a phone app**, and **not to
pay for now**.

Four options were weighed (the TODO has the full table): A a better PWA, B an Expo app with Expo
web replacing Next.js, C Expo only for Plan and the list, D the current web app inside Capacitor.

What decided it:

- **On an iPhone a PWA is second-class, and Apple keeps it so.** No install prompt, no Web Share
  Target (so "share this TikTok to SAM" is impossible, and link import is on the roadmap), web
  push only once installed by hand, storage Safari may evict. Opening the app to strangers through
  "tap Share → Add to Home Screen" loses people.
- **Navigation fights the browser.** The `samDepth` history work, the back gesture and safe areas
  are things a native stack gives for free.
- **Expo is the officially recommended way to build React Native**, and it is the stack of
  mywally-app (Expo Router, NativeWind, i18next, Orval, TanStack Query): learnt once, used twice.
- **The redesign is coming anyway** (PRODUCT.md: no dog, pastel, Apple-like), and the Plan
  redesign is mostly screens. Building both on the web and then again in Expo would be paying
  twice.
- **Capacitor (D) is a website in a shell**: App Store guideline 4.2 rejects thin wrappers, there
  is no native navigation, and it costs the same store fees as B.
- **C as an end state** means two UIs, two copy setups and two button systems for one person to
  keep in step. It survives only as the first phase of B.

**Paying is not needed to start.** Expo is open source; builds run free on the Mac (or on EAS's
free tier); an Android APK installs free outside Google Play (Google's developer verification
covers Brazil, Indonesia, Singapore and Thailand from 2026-09-30 and is planned worldwide in
2027, so it does not affect Spain today). The iPhone is the only paid part: 99 $/year for
TestFlight or the App Store, or a free Xcode install that expires every 7 days.

## Decision

Replace the Next.js frontend with an Expo app, in this order:

1. **Backend off Lambda, onto Vercel** ([TODO](../todo/TODO_backend-off-lambda.md)). It does not
   depend on the frontend (the API is HTTP + JSON, called the same way by a web page and a native
   app) and it removes the slowness felt today: every session starts with a 3.4–6.7 s cold start.
   Done means fast, measured, and able to take more users than two.
2. **Set up the Expo app** with mywally-app's conventions, pointed at the same backend and the
   same Cognito pool.
3. **Rebuild Plan and the shopping list in Expo, redesigned** — the
   [plan redesign](../todo/TODO_weekly-plan-redesign.md) is built here, not on the web.
4. **APK on the Android phone and start using it daily.** The iPhone keeps the current web app
   meanwhile (or a 7-day Xcode install, if it is the developer's own phone).
5. **The rest of the app to parity** in Expo: Cook, Dine, and the map last.
6. **When it is ready: pay** Apple (99 $/year) and Google Play (25 $ once), ship through
   TestFlight and the stores, let Expo web take over the browser, delete the Next.js app.

## Consequences

**The web app is frozen, not abandoned.** It stays live until step 6. It gets fixes, including
security ones (maplibre #71), but no new features and no redesign. The open web PRs (back button,
palette, copy fitting) are merged as they are.

**Work cancelled because it would be thrown away:** migrating the 112 remaining hand-written
buttons ([ui-components B](../todo/TODO_ui-components.md)), running the copy-fits check in CI
(C), and the web-only dependency upgrades (Tailwind 4, TypeScript 7, eslint 10 / React Compiler
rules). Each is recorded with "revisit if Expo is abandoned".

**What carries over:**

- The rules: labels never cut or broken mid-word, every label fits at 360 px in Catalan, all copy
  in `messages/` with English as the source.
- The `lib/` logic (API client, i18n, formatting, grocery rules), about 2,900 lines.
- The pastel palette, as CSS variables that map onto NativeWind.
- Most of the UI (~13,000 lines) and its tests (~5,800) do not carry over: they are rewritten.

**The backend changes only at the edges:**

- CORS stays while the web app lives; a native app does not need it.
- Notifications will use Expo Push (free) rather than Web Push: a table of device tokens and a
  call.
- Deep links need two files served from the web domain, one for iOS and one for Android.
- Cognito works in Expo. If it is ever replaced, do it before or with the Expo login, not after.

**Expo Go stops being enough** once a native module (maps, Amplify's native parts) is in. From
then on the app needs a development build, still free when built locally.

## Open

- Which person has the iPhone. If it is the developer's, a free 7-day Xcode install is a usable
  way to test the native app on iOS before paying.
- The map library for Dine (`maplibre-gl` has no direct React Native equivalent), decided when
  Dine is ported.

## Alternatives rejected

- **A. Better PWA** — the right answer if SAM stayed a two-person tool. It does not fit "a phone
  app" that strangers install, nor sharing into SAM from other apps on an iPhone.
- **C as the end state** — two frontends for one maintainer.
- **D. Capacitor** — store-review risk (guideline 4.2), no native navigation, no Expo learning,
  same fees as B.
