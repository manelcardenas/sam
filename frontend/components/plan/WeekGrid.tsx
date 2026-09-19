"use client";

import { Check, Plus, ShoppingBasket, Users } from "lucide-react";
import type { Meal, MealPlan, PlanEntry } from "@/lib/api-client";
import { PersonMark } from "@/components/ui/PersonMark";
import { weekDays } from "@/lib/plan-url";
import { linesFromEntry } from "@/lib/plan-ingredients";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { formatWeekday, formatDayAndMonth } from "@/lib/format";

const MEALS: Meal[] = ["lunch", "dinner"];

/**
 * The week: five days, two slots each (docs/plans/meal-planner-plan.md §4.7).
 *
 * **One column per day on desktop, one card per day on mobile.** Not a table
 * either way — a 5×2 table reads as a spreadsheet on a phone and needs
 * horizontal scrolling to hold a recipe name, which is the one thing each cell
 * exists to show. Days stack; slots stay side by side inside a day, because
 * lunch and dinner are the comparison you actually make.
 *
 * Today is marked, and past days are dimmed rather than hidden: you plan on
 * Saturday for the week ahead, but you also open this on Wednesday to see what
 * Wednesday was, and a week that erases its own history as it goes is useless
 * for that.
 */
export function WeekGrid({
  weekStart,
  plan,
  today,
  editable,
  onOpenSlot,
  currentUserId,
}: {
  weekStart: string;
  plan: MealPlan | null;
  today: string;
  editable: boolean;
  onOpenSlot: (date: string, meal: Meal) => void;
  /** So a slot somebody else in the kitchen filled can say so. */
  currentUserId: string | null;
}) {
  const { locale, t } = useI18n();

  const entriesAt = (date: string, meal: Meal): PlanEntry[] =>
    plan?.entries.filter((e) => e.date === date && e.meal === meal) ?? [];

  /**
   * How much of this slot has reached the shopping list — the answer to "did I
   * already add this?", which is otherwise invisible until you open it.
   *
   * **Three states, not two.** With one dish per slot this was a boolean. Now a
   * slot can be half done, and showing "some" as "all" is the version that sends
   * you home without the rice.
   */
  const listState = (entries: PlanEntry[]): "none" | "some" | "all" => {
    const added = entries.filter((entry) => linesFromEntry(plan?.items ?? [], entry).length > 0).length;
    if (added === 0) return "none";
    return added === entries.length ? "all" : "some";
  };

  return (
    // Seven across from lg, not a ragged wrap. A calendar that breaks 4 + 3
    // stops reading as a week — the row *is* the information. Columns land near
    // 138px at 1024, which the slot survives because the name is clamped to two
    // lines and everything else on the card is an icon or a short label.
    <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7 lg:gap-2">
      {weekDays(weekStart).map((date, index) => {
        const isToday = date === today;
        const isPast = date < today;
        return (
          <li
            key={date}
            className={`rounded-3xl border bg-surface p-3 transition-colors ${
              isToday ? "border-tomato/50 shadow-paw" : "border-line"
            } ${isPast && !isToday ? "opacity-60" : ""} will-fetch animate-fetch-in`}
            style={{ animationDelay: `${index * 40}ms` }}
          >
            <div className="mb-2.5 flex items-baseline justify-between gap-2 px-1">
              <h3 className={`font-display text-sm font-bold uppercase tracking-wide ${isToday ? "text-tomato" : "text-fg"}`}>
                {formatWeekday(date, locale)}
              </h3>
              <span className="text-[0.7rem] tabular-nums text-muted">{formatDayAndMonth(date, locale)}</span>
            </div>

            <div className="space-y-2">
              {MEALS.map((meal) => {
                const entries = entriesAt(date, meal);
                return (
                  <Slot
                    key={meal}
                    entries={entries}
                    onList={listState(entries)}
                    editable={editable}
                    onClick={() => onOpenSlot(date, meal)}
                    mealLabel={t(`plan.${meal}`)}
                    currentUserId={currentUserId}
                  />
                );
              })}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Slot({
  entries,
  onList,
  editable,
  onClick,
  mealLabel,
  currentUserId,
}: {
  /** Everything planned for this meal, oldest first. Empty is the normal case. */
  entries: PlanEntry[];
  onList: "none" | "some" | "all";
  editable: boolean;
  onClick: () => void;
  mealLabel: string;
  currentUserId: string | null;
}) {
  const { t, tp } = useI18n();

  // An empty slot is normal, not an error (§6) — so it reads as an invitation
  // rather than as something missing.
  if (entries.length === 0) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={!editable}
        aria-label={`${mealLabel}: ${t("plan.add-recipe")}`}
        className="flex min-h-[4.25rem] w-full cursor-pointer flex-col items-start justify-center gap-1 rounded-2xl border border-dashed border-line px-3 py-2.5 text-left transition-colors hover:border-tomato/50 hover:bg-tomato/5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line disabled:hover:bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
      >
        <span className="text-[0.7rem] font-bold uppercase tracking-wider text-muted">{mealLabel}</span>
        <span className="flex items-center gap-1.5 text-sm text-muted">
          {editable && <Plus className="h-3.5 w-3.5" aria-hidden />}
          {editable ? t("plan.add-recipe") : t("plan.empty-slot")}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${mealLabel}: ${entries.map((entry) => entry.dish_name).join(", ")}`}
      className="flex min-h-[4.25rem] w-full cursor-pointer flex-col items-start gap-1 rounded-2xl border border-line bg-surface-2 px-3 py-2.5 text-left transition-colors hover:border-tomato/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="text-[0.7rem] font-bold uppercase tracking-wider text-muted">{mealLabel}</span>
        {/* Whether the shopping list already knows about this slot. Not
            decoration: skipping the ingredient step is allowed, and without this
            the only way to find out is to open every slot. A half-done slot gets
            its own look — reading "some" as "all" is what sends you home without
            the rice. */}
        <span
          className={`flex shrink-0 items-center gap-1 text-[0.65rem] font-semibold ${
            onList === "all" ? "text-leaf-700 dark:text-leaf" : onList === "some" ? "text-amber-600 dark:text-amber" : "text-muted"
          }`}
          title={t(`plan.list-state-${onList}`)}
        >
          {onList === "all" ? <Check className="h-3 w-3" aria-hidden /> : <ShoppingBasket className="h-3 w-3" aria-hidden />}
          <span className="sr-only">{t(`plan.list-state-${onList}`)}</span>
        </span>
      </span>

      {/* Up to three names, one line each. Past that the card would grow taller
          than the day it sits in, and the count is the useful part anyway. */}
      <span className="w-full space-y-0.5">
        {entries.slice(0, 3).map((entry) => (
          <span key={entry.id} className="line-clamp-1 block w-full text-sm font-semibold leading-snug text-fg [overflow-wrap:anywhere]">
            {entry.dish_name}
          </span>
        ))}
        {entries.length > 3 && <span className="block text-[0.7rem] text-muted">{t("plan.more-dishes", { count: String(entries.length - 3) })}</span>}
      </span>

      <span className="flex w-full items-center gap-1 text-[0.7rem] text-muted">
        <Users className="h-3 w-3" aria-hidden />
        {/* One headcount for the slot. The schema keeps it per dish so an
            override stays possible without a migration, but "Carne ×2, Arroz ×4"
            reads as a bug to almost everybody, so the card shows the largest —
            the number of people actually eating. */}
        {tp("plan.for-people", Math.max(...entries.map((entry) => entry.servings)))}
        {/* Pushed to the end of the footer rather than sitting under the dish
            names: at 138px wide they already wrap, and a badge beside one would
            take another line. */}
        <span className="ml-auto flex items-center gap-0.5">
          {[...new Map(entries.map((entry) => [entry.created_by, entry])).values()].map((entry) => (
            <PersonMark
              key={entry.id}
              userId={entry.created_by}
              name={entry.created_by_name}
              currentUserId={currentUserId}
              label={(name) => t("kitchen.planned-by", { name })}
            />
          ))}
        </span>
      </span>
    </button>
  );
}
