"use client";

import { getCurrentUser } from "aws-amplify/auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { configureAmplify } from "@/lib/amplify";
import { apiClient, type UserProfile } from "@/lib/api-client";

/**
 * The signed-in user, fetched once per session instead of once per page mount.
 *
 * Every page used to `await apiClient.getMe()` before loading its own data,
 * which made `GET /users/me` 32% of all backend traffic (measured in
 * production, see docs/plans/routing-and-latency-plan.md §0) and put a serial
 * round trip in front of every page's content.
 *
 * Seeded synchronously-ish from sessionStorage so a reload — or a launch from
 * the iOS home screen, which is a full page load, not a client-side
 * navigation — renders with a name already in hand and revalidates quietly in
 * the background.
 */

const CACHE_KEY = "sam.me";

export type UserStatus = "loading" | "ready" | "signed-out";

interface UserContextValue {
  me: UserProfile | null;
  status: UserStatus;
  /** Replace the cached profile after an update (e.g. choosing a display name). */
  setMe: (me: UserProfile) => void;
  /** Force a refetch. Rarely needed — setMe covers the common case. */
  refresh: () => Promise<void>;
}

const UserContext = createContext<UserContextValue | null>(null);

function readCache(): UserProfile | null {
  // Private browsing and locked-down settings make sessionStorage throw on
  // access, not just return null — so every touch is guarded.
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as UserProfile) : null;
  } catch {
    return null;
  }
}

function writeCache(me: UserProfile | null): void {
  try {
    if (me) sessionStorage.setItem(CACHE_KEY, JSON.stringify(me));
    else sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // A cache we can't write is a slower app, not a broken one.
  }
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [me, setMeState] = useState<UserProfile | null>(null);
  const [status, setStatus] = useState<UserStatus>("loading");
  // React 18 StrictMode double-invokes effects in development; without this the
  // fix would still fire two /users/me calls on the very mount it exists to fix.
  const started = useRef(false);

  const setMe = useCallback((next: UserProfile) => {
    setMeState(next);
    writeCache(next);
  }, []);

  const load = useCallback(async () => {
    try {
      await getCurrentUser(); // local token check — no network in the common case
      const fresh = await apiClient.getMe();
      setMeState(fresh);
      writeCache(fresh);
      setStatus("ready");
    } catch {
      setMeState(null);
      writeCache(null);
      setStatus("signed-out");
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    configureAmplify();

    // Read the cache before the network call, not instead of it: the page can
    // paint immediately while the revalidation settles.
    const cached = readCache();
    if (cached) {
      setMeState(cached);
      setStatus("ready");
    }
    void load();
  }, [load]);

  return (
    <UserContext.Provider value={{ me, status, setMe, refresh: load }}>
      {children}
    </UserContext.Provider>
  );
}

export function useMe(): UserContextValue {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error("useMe must be used inside <UserProvider>");
  }
  return context;
}
