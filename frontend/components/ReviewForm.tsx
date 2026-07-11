"use client";

import { useState } from "react";
import { Save, X } from "lucide-react";
import type { CreateReviewInput } from "@/lib/api-client";

interface ReviewFormProps {
  onSubmit: (data: CreateReviewInput) => Promise<void>;
  onCancel: () => void;
}

type ScoreKey = "location_score" | "food_score" | "service_score" | "value_score";

const CATEGORIES: { key: ScoreKey; label: string; hint: string }[] = [
  { key: "location_score", label: "Location & decoration", hint: "Ambiance, setting, decor" },
  { key: "food_score", label: "Food", hint: "Taste, quality, presentation" },
  { key: "service_score", label: "Service", hint: "Staff, attentiveness, pace" },
  { key: "value_score", label: "Value", hint: "Was it worth the price?" },
];

/** Today's date as "YYYY-MM-DD" in the local timezone (not UTC, to avoid an off-by-one). */
function todayIsoDate(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function ScoreSlider({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <label className="text-sm font-semibold text-fg">{label}</label>
        <span className="rounded-full bg-tomato/15 px-2.5 py-0.5 text-sm font-bold text-tomato">
          {value.toFixed(1)}
        </span>
      </div>
      <p className="mb-2 text-xs text-muted">{hint}</p>
      <input
        type="range"
        min={0}
        max={10}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-tomato"
        aria-label={label}
      />
    </div>
  );
}

export default function ReviewForm({ onSubmit, onCancel }: ReviewFormProps) {
  const [scores, setScores] = useState<Record<ScoreKey, number>>({
    location_score: 5,
    food_score: 5,
    service_score: 5,
    value_score: 5,
  });
  const [comment, setComment] = useState("");
  const [visitedAt, setVisitedAt] = useState(todayIsoDate());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const overall = (scores.location_score + scores.food_score + scores.service_score + scores.value_score) / 4;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!visitedAt) {
      setError("Pick the date you went.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        ...scores,
        comment: comment.trim() || undefined,
        visited_at: visitedAt,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-2xl border border-tomato/30 bg-tomato/10 px-4 py-3 text-sm font-medium text-tomato-700 dark:text-tomato">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-dashed border-line p-4 text-center">
        <p className="text-xs font-bold uppercase tracking-wider text-muted">Overall</p>
        <p className="font-display text-3xl font-bold text-tomato">{overall.toFixed(1)}</p>
        <p className="text-xs text-muted">Average of the 4 scores below</p>
      </div>

      {CATEGORIES.map((c) => (
        <ScoreSlider
          key={c.key}
          label={c.label}
          hint={c.hint}
          value={scores[c.key]}
          onChange={(v) => setScores((prev) => ({ ...prev, [c.key]: v }))}
        />
      ))}

      <div>
        <label htmlFor="visited_at" className="mb-1.5 block text-sm font-semibold text-fg">
          Date you went
        </label>
        <input
          id="visited_at"
          type="date"
          required
          value={visitedAt}
          onChange={(e) => setVisitedAt(e.target.value)}
          className="w-full rounded-2xl border border-line bg-surface px-4 py-3 text-fg transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30"
        />
      </div>

      <div>
        <label htmlFor="comment" className="mb-1.5 block text-sm font-semibold text-fg">
          Comment <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id="comment"
          rows={3}
          maxLength={1000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="w-full resize-none rounded-2xl border border-line bg-surface px-4 py-3 text-fg placeholder:text-muted/70 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30"
          placeholder="Anything worth remembering about this visit…"
        />
        <p className="mt-1 text-right text-xs text-muted">{comment.length}/1000</p>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-tomato py-3 px-4 font-display font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
        >
          <Save className="h-4 w-4" />
          {submitting ? "Saving…" : "Post review"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-5 py-3 font-semibold text-fg transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
        >
          <X className="h-4 w-4" />
          Cancel
        </button>
      </div>
    </form>
  );
}
