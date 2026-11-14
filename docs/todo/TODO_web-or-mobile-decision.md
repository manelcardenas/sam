# TODO — Web or mobile app: decide

> **Status: Proposed — not started.** A decision, recorded as an ADR, before the plan redesign.

The app is used almost only on phones, by two people. Options:

| Option | What it means | For | Against |
|---|---|---|---|
| A. Keep the Next.js web app, make it a better PWA | Fix layout (quick wins), installable icon | Least work; restaurants already work well | Not "a real app"; no Expo learning |
| B. Expo app (Expo Router) **with Expo web** replacing Next.js | One codebase for phone and browser | One UI to maintain; same stack as mywally-app (Expo Router, NativeWind, i18next, Orval client from OpenAPI) | Rewrite everything, including the map (`maplibre-gl` → a native map library) |
| C. Expo app for the daily part (plan + list), web stays for the rest | Two frontends | Smallest Expo start | Two UIs to keep in step |
| D. Wrap the current static export in Capacitor | The same Next app inside a native shell, in the stores | Days, not weeks; one codebase; native push and share via plugins | Still a web UI (no native navigation or gestures); App Store guideline 4.2 rejects thin web wrappers; no Expo learning |

**Costs to put in numbers before deciding:**
- Installing on an iPhone outside the App Store needs the Apple Developer Program (99 $/year), or
  rebuilding every 7 days. Android can install an APK for free. Which phones are used?
- Expo Go is not enough once a native map library is in, so it means EAS development builds.

- [x] Answer: which phones (iOS / Android)? **One of each** (2026-11-14). The app is also meant
      to open to more people (friends, other households), not to stay at two.

## Facts gathered 2026-11-14

**The frontend today:** 92 files, ~15,900 lines (13,000 UI in `app/` + `components/`, 2,900
logic in `lib/`), 5,800 lines of tests. Runtime dependencies: `aws-amplify`, `maplibre-gl`
(7 files, ~725 lines of map UI), `lucide-react`, `dotlottie`, `react-icons`. In Expo, roughly the
`lib/` logic carries over (API client, i18n, formatting, grocery rules) except the browser-bound
files (`url-state`, `amplify`, `useLivePlan`, two animation hooks); the UI and its tests are
rewritten. mywally-app is the reference: Expo 56, Expo Router, NativeWind 4, i18next, Orval,
TanStack Query.

**Money:**
- Apple Developer Program 99 $/year — needed for TestFlight or the App Store. Without it an app
  installed from Xcode expires after 7 days.
- Google Play 25 $ once. Or an APK by hand — but Google's developer verification starts
  2026-09-30 in four countries and widens later; unverified APKs get a "high-friction" install.
- EAS: free tier (sources disagree: 15 iOS + 15 Android builds a month, or 30 in total; free
  builds queue at low priority). Local builds cost nothing. Starter is 19 $/month.
- PWA: 0. Already hosted on Amplify.

**What a PWA cannot do on an iPhone (2026):** no install prompt (Share → Add to Home Screen by
hand); no Web Share Target, so "share this TikTok/recipe to SAM" from another app is impossible;
no background sync; web push works only once installed to the Home Screen. Safari may evict
storage of a site not installed and unused for a while. On Android a PWA can do all of these.

**What the roadmap wants that touches this:** photo/voice/link ingredient capture
(`docs/plans/future-roadmap.md` §9 — link import from TikTok needs the share sheet), a shared
shopping list that two people edit (a push when the other adds a line), offline use in a
supermarket aisle.
- [ ] Grill the options and write ADR 0008
- [ ] If B or C: copy the mywally-app conventions (Expo Router, NativeWind, i18next, an Orval
      client generated from FastAPI's OpenAPI)
