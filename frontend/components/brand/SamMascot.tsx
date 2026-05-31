"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { SamLogo } from "@/components/brand/SamLogo";

// dotLottie needs browser APIs (WASM) — load client-only for static export.
const DotLottieReact = dynamic(
  () => import("@lottiefiles/dotlottie-react").then((m) => m.DotLottieReact),
  { ssr: false, loading: () => <SamLogo className="h-full w-full animate-float" /> },
);

/**
 * Animated SAM mascot (Lottie), loaded from `public/sam.json`.
 *
 * The static SAM logo overlays the player until the animation actually starts
 * rendering. We flip `playing` on the `frame`/`play`/`load` events — crucially
 * `frame`, because on client-side navigation the chunk + WASM are cached and the
 * `load` event can fire before our listener attaches (which is why it animated
 * only on the first full page load and showed the static fallback everywhere
 * else). `frame` fires on every painted frame, so it can't be missed.
 */
export function SamMascot({
  className,
  src = "/sam.json",
  loop = true,
  autoplay = true,
}: {
  className?: string;
  src?: string;
  loop?: boolean;
  autoplay?: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  return (
    <div className={`relative ${className ?? ""}`}>
      <DotLottieReact
        src={src}
        loop={loop && !reduced}
        autoplay={autoplay && !reduced}
        style={{ width: "100%", height: "100%" }}
        dotLottieRefCallback={(dotLottie) => {
          if (!dotLottie) return;
          const seen = () => setPlaying(true);
          dotLottie.addEventListener("load", seen); // covers reduced-motion (still frame)
          dotLottie.addEventListener("play", seen);
          dotLottie.addEventListener("frame", seen); // can't be missed on fast nav
        }}
      />
      {!playing && (
        <SamLogo className="absolute inset-0 h-full w-full animate-float" />
      )}
    </div>
  );
}
