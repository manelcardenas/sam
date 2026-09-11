"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, Eye, ListChecks, Lock } from "lucide-react";
import { useAuthGate } from "@/components/auth/useAuthGate";
import { ApiError, apiClient, type Meal, type MealPlan, type PlanEntry, type PlanGuest, type Recipe, type ShoppingListItem } from "@/lib/api-client";
import { currentParams, useBrowserNavigation, useHistoryDepth, writeUrl } from "@/lib/url-state";
import { DAYS_IN_WEEK, fromQuery, homeWeekOf, shiftDate, toQuery, weekDays, weekStartOf, type PlanView } from "@/lib/plan-url";
import type { ScaledLine } from "@/lib/plan-ingredients";
import { AppShell } from "@/components/shell/AppShell";
import { PlanSkeleton } from "@/components/ui/PageSkeleton";
import { EmptyPanel } from "@/components/profile/EmptyPanel";
import ConfirmModal from "@/components/ConfirmModal";
import { WeekGrid } from "@/components/plan/WeekGrid";
import { SlotSheet } from "@/components/plan/SlotSheet";
import { ShoppingList } from "@/components/plan/ShoppingList";
import { SharePanel } from "@/components/plan/SharePanel";
import { CarryOverPicker } from "@/components/plan/CarryOverPicker";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { formatWeekRange, formatWeekday } from "@/lib/format";

/**
 * The PLAN world: one week of meals, and the shopping list it builds.
 *
 * Why this is a top-level destination rather than a corner of COOK: the week's
 * list is a working artifact you open one-handed in a supermarket. The profile
 * is the right home for *history* (the year view, §5.3) and the wrong one for
 * the week you are shopping for right now.
 *
 * **The plan's status gates the page** (§8.2). `planning` edits everything;
 * `calendar_closed` is the shopping state — recipes fixed, list still yours;
 * `list_closed` is archived and read-only. The server enforces all of it and
 * answers 409, so the disabled controls here are a courtesy, not the guard.
 */
export default function PlanPage() {
  const { locale, t } = useI18n();

  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState("");
  const [ownPlan, setOwnPlan] = useState<MealPlan | null>(null);
  // Weeks other people shared. Separate from your own because you can have both
  // for the same week, and merging them would need one to be picked.
  const [sharedPlans, setSharedPlans] = useState<MealPlan[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [error, setError] = useState("");

  const [view, setView] = useState<PlanView>("calendar");
  const [week, setWeek] = useState<string | null>(null);
  const [slot, setSlot] = useState<{ date: string; meal: Meal } | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"finish" | "close" | null>(null);
  // Which unbought lines follow the week out. Seeded when the confirm opens,
  // not derived on render: the user unticks things in here, and a derived set
  // would put them straight back.
  const [carryOver, setCarryOver] = useState<Set<string>>(new Set());

  // Read once per mount, not per render: a page left open across midnight
  // should not silently re-mark which column is "today" mid-interaction.
  // "sv-SE" is the one common locale whose short date is already ISO-shaped,
  // and it renders in *local* time — which is what "today" means to a reader.
  const today = useRef(weekStartOf(new Date())).current;
  const todayIso = useRef(new Date().toLocaleDateString("sv-SE")).current;
  const weekStart = week ?? today;

  const { me } = useAuthGate();

  useEffect(() => {
    if (me?.display_name) setUserName(me.display_name);
  }, [me?.display_name]);

  // ── Data ────────────────────────────────────────────────────────────────────

  const loadPlan = useCallback(
    async (saturday: string): Promise<MealPlan | null> => {
      try {
        setError("");
        // Both in one go: the week selector has to know whether there is
        // anything to select before it can decide to render itself.
        const [mine, shared] = await Promise.all([
          apiClient.getPlan(saturday),
          apiClient.getSharedPlans(saturday).catch(() => [] as MealPlan[]),
        ]);
        setOwnPlan(mine);
        setSharedPlans(shared);
        return mine;
      } catch (err) {
        setError(err instanceof Error ? err.message : t("plan.load-failed"));
        return null;
      }
    },
    [t],
  );

  useEffect(() => {
    if (!me?.id || !me.display_name) return;
    let cancelled = false;
    void (async () => {
      // Every recipe is plannable, method or not, so the picker asks
      // for both. The ADR-0007 lens is left unset on purpose.
      const [mine, loaded] = await Promise.all([loadPlan(weekStart), apiClient.listRecipes().catch(() => [] as Recipe[])]);
      if (cancelled) return;
      setRecipes(loaded);

      // **The home week is the one you are shopping for next**, not the one the
      // calendar happens to be in. Once this week's list is closed the shopping
      // is home, and anything you think of for the rest of the week belongs to
      // the next shop — so that is where the planner opens.
      //
      // Only when the URL did not name a week: a link to a specific week must
      // land on it, closed or not. One hop only; two closed weeks in a row means
      // you planned a fortnight ahead, and guessing further would be guessing.
      const home = homeWeekOf(weekStart, mine?.status);
      if (!currentParams().get("week") && home !== weekStart) {
        const following = home;
        setWeek(following);
        // Loaded here rather than left to the effect below so the first paint
        // after the skeleton already holds next week. That effect then re-runs
        // for the changed week — one redundant GET, on this path only.
        await loadPlan(following);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  // Paging between weeks refetches the plan; the recipe list is week-independent.
  useEffect(() => {
    if (loading) return;
    void loadPlan(weekStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  // ── URL sync ────────────────────────────────────────────────────────────────

  const history = useHistoryDepth();
  const applyingHistory = useRef(false);
  const urlRestored = useRef(false);

  const applyUrl = useCallback((params: URLSearchParams) => {
    const next = fromQuery(params);
    applyingHistory.current = true;
    setView(next.view);
    setWeek(next.week);
    setSlot(next.slot);
    setPlanId(next.planId);
  }, []);

  useEffect(() => {
    if (urlRestored.current) return;
    urlRestored.current = true;
    applyUrl(currentParams());
  }, [applyUrl]);

  useBrowserNavigation((params) => {
    history.recordPop();
    applyUrl(params);
  });

  useEffect(() => {
    if (!urlRestored.current) return;
    if (applyingHistory.current) {
      applyingHistory.current = false;
      return;
    }
    const query = toQuery({ view, week, slot, planId });
    const before = window.location.search;
    // Everything here is a view — the week, the list, the sheet — so everything
    // pushes, and the back gesture walks out of the sheet and then back through
    // the weeks instead of leaving the app (lib/url-state.ts).
    writeUrl(query, "push");
    if (window.location.search !== before) history.recordPush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, week, slot, planId]);

  // ── Derived ─────────────────────────────────────────────────────────────────

  // A plan id that no longer resolves — access withdrawn, or a stale link from
  // another week — falls back to your own week rather than to an error. The
  // link stopped working; the page did not.
  const viewing = (planId ? sharedPlans.find((p) => p.id === planId) : null) ?? ownPlan;
  const plan = viewing;
  const isGuest = Boolean(plan && me?.id && plan.owner_id !== me.id);

  const status = plan?.status ?? "planning";
  // Three permissions, not one. Ticking is the single write sharing grants
  // (§4.3), so it is the only one a guest keeps — and `calendar_closed` is the
  // state you are actually shopping in, so it keeps ticking open too.
  const calendarEditable = !isGuest && status === "planning";
  const listEditable = !isGuest && (status === "planning" || status === "calendar_closed");
  const canTick = status === "planning" || status === "calendar_closed";
  const openEntry = slot ? plan?.entries.find((e) => e.date === slot.date && e.meal === slot.meal) : undefined;
  const days = weekDays(weekStart);
  // What the shop did not have. Offered to next week when the list closes.
  const unbought = plan?.items.filter((item) => !item.is_checked) ?? [];

  // ── Actions ─────────────────────────────────────────────────────────────────

  /**
   * Put a refreshed plan back where it came from.
   *
   * A mutation can land on your own week or on one you are a guest on — ticking
   * is allowed on both — so "set the plan" is ambiguous now. Routing it by
   * ownership keeps the week selector honest: writing a guest's plan into
   * `ownPlan` would make it look like yours.
   */
  const applyUpdatedPlan = (updated: MealPlan) => {
    if (me?.id && updated.owner_id !== me.id) {
      setSharedPlans((current) => current.map((p) => (p.id === updated.id ? updated : p)));
      return;
    }
    setOwnPlan(updated);
  };

  const shareWith = async (displayName: string): Promise<string | null> => {
    if (!plan) return null;
    try {
      applyUpdatedPlan(await apiClient.sharePlan(plan.id, displayName));
      return null;
    } catch (err) {
      // The API distinguishes "no such person" (404) from "that's you" (422),
      // and both deserve their own sentence — "couldn't share it" would send
      // someone looking at their connection.
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 404) return t("plan.share-unknown-person");
      if (status === 422) return t("plan.share-yourself");
      return err instanceof Error ? err.message : t("plan.share-failed");
    }
  };

  const stopSharing = async (guest: PlanGuest) => {
    if (!plan) return;
    await withPlan(() => apiClient.unsharePlan(plan.id, guest.user_id));
  };

  /** Every mutation re-reads the plan, because one write can move several parts. */
  const withPlan = async (work: () => Promise<MealPlan | void>) => {
    try {
      setError("");
      const updated = await work();
      if (updated) applyUpdatedPlan(updated);
      else await loadPlan(weekStart);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("plan.save-failed"));
    }
  };

  const assign = async (recipe: Recipe | null, name: string, servings: number): Promise<PlanEntry | null> => {
    if (!slot) return null;
    try {
      setError("");
      const updated = await apiClient.assignDish({
        date: slot.date,
        meal: slot.meal,
        recipe_id: recipe?.id ?? null,
        // The name travels with the id and is snapshotted server-side, so the
        // week stays readable after the recipe is deleted (§8.3a).
        dish_name: name,
        servings,
      });
      applyUpdatedPlan(updated);
      return updated.entries.find((e) => e.date === slot.date && e.meal === slot.meal) ?? null;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("plan.save-failed"));
      return null;
    }
  };

  const addToList = async (entry: PlanEntry, lines: ScaledLine[]) => {
    if (!plan || lines.length === 0) return;
    await withPlan(() =>
      apiClient.addToList(
        plan.id,
        lines.map((l) => ({ name: l.name, amount: l.amount, unit: l.unit })),
        entry.id,
        entry.dish_name,
      ),
    );
  };

  const removeEntry = async (entry: PlanEntry, dropFromList: boolean) => {
    if (!plan) return;
    await withPlan(() => apiClient.removeEntry(plan.id, entry.id, dropFromList));
  };

  const tick = (item: ShoppingListItem, checked: boolean) => {
    if (!plan) return;
    // Optimistic: ticking in a shop happens faster than a round trip, and a
    // checkbox that lags reads as a dropped tap and gets pressed twice.
    const flip = (value: boolean) => (current: MealPlan) => ({
      ...current,
      items: current.items.map((i) => (i.id === item.id ? { ...i, is_checked: value } : i)),
    });
    applyUpdatedPlan(flip(checked)(plan));
    void apiClient.tickItem(plan.id, item.id, checked).catch(() => {
      applyUpdatedPlan(flip(!checked)(plan));
      setError(t("plan.save-failed"));
    });
  };

  const advance = async () => {
    if (!plan) return;
    const from = confirming === "finish" ? "planning" : "calendar_closed";
    // Only the list transition carries anything: nothing has been shopped for
    // when the calendar closes, so every line would qualify. The server refuses
    // the other combination too — this just never sends it.
    const carry = confirming === "close" ? [...carryOver] : [];
    setConfirming(null);
    await withPlan(() => apiClient.advancePlan(plan.id, from, carry));
  };

  /** Open a transition's confirmation, seeding what it offers to carry. */
  const askToAdvance = (which: "finish" | "close") => {
    if (which === "close") setCarryOver(new Set(unbought.map((item) => item.id)));
    setConfirming(which);
  };

  const goToWeek = (saturday: string) => {
    setSlot(null);
    // A plan id belongs to one week, so carrying it across would leave `?plan=`
    // pointing at a plan that is not in view. The lookup falls back to your own
    // week, which renders correctly — but the selector would then show *no* chip
    // active while your week is on screen, which looks like a broken control.
    setPlanId(null);
    setWeek(saturday === today ? null : saturday);
  };

  const showPlan = (id: string | null) => {
    // A slot open on your week must not carry into someone else's: the sheet
    // would be addressing a date in a plan you cannot write to.
    setSlot(null);
    setPlanId(id);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <AppShell>
        <PlanSkeleton />
      </AppShell>
    );
  }

  const outstanding = plan?.items.filter((i) => !i.is_checked).length ?? 0;

  return (
    <AppShell userName={userName}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <PagerButton label={t("plan.previous-week")} onClick={() => goToWeek(shiftDate(weekStart, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </PagerButton>
          <div className="px-1">
            <h1 className="font-display text-lg font-bold tracking-tight text-fg sm:text-xl">
              {formatWeekRange(days[0], days[days.length - 1], locale)}
            </h1>
            {/* Stateless on purpose: "next shop" is true of the week after this
                one whenever its list is still open, however you arrived — landed
                here automatically, paged here, or followed a link. A flag set at
                load would go stale the moment you paged away and back. */}
            <p className="text-xs text-muted">
              {weekStart === today
                ? t("plan.this-week")
                : weekStart === shiftDate(today, DAYS_IN_WEEK) && status !== "list_closed"
                  ? t("plan.next-shop")
                  : t(`plan.status-${status.replace("_", "-")}` as "plan.status-planning")}
            </p>
          </div>
          <PagerButton label={t("plan.next-week")} onClick={() => goToWeek(shiftDate(weekStart, 7))}>
            <ChevronRight className="h-4 w-4" />
          </PagerButton>
          {weekStart !== today && (
            <button
              type="button"
              onClick={() => goToWeek(today)}
              className="ml-1 cursor-pointer rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-tomato/40 hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
            >
              {t("plan.back-to-this-week")}
            </button>
          )}
        </div>

        <div className="inline-flex items-center rounded-full border border-line bg-surface p-1">
          {(["calendar", "list"] as PlanView[]).map((option) => {
            const on = view === option;
            const Icon = option === "calendar" ? CalendarDays : ListChecks;
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setSlot(null);
                  setView(option);
                }}
                aria-current={on ? "page" : undefined}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-2 font-display text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50 ${
                  on ? "bg-tomato text-white shadow-pop" : "text-muted hover:text-fg"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t(option === "calendar" ? "plan.view-calendar" : "plan.view-list")}
                {option === "list" && outstanding > 0 && <span className="tabular-nums opacity-70">{outstanding}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border border-tomato/30 bg-tomato/10 px-4 py-3 text-sm font-medium text-tomato-700 dark:text-tomato">
          {error}
        </div>
      )}

      {/* Whose week. Rendered only when there is something to choose between —
          a selector with one option is a label pretending to be a control. */}
      {sharedPlans.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          <WeekChip label={t("plan.your-week")} active={!planId} onClick={() => showPlan(null)} />
          {sharedPlans.map((shared) => (
            <WeekChip
              key={shared.id}
              label={t("plan.shared-by", { name: shared.owner_name ?? "" })}
              active={planId === shared.id}
              onClick={() => showPlan(shared.id)}
            />
          ))}
        </div>
      )}

      {/* What being a guest means, said plainly. Otherwise the disabled slots
          read as the app being broken rather than as someone else's week. */}
      {isGuest && plan && (
        <div className="mb-5 flex items-start gap-2.5 rounded-2xl border border-line bg-surface-2 px-4 py-3 text-sm text-muted">
          <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{t("plan.guest-note", { name: plan.owner_name ?? "" })}</p>
        </div>
      )}

      {/* What the current state permits, said once rather than left to be
          inferred from disabled buttons — v1's transitions are one-way, so the
          consequence is worth a sentence. */}
      {plan && status !== "planning" && (
        <div className="mb-5 flex items-start gap-2.5 rounded-2xl border border-line bg-surface-2 px-4 py-3 text-sm text-muted">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{status === "calendar_closed" ? t("plan.calendar-closed-note") : t("plan.archived-note")}</p>
        </div>
      )}

      {view === "calendar" ? (
        <>
          {!plan && (
            <div className="mb-5">
              <EmptyPanel
                icon={<CalendarDays className="mx-auto mb-3 h-10 w-10 text-muted" aria-hidden />}
                title={t("plan.nothing-planned-title")}
                body={t("plan.nothing-planned-body")}
              />
            </div>
          )}
          <WeekGrid
            weekStart={weekStart}
            plan={plan}
            today={todayIso}
            editable={calendarEditable}
            onOpenSlot={(date, meal) => setSlot({ date, meal })}
          />
        </>
      ) : (
        <ShoppingList
          // Rendered whether or not the week has been planned: adding the first
          // line is what creates the week, so an empty-state panel here instead
          // would be a dead end with the one control you came for missing.
          plan={plan}
          editable={listEditable}
          canTick={canTick}
          onTick={tick}
          onRemove={(item) => {
            if (!plan) return;
            void withPlan(async () => void (await apiClient.removeItem(plan.id, item.id)));
          }}
          // Always the week-keyed route, never the plan-keyed one. It covers
          // both cases — creating the week or merging into it — so there is no
          // branch here that could pick wrong.
          onAddExtra={async (name) => {
            await withPlan(() => apiClient.addToWeekList(weekStart, [{ name }]));
          }}
        />
      )}

      {/* Owner-only: a guest resharing would hand out access the owner never
          granted. Hidden entirely rather than disabled, because there is nothing
          a guest could do with it. */}
      {plan && !isGuest && (
        <div className="mt-8">
          <SharePanel guests={plan.shared_with} onShare={shareWith} onUnshare={stopSharing} />
        </div>
      )}

      {/* The one-way transitions sit at the bottom, out of the way of the thing
          you came here to do. */}
      {plan && !isGuest && status !== "list_closed" && (
        <div className="mt-8 flex justify-end border-t border-line pt-5">
          <button
            type="button"
            onClick={() => askToAdvance(status === "planning" ? "finish" : "close")}
            className="cursor-pointer rounded-full border border-line px-4 py-2.5 text-sm font-semibold text-fg transition-colors hover:border-tomato/50 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            {status === "planning" ? t("plan.finish-week") : t("plan.close-list")}
          </button>
        </div>
      )}

      {slot && (
        <SlotSheet
          plan={plan}
          entry={openEntry}
          dayLabel={formatWeekday(slot.date, locale)}
          mealLabel={t(`plan.${slot.meal}`)}
          recipes={recipes}
          editable={calendarEditable}
          listEditable={listEditable}
          onAssign={assign}
          onAddToList={addToList}
          onRemove={removeEntry}
          onClose={() => setSlot(null)}
          currentUserId={me?.id ?? null}
        />
      )}

      {confirming && (
        <ConfirmModal
          title={t(confirming === "finish" ? "plan.finish-week-title" : "plan.close-list-title")}
          message={
            confirming === "finish" ? (
              t("plan.finish-week-body")
            ) : (
              <>
                <p>{t("plan.close-list-body")}</p>
                {unbought.length > 0 && (
                  <CarryOverPicker
                    items={unbought}
                    chosen={carryOver}
                    onToggle={(itemId) =>
                      setCarryOver((current) => {
                        const next = new Set(current);
                        if (!next.delete(itemId)) next.add(itemId);
                        return next;
                      })
                    }
                  />
                )}
              </>
            )
          }
          confirmLabel={t(confirming === "finish" ? "plan.finish-week" : "plan.close-list")}
          // Not a deletion: a bin here would make an ordinary, if irreversible,
          // step read as destructive.
          icon={<CalendarCheck className="h-5 w-5 text-tomato" />}
          onConfirm={advance}
          onCancel={() => setConfirming(null)}
        />
      )}
    </AppShell>
  );
}

function WeekChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-11 cursor-pointer rounded-full border px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50 ${
        active ? "border-tomato bg-tomato/10 text-tomato" : "border-line text-muted hover:border-tomato/40 hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
}

function PagerButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
    >
      {children}
    </button>
  );
}
