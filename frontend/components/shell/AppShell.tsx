"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "aws-amplify/auth";
import { LogOut, User } from "lucide-react";
import { SamMascot } from "@/components/brand/SamMascot";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { LanguageToggle } from "@/components/ui/LanguageToggle";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import type { MessageKey } from "@/lib/i18n/dictionary";
import { announceTabHome } from "@/lib/url-state";
import { WORLDS, type WorldId } from "@/lib/worlds";

/**
 * Shared chrome for every signed-in page: a sticky header (wordmark +
 * COOK/DINE/PLAN world switch + theme + profile + sign out) on desktop, and a
 * fixed bottom tab bar on mobile. Pages render their own content + sub-toolbar
 * inside `children`. Sign-out lives here so no page repeats it.
 */
export function AppShell({
  userName,
  children,
}: {
  userName?: string;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const pathname = usePathname() ?? "";
  const router = useRouter();

  const onProfile = pathname.startsWith("/profile");
  // Derived from the WORLDS table rather than from a chain of startsWith, so
  // adding a world is one entry in lib/worlds.ts and nothing here.
  const activeWorld: WorldId = WORLDS.find((w) => pathname.startsWith(w.href))?.id ?? "cook";

  const handleSignOut = async () => {
    try {
      await signOut({ global: true });
    } finally {
      router.push("/");
    }
  };

  return (
    <div className="min-h-screen bg-bg bg-paws text-fg">
      <header className="glass-bar sticky top-0 z-30">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2.5 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            <SamMascot className="h-10 w-10 shrink-0" />
            <span className="flex flex-col leading-none">
              <span className="font-display text-xl font-bold tracking-tight text-fg">
                SAM
              </span>
              <span className="hidden whitespace-nowrap text-[11px] font-medium text-muted sm:block">{t("shell.cook-and-dine")}</span>
            </span>
          </Link>

          <nav className="hidden md:block" aria-label={t("shell.worlds")}>
            <WorldSwitch active={onProfile ? null : activeWorld} />
          </nav>

          <div className="flex items-center gap-1">
            <ThemeToggle />
            <LanguageToggle />
            <Link
              href="/profile"
              aria-label={t("shell.your-profile")}
              title={t("shell.profile")}
              className={`flex h-11 items-center gap-2 rounded-full px-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50 ${
                onProfile ? "bg-surface-2" : "hover:bg-surface-2"
              }`}
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-tomato/15 text-tomato">
                <User className="h-4 w-4" />
              </span>
              {userName && (
                <span className="hidden max-w-[8rem] truncate pr-1 text-sm font-semibold sm:block">
                  {userName}
                </span>
              )}
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              aria-label={t("shell.sign-out")}
              title={t("shell.sign-out")}
              className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 sm:px-6 md:pb-16">
        {children}
      </main>

      <MobileTabBar activeWorld={activeWorld} onProfile={onProfile} />
    </div>
  );
}

/**
 * A tab link that, on the page it points at, goes to that page's main screen.
 *
 * Navigating to the path you are already on changes nothing visible — the page
 * stays mounted and only reads its query on load and popstate — so the click
 * is turned into an announcement the page answers (`useTabHome`). Modified
 * clicks (open in a new tab) keep the browser's behaviour.
 */
function useTabClick() {
  const pathname = usePathname() ?? "";
  return (href: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (pathname !== href) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    announceTabHome();
  };
}

/** Desktop segmented control for switching worlds. */
function WorldSwitch({ active }: { active: WorldId | null }) {
  const { t } = useI18n();
  const onTabClick = useTabClick();
  return (
    <div className="inline-flex items-center rounded-full border border-line bg-surface p-1">
      {WORLDS.map((w) => {
        const Icon = w.icon;
        const on = w.id === active;
        return (
          <Link
            key={w.id}
            href={w.href}
            onClick={onTabClick(w.href)}
            aria-current={on ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 font-display text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50 ${
              on
                ? "bg-tomato text-white shadow-pop"
                : "text-muted hover:text-fg"
            }`}
          >
            <Icon className="h-4 w-4" />
            {t(`worlds.${w.id}.label` as MessageKey)}
          </Link>
        );
      })}
    </div>
  );
}

/** Fixed bottom navigation for mobile (≥44px targets). */
function MobileTabBar({
  activeWorld,
  onProfile,
}: {
  activeWorld: WorldId;
  onProfile: boolean;
}) {
  const { t } = useI18n();
  const onTabClick = useTabClick();
  const tabs: {
    key: string;
    label: string;
    href: string;
    icon: typeof User;
    active: boolean;
  }[] = [
    ...WORLDS.map((w) => ({
      key: w.id,
      label: t(`worlds.${w.id}.label` as MessageKey),
      href: w.href,
      icon: w.icon,
      active: !onProfile && activeWorld === w.id,
    })),
    { key: "profile", label: t("shell.you"), href: "/profile", icon: User, active: onProfile },
  ];

  const activeIndex = tabs.findIndex((tab) => tab.active);

  return (
    // A floating glass pill rather than a full-width strip: the page scrolls
    // on beneath it and stays visible through the blur, and the active tab is
    // a tinted lens that slides between tabs — the same pill-in-a-pill as the
    // profile tabs and Plan's switch (components/ui/SegmentedControl).
    <nav
      aria-label={t("shell.primary-navigation")}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] md:hidden"
    >
      <div className="glass-chrome pointer-events-auto relative mx-auto grid max-w-sm grid-cols-4 rounded-full p-1.5">
        {activeIndex >= 0 && (
          <span
            aria-hidden
            className="absolute inset-y-1.5 left-1.5 rounded-full bg-tomato/[0.13] shadow-[inset_0_1px_0_rgb(255_255_255/0.5)] transition-transform duration-500 ease-[cubic-bezier(.16,1,.3,1)] motion-reduce:transition-none dark:bg-tomato/20 dark:shadow-none"
            // One column of the grid: (track − padding) / 4, so a step is one
            // of its own widths and the slide is a plain translateX.
            style={{ width: "calc((100% - 0.75rem) / 4)", transform: `translateX(${activeIndex * 100}%)` }}
          />
        )}
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <Link
              key={t.key}
              href={t.href}
              onClick={onTabClick(t.href)}
              aria-current={t.active ? "page" : undefined}
              className={`relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-full text-[11px] font-semibold transition-[color,transform] duration-200 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50 ${
                t.active ? "text-tomato" : "text-muted hover:text-fg"
              }`}
            >
              <Icon className="h-5 w-5" strokeWidth={t.active ? 2.4 : 2} aria-hidden />
              <span className="whitespace-nowrap">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
