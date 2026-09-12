"use client";

import { initialsOf } from "@/lib/people";

/**
 * Two letters saying who put this here.
 *
 * **It renders nothing when the answer is "you"**, which is what keeps it from
 * becoming noise. In a kitchen of one every row would carry the same initials
 * and say nothing; in a kitchen of two, only the other person's rows are marked,
 * and the absence of a mark reads as "mine" without a second symbol for it.
 * That also means this needs no knowledge of how many people are in the
 * kitchen — the comparison answers it.
 *
 * Attribution, never permission. Anyone in the kitchen can tick, remove or
 * reassign anything; this only answers *"did you already get the bread, or is
 * that still mine to buy?"*, which is the one question a shared list cannot
 * answer on its own.
 */
export function PersonMark({
  userId,
  name,
  currentUserId,
  label,
}: {
  userId: string | null;
  name: string | null;
  currentUserId: string | null;
  /** The sentence a reader gets on hover — "Added by Martina". */
  label: (name: string) => string;
}) {
  if (!name || !userId || userId === currentUserId) return null;

  const described = label(name);
  return (
    <span
      title={described}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 font-display text-[0.55rem] font-bold uppercase text-muted"
    >
      <span aria-hidden>{initialsOf(name)}</span>
      <span className="sr-only">{described}</span>
    </span>
  );
}
