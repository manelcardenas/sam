"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useMe } from "@/components/auth/UserProvider";

/**
 * The redirect policy every signed-in page shared before `UserProvider` existed:
 * bounce to the landing page when signed out, and to /profile/complete until a
 * display name has been chosen.
 *
 * Pages should key their own data loading on `me?.id` rather than on `me`, so a
 * background revalidation returning an equivalent profile doesn't refetch the page.
 */
export function useAuthGate({ requireDisplayName = true } = {}) {
  const { me, status } = useMe();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;
    if (status === "signed-out") {
      router.push("/");
      return;
    }
    if (requireDisplayName && me && !me.display_name) {
      router.replace("/profile/complete");
    }
  }, [status, me, requireDisplayName, router]);

  return { me, status };
}
