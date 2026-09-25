"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, SearchX, Trash2 } from "lucide-react";
import { ApiError, apiClient, type GroceryItem, type GroceryItemInput, type RecipeRef } from "@/lib/api-client";
import { AisleIcon } from "@/components/AisleIcon";
import { AislePicker } from "@/components/AislePicker";
import ConfirmModal from "@/components/ConfirmModal";
import { EmptyPanel } from "@/components/profile/EmptyPanel";
import { Chip, ClearChip } from "@/components/ui/Chip";
import { NarrowRow } from "@/components/ui/NarrowRow";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { formatRelativeDate } from "@/lib/format";
import { INITIAL_STATE as DASHBOARD_INITIAL, toQuery as toDashboardQuery } from "@/lib/dashboard-url";
import { AISLES, isUnreviewed, nameFor, narrowVocabulary } from "@/lib/grocery";
import type { Shelf } from "@/lib/profile-url";

/** Rows rendered before "show more". The seed alone is 274; nobody scrolls that on a phone. */
const PAGE = 50;

/**
 * The shared grocery vocabulary, for admins: every row, newest first, narrowable
 * by aisle and by name, each one editable in place and — unless it was seeded —
 * deletable.
 *
 * **Why this exists.** The parser writes rows nobody reviews, and people file
 * typos by hand from the shopping list. Both are right at the moment they
 * happen and occasionally wrong afterwards, and until this panel there was no
 * way to undo one short of SQL against production.
 *
 * **The server is the gate, not this panel.** It is only mounted for members of
 * the Cognito `admins` group, but that is presentation: the two write routes
 * check the group on the token themselves, and answer anybody else with a 403.
 *
 * Loads its own data on mount rather than taking it from the page, unlike the
 * other panels: the vocabulary is only ever needed here and on `/plan`, and
 * fetching it for every visit to the profile would be a request for one reader.
 *
 * **Which recipes use each row** comes from a second request, and is optional:
 * if it fails the panel works exactly as before, just without the recipe
 * counts. It is what tells a harmless `qwerty` (no recipes, delete it) apart
 * from a badly named row half the collection depends on (rename it instead).
 */
export function GroceryAdminPanel({
  q,
  shelf,
  onQueryChange,
  onShelfChange,
}: {
  q: string;
  shelf: Shelf | null;
  onQueryChange: (next: string) => void;
  onShelfChange: (next: Shelf | null) => void;
}) {
  const { t, tp, locale } = useI18n();
  const [items, setItems] = useState<GroceryItem[] | null>(null);
  // Null until loaded, and for good if it fails — then nothing about recipes is shown.
  const [usage, setUsage] = useState<Record<string, RecipeRef[]> | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [deleting, setDeleting] = useState<GroceryItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .listGroceryItems()
      .then((loaded) => {
        if (!cancelled) setItems(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A rename can change which recipe names resolve to a row, so this reruns
  // after every save rather than only on mount.
  const loadUsage = useCallback(() => {
    apiClient
      .getGroceryUsage()
      .then(setUsage)
      .catch(() => undefined);
  }, []);
  useEffect(loadUsage, [loadUsage]);

  const all = useMemo(() => items ?? [], [items]);
  const shown = useMemo(() => narrowVocabulary(all, q, shelf), [all, q, shelf]);
  const unreviewed = all.filter(isUnreviewed).length;
  // Only aisles that hold something — an empty chip is a dead end, the rule
  // every other chip row in the app follows.
  const present = AISLES.filter((aisle) => all.some((item) => item.aisle === aisle));
  const narrowed = Boolean(q.trim() || shelf);

  // A new search starts from the top of the list again.
  useEffect(() => setLimit(PAGE), [q, shelf]);

  const replace = (saved: GroceryItem) => {
    setItems((current) => (current ?? []).map((item) => (item.key === saved.key ? saved : item)));
    loadUsage();
  };
  const recipesOf = (item: GroceryItem): RecipeRef[] | undefined => (usage ? (usage[item.key] ?? []) : undefined);

  const remove = async () => {
    if (!deleting) return;
    await apiClient.deleteGroceryItem(deleting.key);
    setItems((current) => (current ?? []).filter((item) => item.key !== deleting.key));
    setOpen(null);
    setDeleting(null);
  };

  const clear = () => {
    onQueryChange("");
    onShelfChange(null);
  };

  if (failed) {
    return <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">{t("admin.load-failed")}</p>;
  }
  if (items === null) {
    // Row-shaped placeholders, like the page skeletons: the list lands where
    // they were rather than pushing in from nowhere.
    return (
      <ul aria-busy="true" className="space-y-2">
        {[0, 1, 2, 3].map((n) => (
          <li key={n} className="h-[4.5rem] animate-pulse rounded-2xl border border-line bg-surface-2/50" />
        ))}
      </ul>
    );
  }

  return (
    <>
      <div className="mb-4">
        <h2 className="font-display text-lg font-bold text-fg">{t("admin.groceries-title")}</h2>
        <p className="text-sm text-muted">{t("admin.groceries-intro")}</p>
      </div>

      <NarrowRow
        q={q}
        onQueryChange={onQueryChange}
        placeholder={t("admin.search-placeholder")}
        ariaLabel={t("admin.search-label")}
        resultCount={shown.length}
        countKey="admin.count"
        chips={
          <>
            {unreviewed > 0 && (
              <Chip active={shelf === "unreviewed"} onClick={() => onShelfChange(shelf === "unreviewed" ? null : "unreviewed")}>
                {t("admin.unreviewed")}
                <span className="tabular-nums opacity-70">{unreviewed}</span>
              </Chip>
            )}
            {present.map((aisle) => (
              <Chip key={aisle} active={shelf === aisle} onClick={() => onShelfChange(shelf === aisle ? null : aisle)}>
                <AisleIcon aisle={aisle} className="h-4 w-4 shrink-0" />
                {t(`aisle.${aisle}`)}
              </Chip>
            ))}
            {narrowed && <ClearChip onClick={clear} />}
          </>
        }
      />

      {shown.length === 0 ? (
        <EmptyPanel
          icon={<SearchX className="mx-auto mb-3 h-8 w-8 text-muted" aria-hidden />}
          title={t("admin.empty-title")}
          body={t("admin.empty-body")}
          actionLabel={narrowed ? t("common.clear") : undefined}
          onAction={narrowed ? clear : undefined}
        />
      ) : (
        <>
          <ul className="space-y-2">
            {shown.slice(0, limit).map((item) => (
              <li key={item.key} className="rounded-2xl border border-line bg-surface">
                <button
                  type="button"
                  onClick={() => setOpen(open === item.key ? null : item.key)}
                  aria-expanded={open === item.key}
                  className="flex w-full cursor-pointer items-start gap-3 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-surface-2/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                >
                  <AisleIcon aisle={item.aisle} className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-fg [overflow-wrap:anywhere]">{nameFor(item, locale)}</span>
                    <span className="block truncate text-xs text-muted">{otherNames(item, locale)}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.7rem] text-muted">
                      {item.source && <span>{t(`admin.source-${item.source}`)}</span>}
                      {isUnreviewed(item) && (
                        <span className="rounded-full bg-amber/15 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber">{t("admin.unreviewed")}</span>
                      )}
                      {item.created_at && <span>· {t("admin.added", { when: formatRelativeDate(item.created_at.slice(0, 10), locale) })}</span>}
                      {usage?.[item.key] && (
                        <span className="inline-flex items-center gap-1">
                          · <BookOpen className="h-3 w-3" aria-hidden />
                          {tp("admin.used-in", usage[item.key].length)}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-muted">{t(`aisle.${item.aisle}`)}</span>
                </button>

                {open === item.key && <Editor item={item} recipes={recipesOf(item)} onSaved={replace} onDelete={() => setDeleting(item)} />}
              </li>
            ))}
          </ul>

          {shown.length > limit && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setLimit((current) => current + PAGE)}
                className="cursor-pointer rounded-full border border-line px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
              >
                {t("admin.show-more")}
              </button>
            </div>
          )}
        </>
      )}

      {deleting && (
        <ConfirmModal
          title={t("admin.delete-title", { name: nameFor(deleting, locale) })}
          message={
            recipesOf(deleting)?.length
              ? `${tp("admin.delete-used", recipesOf(deleting)?.length ?? 0)} ${t("admin.delete-body")}`
              : t("admin.delete-body")
          }
          onConfirm={remove}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}

/** The two names you are not reading in, so a row says what it merges with. */
function otherNames(item: GroceryItem, locale: string): string {
  const primary = nameFor(item, locale);
  return [...new Set([item.name_es, item.name_ca, item.name_en])].filter((name) => name !== primary).join(" · ");
}

const fieldClass =
  "h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-fg placeholder:text-muted/60 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30";

/**
 * One row, every field, one save.
 *
 * A single save rather than saving each field as it changes: renaming the three
 * names is one decision, and a server that validated them one at a time could
 * refuse the second rename because of the first.
 */
function Editor({
  item,
  recipes,
  onSaved,
  onDelete,
}: {
  item: GroceryItem;
  /** Undefined while unknown — the usage request failed or has not answered. */
  recipes: RecipeRef[] | undefined;
  onSaved: (saved: GroceryItem) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<GroceryItemInput>({
    name_es: item.name_es,
    name_ca: item.name_ca,
    name_en: item.name_en,
    aisle: item.aisle,
    is_pantry: item.is_pantry,
    default_unit: item.default_unit,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const patch = (next: Partial<GroceryItemInput>) => {
    setDraft((current) => ({ ...current, ...next }));
    setSaved(false);
  };
  const blank = [draft.name_es, draft.name_ca, draft.name_en].some((name) => !name.trim());

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onSaved(await apiClient.updateGroceryItem(item.key, draft));
      setSaved(true);
    } catch (err) {
      // 409 carries the sentence that matters — which row already has the name.
      setError(err instanceof ApiError && err.message ? err.message : t("plan.save-failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4 border-t border-line px-4 pb-4 pt-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {(["es", "ca", "en"] as const).map((lang) => (
          <label key={lang} className="block space-y-1">
            <span className="text-xs font-semibold text-muted">{t(`admin.name-${lang}`)}</span>
            <input
              type="text"
              value={draft[`name_${lang}`]}
              onChange={(e) => patch({ [`name_${lang}`]: e.target.value })}
              maxLength={255}
              className={fieldClass}
            />
          </label>
        ))}
      </div>

      <div className="space-y-1.5">
        <span className="text-xs font-semibold text-muted">{t("admin.aisle")}</span>
        <AislePicker current={draft.aisle} onPick={(aisle) => patch({ aisle })} disabled={busy} />
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="block w-40 space-y-1">
          <span className="text-xs font-semibold text-muted">{t("admin.unit")}</span>
          <input
            type="text"
            value={draft.default_unit ?? ""}
            onChange={(e) => patch({ default_unit: e.target.value || null })}
            placeholder={t("admin.unit-hint")}
            maxLength={50}
            className={fieldClass}
          />
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={draft.is_pantry} onChange={(e) => patch({ is_pantry: e.target.checked })} className="h-4 w-4 accent-tomato" />
          {t("admin.pantry")}
        </label>
      </div>

      {recipes && (
        <div className="space-y-1.5">
          <span className="text-xs font-semibold text-muted">{t("admin.recipes")}</span>
          {recipes.length === 0 ? (
            <p className="text-sm text-muted">{t("admin.no-recipes")}</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {recipes.map((recipe) => (
                <li key={recipe.id}>
                  <Link
                    href={`/dashboard?${toDashboardQuery({ ...DASHBOARD_INITIAL, view: "detail", recipeId: recipe.id })}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm font-semibold text-fg transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                  >
                    <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                    {recipe.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-tomato/10 px-3 py-2 text-sm text-tomato-700 dark:text-tomato">
          {error}
        </p>
      )}
      {item.source === "seed" && <p className="text-xs text-muted">{t("admin.seed-cannot-delete")}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {item.source !== "seed" ? (
          <button
            type="button"
            onClick={onDelete}
            className="flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-muted transition-colors hover:bg-tomato/10 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            {t("common.delete")}
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          {saved && (
            <span role="status" className="text-sm text-leaf-700 dark:text-leaf">
              {t("admin.saved")}
            </span>
          )}
          <button
            type="submit"
            disabled={busy || blank}
            className="cursor-pointer rounded-full bg-tomato px-5 py-2.5 font-display text-sm font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            {busy ? t("common.saving") : t("common.save-changes")}
          </button>
        </div>
      </div>
    </form>
  );
}
