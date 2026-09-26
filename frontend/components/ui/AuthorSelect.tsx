"use client";

import { UserRound } from "lucide-react";

import { MultiSelect } from "@/components/ui/MultiSelect";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { initialsOf, type PersonOption } from "@/lib/people";

/**
 * "Created by" / "Reviewed by" — `MultiSelect` over people.
 *
 * **One control for every "whose is this" filter.** Recipes narrow by who added
 * them, restaurants by who reviewed them; both are the same question over a list
 * of names, so both get this, with only the label changing. The dine list used
 * to have a lone "Reviewed by me" chip instead, which could not answer "what has
 * Martina been to" and looked like a different kind of filter for no reason.
 *
 * What makes it about people: initials as the mark, a "You" tag on your own row
 * so you are not hunting for your name, and a search box once there are enough
 * names that reading them all stops being quicker than typing.
 */
export function AuthorSelect({
  label,
  authors,
  selected,
  onChange,
  currentUserId,
}: {
  /** What the people did — "Created by", "Reviewed by". Stays visible while in use. */
  label: string;
  authors: PersonOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  currentUserId: string | null;
}) {
  const { t, tp } = useI18n();

  return (
    <MultiSelect
      label={label}
      icon={UserRound}
      options={authors.map((author) => ({
        id: author.id,
        name: author.name,
        // Neutral, not colour-coded: the name is right beside it, so a hue
        // would be decoration competing with the one signal that matters —
        // whether the row is ticked.
        mark: () => initialsOf(author.name),
        badge: author.id === currentUserId ? t("common.you") : undefined,
      }))}
      selected={selected}
      onChange={onChange}
      manyLabel={(n) => tp("common.people-count", n)}
      search={{ placeholder: t("common.search-people"), noMatch: t("common.no-people-match") }}
    />
  );
}
