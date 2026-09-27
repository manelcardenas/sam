"use client";

import Link from "next/link";
import { CalendarCheck, CalendarPlus } from "lucide-react";
import type { MealPlan, Recipe } from "@/lib/api-client";
import { toQuery, INITIAL_STATE } from "@/lib/plan-url";
import { formatWeekday } from "@/lib/format";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * A recipe's way into the week, and the week's way back to it.
 *
 * The planner could reach a recipe (the slot sheet links to it) but a recipe
 * could not reach the planner: deciding "lentejas on Thursday" while reading the
 * lentejas meant leaving for `/plan`, finding Thursday, and searching for the
 * dish you were already looking at. "Plan it" carries the recipe across and the
 * next slot you open starts with it picked (`?place=`).
 *
 * **When it is already in this week, it says where**, each one a link to that
 * meal — so the recipe page answers "are we having this?" without a trip.
 * Only the current week: that is the one being cooked, and a list of every
 * future and past week would be a history nobody asked this page for.
 */
export function RecipePlanRow({ recipe, week }: { recipe: Recipe; week: MealPlan | null }) {
  const { t, locale } = useI18n();
  const planned = (week?.entries ?? []).filter((e) => e.recipe_id === recipe.id);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`/plan?${toQuery({ ...INITIAL_STATE, place: recipe.id })}`}
        className="inline-flex items-center gap-1.5 rounded-full bg-tomato px-4 py-2 font-display text-sm font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
      >
        <CalendarPlus className="h-4 w-4" aria-hidden />
        {t("dashboard.plan-it")}
      </Link>
      {planned.map((entry) => (
        <Link
          key={entry.id}
          href={`/plan?${toQuery({ ...INITIAL_STATE, slot: { date: entry.date, meal: entry.meal } })}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-leaf/40 bg-leaf/10 px-3 py-1.5 text-xs font-semibold text-leaf-700 transition-colors hover:border-leaf dark:text-leaf focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
        >
          <CalendarCheck className="h-3.5 w-3.5" aria-hidden />
          {t("dashboard.planned-on", { day: formatWeekday(entry.date, locale), meal: t(`plan.${entry.meal}`).toLowerCase() })}
        </Link>
      ))}
    </div>
  );
}
