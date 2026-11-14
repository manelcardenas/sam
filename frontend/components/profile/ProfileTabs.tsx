"use client";

import { BookOpen, CalendarRange, MessageSquareQuote, Settings, ShieldCheck, Sparkles } from "lucide-react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { visibleTabs, type ProfileTab } from "@/lib/profile-url";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import type { MessageKey } from "@/lib/i18n/dictionary";

const ICONS: Record<ProfileTab, typeof Sparkles> = {
  overview: Sparkles,
  recipes: BookOpen,
  reviews: MessageSquareQuote,
  plans: CalendarRange,
  account: Settings,
  admin: ShieldCheck,
};

/**
 * The profile's section switch: a `SegmentedControl` with tab semantics.
 *
 * It used to be equal-width columns with a sliding indicator, which needed
 * every column the same width — and at five Catalan labels on a 360 px phone
 * that read "Recept… Resse… Setma…". Now, on a phone, only the selected tab
 * spells its name and the others are their icon (see SegmentedControl). The
 * sliding animation went with the equal columns.
 *
 * Each tab also writes the URL, so the browser's own back gesture moves
 * between sections.
 */
export function ProfileTabs({
  tabs = visibleTabs(false),
  active,
  counts,
  onSelect,
}: {
  /** The tabs this person sees, in order: everybody but an admin gets one fewer than `PROFILE_TABS`. */
  tabs?: readonly ProfileTab[];
  active: ProfileTab;
  /** Shown after the label on the two list tabs; omit a key to show no number. */
  counts?: Partial<Record<ProfileTab, number>>;
  onSelect: (tab: ProfileTab) => void;
}) {
  const { t } = useI18n();
  return (
    <SegmentedControl<ProfileTab>
      role="tablist"
      idPrefix="profile-tab"
      label={t("profile.sections")}
      value={active}
      onChange={onSelect}
      stretch
      labelsFrom={tabs.length > 5 ? "md" : "sm"}
      segments={tabs.map((tab) => ({
        value: tab,
        label: t(`profile.tab-${tab}` as MessageKey),
        icon: ICONS[tab],
        badge: counts?.[tab],
        controls: `profile-panel-${tab}`,
      }))}
    />
  );
}
