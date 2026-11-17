# TODO — Supermarkets: products, prices, and where to buy

> **Status: Proposed — not started.** Agreed 2026-11-17 as part of Phase 2 of the
> [plan redesign](./TODO_weekly-plan-redesign.md), built in Expo. Phase 1 only records a store
> on a product component ("Tortilla · Mercadona", ADR-0009 §1).

The kitchen shops at Mercadona, Lidl and Ametller Origen. Cestachef (a Spanish recipe site)
shows a recipe's cost per serving across 9 of 18 supermarkets; we want something smaller and
our own, not a copy.

## What it does, in order of value

- [ ] **(a) What to pick:** a list line shows the real product, its pack and its price, grouped
      by aisle
- [ ] **(b) Cost per serving** of a recipe
- [ ] **(c) What the list costs at each shop**, counting whole packs (you cannot buy 150 g of a
      500 g tray)
- [ ] **(d) The list split by shop:** a product's preferred shop wins ("recomendado en": tortilla
      and salmorejo at Mercadona, fruit at Ametller, one dish's things at Lidl), price decides
      the rest

## Where the data comes from (checked 2026-11-14)

| Shop | Source | Notes |
|---|---|---|
| **Mercadona** (first) | `datania/mercadona-catalog`, MIT (published as a Hugging Face dataset) | A weekly crawl into a dataset: 5,325 products with EAN, price per unit, photos, categories and nutrition. Mercadona's `robots.txt` disallows `/api`, so we read the dataset and never crawl the shop ourselves |
| **Ametller Origen** (second) | Its shop runs on Salesforce Commerce Cloud, which serves products with a guest token | Small open-source CLIs already read it (e.g. `jgalea/ametller-cli`). Check its terms before relying on it |
| **Lidl** | None usable | No full food catalog online; lidl.es search returns promotions only. Open Prices has 108 Lidl Spain prices. **Lidl is by preference only, with no price** |

## Deferred, with the trigger to revisit

| What | Revisit when |
|---|---|
| Lidl Plus receipts as a price source (an unofficial client exists, untested for Spain) | Mercadona and Ametller prices are in use and Lidl is the gap people feel |
| Mercadona's emailed tickets as a price source | Same as above |
| Price-drop alerts | Weekly prices have been stored for a few months |
| Calories per serving (Mercadona's data carries nutrition) | (a)–(b) are in, since they share the data. Not now: calorie counting is not what this app is for |
