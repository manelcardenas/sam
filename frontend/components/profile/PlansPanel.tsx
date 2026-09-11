"use client";

import { ChevronLeft, ChevronRight, CalendarRange, Users } from "lucide-react";
import type { PlanSummary } from "@/lib/api-client";
import { EmptyPanel } from "@/components/profile/EmptyPanel";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { formatWeekRange, parseDateOnly } from "@/lib/format";
import { weekEndOf } from "@/lib/plan-url";

/**
 * The year view (docs/plans/meal-planner-plan.md §5.3).
 *
 * This is the payoff for two decisions that look modest on their own: entries
 * keyed to real dates (§4.4) and a shopping list that is a saved artifact rather
 * than a computed view (§4.5). A rolling week overwritten every Saturday could not
 * answer *"what did we eat in August?"* at all, and a recomputed list would
 * answer it with today's recipes instead of what was actually bought.
 *
 * **Grouped by month, and empty months are not drawn.** A 52-cell grid of the
 * whole year was the obvious shape and the wrong one: most weeks are not
 * planned, so it would be mostly empty, and cells small enough to fit 52 across
 * a phone are below the 44px touch target. Listing the weeks that exist shows
 * the same thing — when you planned, and how consistently — at a size you can
 * actually tap.
 */
export function PlansPanel({
  year,
  weeks,
  loading,
  onYearChange,
  onOpen,
}: {
  year: number;
  weeks: PlanSummary[];
  loading: boolean;
  onYearChange: (year: number) => void;
  onOpen: (week: PlanSummary) => void;
}) {
  const { locale, t, tp } = useI18n();

  // Grouped in render order, which the API already gives us newest-first — so
  // months come out newest-first too without a second sort to keep in step.
  const months = new Map<string, PlanSummary[]>();
  for (const week of weeks) {
    const key = parseDateOnly(week.week_start).toLocaleDateString(locale, { month: "long", year: "numeric" });
    months.set(key, [...(months.get(key) ?? []), week]);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <YearButton label={t("profile.plans-previous-year")} onClick={() => onYearChange(year - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </YearButton>
          <span className="min-w-[3.5rem] text-center font-display text-xl font-bold tabular-nums text-fg">{year}</span>
          <YearButton label={t("profile.plans-next-year")} onClick={() => onYearChange(year + 1)}>
            <ChevronRight className="h-4 w-4" />
          </YearButton>
        </div>
        {weeks.length > 0 && <span className="text-sm text-muted">{tp("profile.plans-count", weeks.length)}</span>}
      </div>

      {loading ? (
        // Real heights, so the page does not jump when the year lands.
        <div aria-hidden className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton animate-sweep h-[4.5rem] rounded-2xl" />
          ))}
        </div>
      ) : weeks.length === 0 ? (
        <EmptyPanel
          icon={<CalendarRange className="mx-auto mb-3 h-10 w-10 text-muted" aria-hidden />}
          title={t("profile.plans-empty-title")}
          body={t("profile.plans-year-empty", { year: String(year) })}
        />
      ) : (
        <div className="space-y-5">
          {[...months].map(([month, monthWeeks]) => (
            <section key={month}>
              <h3 className="mb-2 px-1 font-display text-xs font-bold uppercase tracking-wider text-muted">{month}</h3>
              <ul className="space-y-2">
                {monthWeeks.map((week) => (
                  <li key={week.id}>
                    <WeekRow week={week} onOpen={() => onOpen(week)} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function WeekRow({ week, onOpen }: { week: PlanSummary; onOpen: () => void }) {
  const { locale, t, tp } = useI18n();
  const bought = week.item_count > 0;
  // `checked / total`, clamped — a hand-edited list can in principle report more
  // checked than it holds, and a bar past 100% reads as a rendering bug.
  const progress = bought ? Math.min(100, Math.round((week.checked_count / week.item_count) * 100)) : 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${t("profile.plans-open")}: ${formatWeekRange(week.week_start, weekEndOf(week.week_start), locale)}`}
      className="group flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left transition-[border-color,transform] hover:-translate-y-0.5 hover:border-tomato/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
    >
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-display text-sm font-semibold text-fg transition-colors group-hover:text-tomato">
            {formatWeekRange(week.week_start, weekEndOf(week.week_start), locale)}
          </span>
          {/* Whose week it was. Only shown when it isn't yours — labelling your
              own weeks with your own name is noise on every row. */}
          {!week.is_mine && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[0.65rem] font-semibold text-muted">
              <Users className="h-3 w-3" aria-hidden />
              {t("profile.plans-shared-by", { name: week.owner_name ?? "" })}
            </span>
          )}
        </span>
        <span className="mt-1 block text-xs text-muted">
          {tp("profile.plans-recipes", week.entry_count)}
          {bought && ` · ${t("profile.plans-bought", { checked: String(week.checked_count), total: String(week.item_count) })}`}
        </span>
      </span>

      {bought && (
        <span className="flex w-12 shrink-0 flex-col items-end gap-1" aria-hidden>
          <span className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <span
              className="block h-full rounded-full bg-leaf transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </span>
        </span>
      )}
    </button>
  );
}

function YearButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
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
