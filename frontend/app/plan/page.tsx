"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, DoorOpen, ListChecks, Lock } from "lucide-react";
import { useAuthGate } from "@/components/auth/useAuthGate";
import {
  ApiError,
  apiClient,
  type Aisle,
  type GroceryItem,
  type KitchenMember,
  type KitchenView,
  type CreateRecipeInput,
  type Meal,
  type MealPlan,
  type Person,
  type PlanEntry,
  type Recipe,
  type ShoppingListItem,
} from "@/lib/api-client";
import { currentParams, useBrowserNavigation, useHistoryDepth, writeUrl } from "@/lib/url-state";
import { DAYS_IN_WEEK, fromQuery, homeWeekOf, shiftDate, toQuery, weekDays, weekStartOf, type PlanView } from "@/lib/plan-url";
import type { ScaledLine } from "@/lib/plan-ingredients";
import { entryForDish } from "@/lib/plan-entries";
import { byKey, lineToClassify } from "@/lib/grocery";
import { AppShell } from "@/components/shell/AppShell";
import { PlanSkeleton } from "@/components/ui/PageSkeleton";
import { EmptyPanel } from "@/components/profile/EmptyPanel";
import ConfirmModal from "@/components/ConfirmModal";
import { WeekGrid } from "@/components/plan/WeekGrid";
import { SlotSheet } from "@/components/plan/SlotSheet";
import { ShoppingList } from "@/components/plan/ShoppingList";
import { KitchenBar } from "@/components/plan/KitchenBar";
import { InvitationCard } from "@/components/plan/InvitationCard";
import { CarryOverPicker } from "@/components/plan/CarryOverPicker";
import { useLivePlan } from "@/lib/useLivePlan";
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
 * `calendar_closed` is the shopping state — recipes fixed, list still editable;
 * `list_closed` is archived and read-only. The server enforces all of it and
 * answers 409, so the disabled controls here are a courtesy, not the guard.
 *
 * **The status is now the only thing that gates it** (§8.12). There used to be a
 * second axis — owner or guest — and a guest got a read-only calendar and a
 * banner explaining why. A week belongs to a kitchen now, everybody in it can
 * change everything, and that whole branch is gone along with the week selector
 * that let you switch between your copy and somebody else's.
 */
export default function PlanPage() {
  const { locale, t } = useI18n();

  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState("");
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [kitchen, setKitchen] = useState<KitchenView | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  // The shared grocery vocabulary, for the shopping list's aisle grouping and
  // the manual-add suggestions. Fetched once and never refetched: it changes a
  // handful of times a year. **Empty is a valid state** — the list renders flat
  // and unsuggested rather than waiting or erroring, so a vocabulary that never
  // arrives costs a feature and not the page.
  const [vocabulary, setVocabulary] = useState<GroceryItem[]>([]);
  // Lines the model is still placing in an aisle, by id. See `classifyInBackground`.
  const [classifying, setClassifying] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState("");

  const [view, setView] = useState<PlanView>("calendar");
  const [week, setWeek] = useState<string | null>(null);
  const [slot, setSlot] = useState<{ date: string; meal: Meal } | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"finish" | "close" | "leave" | null>(null);
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

  /**
   * Read one week.
   *
   * `planId` wins when it is set, and the two are genuinely different requests:
   * by date means "the week my kitchen is planning", by id means "this exact
   * week", and they diverge for anybody who has moved between kitchens — an
   * archive row from August belongs to a household they may have left.
   */
  const loadPlan = useCallback(
    async (saturday: string, id: string | null = null): Promise<MealPlan | null> => {
      try {
        setError("");
        const loaded = id ? await apiClient.getPlanById(id) : await apiClient.getPlan(saturday);
        setPlan(loaded);
        return loaded;
      } catch (err) {
        // A plan id that no longer resolves — a stale link, or a kitchen you
        // were never in — falls back to your own week rather than to an error
        // screen. The link stopped working; the page did not.
        if (id) {
          setPlanId(null);
          return loadPlan(saturday);
        }
        setError(err instanceof Error ? err.message : t("plan.load-failed"));
        return null;
      }
    },
    [t],
  );

  const loadKitchen = useCallback(async () => {
    // Never fatal: the planner works perfectly well for one person, and a
    // kitchen that failed to load should cost you the member list, not the week.
    setKitchen(await apiClient.getKitchen().catch(() => null));
  }, []);

  useEffect(() => {
    if (!me?.id || !me.display_name) return;
    let cancelled = false;
    void (async () => {
      // Every recipe is plannable, method or not, so the picker asks
      // for both. The ADR-0007 lens is left unset on purpose.
      const [mine, loaded, groceries] = await Promise.all([
        loadPlan(weekStart, currentParams().get("plan")),
        apiClient.listRecipes().catch(() => [] as Recipe[]),
        // Swallowed on purpose, like the recipes above: this is decoration on a
        // page whose job is the week and the list.
        apiClient.listGroceryItems().catch(() => [] as GroceryItem[]),
        loadKitchen(),
      ]);
      if (cancelled) return;
      setRecipes(loaded);
      setVocabulary(groceries);

      // **The home week is the one you are shopping for next**, not the one the
      // calendar happens to be in. Once this week's list is closed the shopping
      // is home, and anything you think of for the rest of the week belongs to
      // the next shop — so that is where the planner opens.
      //
      // Only when the URL did not name a week: a link to a specific week must
      // land on it, closed or not. One hop only; two closed weeks in a row means
      // you planned a fortnight ahead, and guessing further would be guessing.
      const home = homeWeekOf(weekStart, mine?.status);
      if (!currentParams().get("week") && !currentParams().get("plan") && home !== weekStart) {
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
    void loadPlan(weekStart, planId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, planId]);

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

  const status = plan?.status ?? "planning";
  // **Two gates, both about the plan's state and neither about who you are.**
  // Everybody in the kitchen has the same reach (§8.12); what varies is how far
  // the week has got. `calendar_closed` is the state you are actually shopping
  // in, so it keeps the list and the ticking open.
  const calendarEditable = status === "planning";
  const listEditable = status === "planning" || status === "calendar_closed";
  // The one week you can see but not touch: one planned in a kitchen you have
  // since left, reached from the archive. The server refuses the writes; this
  // keeps the controls from offering them.
  const readOnly = Boolean(kitchen && plan && plan.kitchen_id !== kitchen.kitchen.id);
  // Every dish in the open slot, not one. Derived from `plan` rather than held
  // in state so removing a dish inside the sheet updates the sheet's own list.
  const openEntries = slot ? (plan?.entries.filter((e) => e.date === slot.date && e.meal === slot.meal) ?? []) : [];
  const days = weekDays(weekStart);
  // What the shop did not have. Offered to next week when the list closes.
  const unbought = plan?.items.filter((item) => !item.is_checked) ?? [];
  const sharedKitchen = (kitchen?.kitchen.members.length ?? 0) > 1;

  // ── Live ────────────────────────────────────────────────────────────────────

  // Only the shopping list, and only when somebody else could be changing it.
  // The calendar gets filled in by one person at a time; the list is the screen
  // two people have open in the same shop. See `useLivePlan` for the rest of the
  // gates and for why this polls rather than holding a connection open.
  useLivePlan({
    enabled: sharedKitchen && view === "list" && Boolean(plan) && status !== "list_closed",
    onRefresh: () => void loadPlan(weekStart, planId),
  });

  // ── Actions ─────────────────────────────────────────────────────────────────

  const applyUpdatedPlan = (updated: MealPlan) => setPlan(updated);

  /** Stable, because `KitchenBar` fetches on first open and an unstable identity would refetch on every render. */
  const loadPeople = useCallback(() => apiClient.listInvitablePeople(), []);

  const invite = async (person: Person): Promise<string | null> => {
    try {
      const updated = await apiClient.inviteToKitchen(person.id);
      setKitchen((current) => (current ? { ...current, kitchen: updated } : current));
      return null;
    } catch (err) {
      // 404 and 422 both mean the picker was drawn before something changed —
      // they left SAM, or somebody else asked them in the meantime. The server
      // carries the sentence that says which, because it is the one that knows.
      if (err instanceof ApiError && err.message) return err.message;
      return err instanceof Error ? err.message : t("kitchen.invite-failed");
    }
  };

  const withdraw = async (member: KitchenMember) => {
    try {
      const updated = await apiClient.removeFromKitchen(member.user_id);
      setKitchen((current) => (current ? { ...current, kitchen: updated } : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("plan.save-failed"));
    }
  };

  const answerInvitation = async (kitchenId: string, accept: boolean) => {
    try {
      setError("");
      setKitchen(await apiClient.answerInvitation(kitchenId, accept));
      // Accepting *moves* you: the week on screen belonged to the kitchen you
      // just left, so it has to be re-read rather than patched.
      if (accept) {
        setPlanId(null);
        await loadPlan(weekStart);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("kitchen.answer-failed"));
    }
  };

  const leaveKitchen = async () => {
    setConfirming(null);
    try {
      setError("");
      await apiClient.removeFromKitchen(me?.id ?? "");
      await loadKitchen();
      setPlanId(null);
      await loadPlan(weekStart);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("plan.save-failed"));
    }
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

  /**
   * Take a write that may have created vocabulary rows, and show its result.
   *
   * **The vocabulary first, then the plan.** A line whose new key the client
   * cannot look up yet would render in `Other` for one frame and then jump —
   * exactly the move this whole feature exists to make once, not twice. If the
   * vocabulary refetch fails, the plan still lands: a line in `Other` is the
   * degraded case the list already handles.
   */
  const applyWithVocabulary = async (updated: MealPlan) => {
    const groceries = await apiClient.listGroceryItems().catch(() => null);
    if (groceries) setVocabulary(groceries);
    applyUpdatedPlan(updated);
  };

  /**
   * Ask the model where a hand-typed line goes, **after** it is already on the list.
   *
   * Fire-and-forget on purpose (ingredient-capture-plan §6.2): adding by hand
   * never waits on a model, so the line appears instantly in `Other` and moves
   * when the answer arrives. A provider that is down or slow costs nothing but
   * the move — the "which aisle?" question on the line is still there to answer
   * by hand, and the server ignores the model for a line somebody filed first.
   */
  const classifyInBackground = (updated: MealPlan, typed: string) => {
    const line = lineToClassify(updated, typed, byKey(vocabulary));
    if (!line) return;
    const done = () =>
      setClassifying((current) => {
        const next = new Set(current);
        next.delete(line.id);
        return next;
      });
    setClassifying((current) => new Set(current).add(line.id));
    void apiClient
      .classifyListItem(updated.id, line.id)
      .then(applyWithVocabulary)
      // Silent: nothing failed that the person needs to act on. The line is
      // saved; only the guess about its aisle is missing.
      .catch(() => undefined)
      .finally(done);
  };

  const fileAisle = async (item: ShoppingListItem, aisle: Aisle) => {
    if (!plan) return;
    try {
      setError("");
      await applyWithVocabulary(await apiClient.fileListItem(plan.id, item.id, aisle));
    } catch {
      setError(t("plan.save-failed"));
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
      // The dish that was just written, not whichever one is first in the slot
      // — see `entryForDish`. With several dishes to a slot the difference is
      // the sheet opening the wrong one's ingredients.
      return entryForDish(updated.entries, slot, recipe?.id ?? null, name);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("plan.save-failed"));
      return null;
    }
  };

  /**
   * Save a dish invented inside the slot sheet (§5.3).
   *
   * It joins `recipes` immediately rather than waiting for a refetch: the sheet
   * assigns it in the same breath and then reads its ingredients back out of
   * that list, and a round trip in between is a visible flicker on the one
   * screen this feature exists to keep unbroken.
   */
  const createRecipe = async (input: CreateRecipeInput): Promise<Recipe | null> => {
    try {
      setError("");
      const created = await apiClient.createRecipe(input);
      setRecipes((prev) => [...prev, created]);
      return created;
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

  /**
   * Rebuild one dish's shopping-list lines at its current headcount.
   *
   * Only ever after the user agrees — the list never rewrites itself (§4.5), and
   * the sheet asks before calling this.
   */
  const resyncList = async (entry: PlanEntry, lines: ScaledLine[]) => {
    if (!plan) return;
    await withPlan(() =>
      apiClient.resyncEntryList(
        plan.id,
        entry.id,
        entry.dish_name,
        lines.map((l) => ({ name: l.name, amount: l.amount, unit: l.unit })),
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
    // A plan id names one exact week, so carrying it across would leave `?plan=`
    // pointing at a week that is not the one on screen. Paging means "the week
    // my kitchen is planning", which is the date lookup.
    setPlanId(null);
    setWeek(saturday === today ? null : saturday);
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

        <div className="flex items-center gap-2">
          {/* Beside the view toggle rather than at the foot of the page, where
              the share panel used to live. Who you are planning with is context
              for everything below it, not a footnote after it. */}
          {kitchen && (
            <KitchenBar
              kitchen={kitchen.kitchen}
              currentUserId={me?.id ?? null}
              onInvite={invite}
              onLoadPeople={loadPeople}
              onWithdraw={withdraw}
              onLeave={() => setConfirming("leave")}
            />
          )}

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
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border border-tomato/30 bg-tomato/10 px-4 py-3 text-sm font-medium text-tomato-700 dark:text-tomato">
          {error}
        </div>
      )}

      {/* Addressed *to you*, so it is on the page rather than inside the kitchen
          dropdown — which is a control you may never open, because its face
          already answers the only question it usually has. */}
      {kitchen?.invitations.map((invite) => (
        <InvitationCard key={invite.kitchen_id} invite={invite} onAnswer={(accept) => answerInvitation(invite.kitchen_id, accept)} />
      ))}

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
            editable={calendarEditable && !readOnly}
            onOpenSlot={(date, meal) => setSlot({ date, meal })}
            currentUserId={me?.id ?? null}
          />
        </>
      ) : (
        <ShoppingList
          vocabulary={vocabulary}
          // Rendered whether or not the week has been planned: adding the first
          // line is what creates the week, so an empty-state panel here instead
          // would be a dead end with the one control you came for missing.
          plan={plan}
          editable={listEditable && !readOnly}
          onTick={tick}
          currentUserId={me?.id ?? null}
          onRemove={(item) => {
            if (!plan) return;
            void withPlan(async () => void (await apiClient.removeItem(plan.id, item.id)));
          }}
          // Always the week-keyed route, never the plan-keyed one. It covers
          // both cases — creating the week or merging into it — so there is no
          // branch here that could pick wrong.
          onAddExtra={async (name) => {
            await withPlan(async () => {
              const updated = await apiClient.addToWeekList(weekStart, [{ name }]);
              classifyInBackground(updated, name);
              return updated;
            });
          }}
          onFileAisle={fileAisle}
          classifying={classifying}
        />
      )}

      {/* The one-way transitions sit at the bottom, out of the way of the thing
          you came here to do. */}
      {plan && !readOnly && status !== "list_closed" && (
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
          entries={openEntries}
          dayLabel={formatWeekday(slot.date, locale)}
          mealLabel={t(`plan.${slot.meal}`)}
          recipes={recipes}
          vocabulary={vocabulary}
          editable={calendarEditable && !readOnly}
          listEditable={listEditable && !readOnly}
          onAssign={assign}
          onCreateRecipe={createRecipe}
          onAddToList={addToList}
          onResyncList={resyncList}
          onRemove={removeEntry}
          onClose={() => setSlot(null)}
          currentUserId={me?.id ?? null}
        />
      )}

      {confirming === "leave" && (
        <ConfirmModal
          title={t("kitchen.leave-title")}
          message={t("kitchen.leave-body")}
          confirmLabel={t("kitchen.leave")}
          icon={<DoorOpen className="h-5 w-5 text-tomato" />}
          onConfirm={leaveKitchen}
          onCancel={() => setConfirming(null)}
        />
      )}

      {(confirming === "finish" || confirming === "close") && (
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
