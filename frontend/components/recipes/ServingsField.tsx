"use client";

import { Minus, Plus, Undo2, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { IconButton } from "@/components/ui/Button";

/**
 * How many people the amounts are for — and changing it changes the amounts
 * (ADR 0009 §4).
 *
 * The undo sits right under the number, not in a toast: "No, las cantidades ya
 * eran para 3" is the answer to "did that just change my recipe?", and it has to
 * be where the eye already is. It stays until the next change of the number.
 */
export function ServingsField({
  value,
  onChange,
  fromSource,
  undo,
}: {
  value: number | null;
  onChange: (next: number) => void;
  /** The number was read from the text ("para 4 personas"), and nobody has changed it since. */
  fromSource: boolean;
  undo?: { count: number; onUndo: () => void };
}) {
  const { t } = useI18n();
  const current = value ?? 0;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex items-center gap-1 rounded-full border border-line bg-surface p-1" role="group" aria-label={t("recipe-form.servings")}>
          <Users className="ml-2 mr-0.5 h-4 w-4 text-muted" aria-hidden />
          <IconButton icon={Minus} size="sm" label={t("ingredients-panel.fewer-servings")} disabled={current <= 1} onClick={() => onChange(Math.max(1, current - 1))} />
          <input
            id="servings"
            type="number"
            inputMode="numeric"
            min={1}
            max={99}
            value={value ?? ""}
            placeholder="–"
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              if (Number.isFinite(n) && n >= 1 && n <= 99) onChange(n);
            }}
            aria-label={t("recipe-form.servings")}
            className="w-10 bg-transparent text-center font-display text-base font-semibold tabular-nums text-fg focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <IconButton icon={Plus} size="sm" label={t("ingredients-panel.more-servings")} disabled={current >= 99} onClick={() => onChange(Math.min(99, current + 1))} />
        </div>
        <span className="text-sm text-muted">{current === 1 ? t("recipe-form.per-person") : t("recipe-form.people")}</span>
        {fromSource && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">{t("recipe-form.from-source")}</span>}
      </div>
      {undo && (
        <button
          type="button"
          onClick={undo.onUndo}
          className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full text-xs font-semibold text-accent underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <Undo2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t("recipe-form.servings-undo", { count: undo.count })}
        </button>
      )}
    </div>
  );
}
