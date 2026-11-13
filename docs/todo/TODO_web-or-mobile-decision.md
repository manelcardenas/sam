# TODO — Web or mobile app: decide

> **Status: Proposed — not started.** A decision, recorded as an ADR, before the plan redesign.

The app is used almost only on phones, by two people. Options:

| Option | What it means | For | Against |
|---|---|---|---|
| A. Keep the Next.js web app, make it a better PWA | Fix layout (quick wins), installable icon | Least work; restaurants already work well | Not "a real app"; no Expo learning |
| B. Expo app (Expo Router) **with Expo web** replacing Next.js | One codebase for phone and browser | One UI to maintain; same stack as mywally-app (Expo Router, NativeWind, i18next, Orval client from OpenAPI) | Rewrite everything, including the map (`maplibre-gl` → a native map library) |
| C. Expo app for the daily part (plan + list), web stays for the rest | Two frontends | Smallest Expo start | Two UIs to keep in step |

**Costs to put in numbers before deciding:**
- Installing on an iPhone outside the App Store needs the Apple Developer Program (99 $/year), or
  rebuilding every 7 days. Android can install an APK for free. Which phones are used?
- Expo Go is not enough once a native map library is in, so it means EAS development builds.

- [ ] Answer: which phones (iOS / Android)?
- [ ] Grill the options and write ADR 0008
- [ ] If B or C: copy the mywally-app conventions (Expo Router, NativeWind, i18next, an Orval
      client generated from FastAPI's OpenAPI)
