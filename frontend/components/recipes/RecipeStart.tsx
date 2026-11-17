"use client";

import { useRef, useState, type ReactNode } from "react";
import { Camera, ChevronRight, ClipboardPaste, Link2, PencilLine, Salad, type LucideIcon } from "lucide-react";
import { ApiError, apiClient, type RecipeDraft, type RecipeImportSource } from "@/lib/api-client";
import { photoAsDataUrl } from "@/lib/photo";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { DeepSeekMark } from "@/components/brand/DeepSeekMark";
import { Button } from "@/components/ui/Button";

/** Where a draft came from — what the review shows alongside the rows, and whether it can be read again. */
export type DraftOrigin = { kind: "text"; text: string } | { kind: "url"; url: string } | { kind: "photo" };

export type ManualKind = "simple" | "full";

type Way = "text" | "url" | "photo";

/**
 * How a new recipe starts (docs/plans/meal-plan-phase-1.md §1.2).
 *
 * **Four ways in, as rows rather than tiles**, because each one is a sentence
 * of explanation and a phone has room for a list of sentences, not a grid of
 * them. The first three are read by the model into a draft to review; the
 * fourth — a simple recipe per person, "ensalada con carne" — needs no model at
 * all and goes straight to the form.
 *
 * Text and link open inline under their row, so the thumb that tapped stays
 * where it was; the photo opens the phone's own picker (camera or gallery).
 * Whatever goes wrong, writing it by hand is one tap away: a model that is down
 * must never stand between somebody and their recipe.
 */
export function RecipeStart({ onDraft, onManual }: { onDraft: (draft: RecipeDraft, origin: DraftOrigin) => void; onManual: (kind: ManualKind) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<Way | null>(null);
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [reading, setReading] = useState<Way | null>(null);
  const [error, setError] = useState<{ way: Way; message: string } | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const read = async (way: Way, source: RecipeImportSource, origin: DraftOrigin) => {
    setReading(way);
    setError(null);
    try {
      onDraft(await apiClient.importRecipe(source), origin);
    } catch (err) {
      // 422 on a link is the page's fault and has its own way out (paste the
      // text); anything else is the model, and the way out is to write it.
      const linkRefused = way === "url" && err instanceof ApiError && err.status === 422;
      setError({ way, message: linkRefused ? t("recipe-start.link-failed") : t("recipe-start.failed") });
    } finally {
      setReading(null);
    }
  };

  const readText = () => {
    const trimmed = text.trim();
    if (trimmed) void read("text", { text: trimmed }, { kind: "text", text: trimmed });
  };

  const readUrl = () => {
    const trimmed = url.trim();
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      new URL(withScheme);
    } catch {
      setError({ way: "url", message: t("recipe-start.link-invalid") });
      return;
    }
    void read("url", { url: withScheme }, { kind: "url", url: withScheme });
  };

  const readPhoto = async (file: File | undefined) => {
    if (!file) return;
    setOpen("photo");
    setReading("photo");
    setError(null);
    let image: string;
    try {
      image = await photoAsDataUrl(file);
    } catch {
      setReading(null);
      setError({ way: "photo", message: t("recipe-start.photo-unreadable") });
      return;
    }
    await read("photo", { image }, { kind: "photo" });
  };

  const busy = reading !== null;

  return (
    <div className="space-y-5">
      <p className="text-muted">{t("recipe-start.intro")}</p>

      <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface">
        <Way
          icon={ClipboardPaste}
          title={t("recipe-start.text")}
          hint={t("recipe-start.text-hint")}
          expanded={open === "text"}
          disabled={busy && reading !== "text"}
          onSelect={() => setOpen(open === "text" ? null : "text")}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            maxLength={20_000}
            autoFocus
            aria-label={t("recipe-start.text")}
            placeholder={t("recipe-start.text-placeholder")}
            className="w-full resize-y rounded-2xl border border-line bg-bg px-4 py-3 text-sm leading-relaxed text-fg placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <ReadAction busy={reading === "text"} disabled={!text.trim()} onClick={readText} />
        </Way>

        <Way
          icon={Link2}
          title={t("recipe-start.url")}
          hint={t("recipe-start.url-hint")}
          expanded={open === "url"}
          disabled={busy && reading !== "url"}
          onSelect={() => setOpen(open === "url" ? null : "url")}
        >
          <input
            type="url"
            inputMode="url"
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                readUrl();
              }
            }}
            aria-label={t("recipe-start.url")}
            placeholder="https://…"
            className="w-full rounded-2xl border border-line bg-bg px-4 py-3 text-sm text-fg placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <ReadAction busy={reading === "url"} disabled={!url.trim()} onClick={readUrl} />
        </Way>

        <Way
          icon={Camera}
          title={t("recipe-start.photo")}
          hint={t("recipe-start.photo-hint")}
          expanded={open === "photo" && (reading === "photo" || error?.way === "photo")}
          disabled={busy && reading !== "photo"}
          onSelect={() => photoInput.current?.click()}
        >
          {reading === "photo" && <Reading />}
        </Way>

        <Way icon={Salad} title={t("recipe-start.simple")} hint={t("recipe-start.simple-hint")} expanded={false} disabled={busy} onSelect={() => onManual("simple")} />
      </ul>

      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void readPhoto(e.target.files?.[0]);
          // Cleared so picking the same photo again still fires a change.
          e.target.value = "";
        }}
      />

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-amber/10 px-4 py-3 text-sm text-fg">
          <span>{error.message}</span>
          <Button variant="secondary" size="sm" icon={PencilLine} onClick={() => onManual("full")}>
            {t("recipe-start.by-hand")}
          </Button>
        </div>
      )}

      <div className="flex justify-center">
        <Button variant="ghost" size="sm" icon={PencilLine} onClick={() => onManual("full")} disabled={busy}>
          {t("recipe-start.or-by-hand")}
        </Button>
      </div>
    </div>
  );
}

function Way({
  icon: Icon,
  title,
  hint,
  expanded,
  disabled,
  onSelect,
  children,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  expanded: boolean;
  disabled: boolean;
  onSelect: () => void;
  children?: ReactNode;
}) {
  return (
    <li className={expanded ? "bg-surface-2/40" : undefined}>
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        aria-expanded={children ? expanded : undefined}
        className="flex w-full cursor-pointer items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-surface-2/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50 sm:px-5"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display font-semibold text-fg">{title}</span>
          <span className="mt-0.5 block text-sm leading-snug text-muted">{hint}</span>
        </span>
        <ChevronRight className={`h-4 w-4 shrink-0 text-muted transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} aria-hidden />
      </button>
      {expanded && children && <div className="space-y-3 px-4 pb-4 sm:px-5">{children}</div>}
    </li>
  );
}

function ReadAction({ busy, disabled, onClick }: { busy: boolean; disabled: boolean; onClick: () => void }) {
  const { t } = useI18n();
  if (busy) return <Reading />;
  return (
    <div className="flex justify-end">
      {/* The model's mark as the icon: it says who will read this, as the
          ingredient box always has. */}
      <Button onClick={onClick} disabled={disabled}>
        <DeepSeekMark className="-mt-0.5 mr-2 inline h-4 w-4 align-middle" />
        {t("recipe-start.read")}
      </Button>
    </div>
  );
}

/** The wait, said plainly: a few seconds, and what is happening in them. */
function Reading() {
  const { t } = useI18n();
  return (
    <p role="status" className="flex items-center gap-2.5 rounded-2xl bg-surface px-4 py-3 text-sm text-muted">
      <DeepSeekMark className="h-4 w-4 shrink-0 animate-pulse text-accent motion-reduce:animate-none" />
      <span>
        <span className="font-semibold text-fg">{t("recipe-start.reading")}</span> {t("recipe-start.reading-hint")}
      </span>
    </p>
  );
}
