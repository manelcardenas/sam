/**
 * Rasterises app/icon.svg into the PNG icons the platforms actually need.
 *
 * Why this exists: iOS "Add to Home Screen" ignores SVG favicons entirely — it
 * looks for <link rel="apple-touch-icon"> pointing at a raster image, and falls
 * back to a screenshot of the page when there isn't one. That was the bug: SAM's
 * face showed on Android (Chrome supports SVG favicons) but never on iOS.
 *
 * icon.svg stays the single source of truth for the artwork; everything here is
 * derived. Re-run with `npm run icons` after editing it.
 *
 * `sharp` ships with Next, so this needs no extra dependency.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "app", "icon.svg");

/** Brand cream — matches the plate in icon.svg and the manifest background. */
const CREAM = "#FBF7EF";

/**
 * Android adaptive icons crop to a circle inscribed in the "safe zone": only the
 * middle 80% is guaranteed visible. Rendering the artwork at 60% and centring it
 * on a full-bleed cream plate keeps SAM's ears inside the mask instead of shaved
 * off by it.
 */
async function maskable(svg, size) {
  const inner = Math.round(size * 0.6);
  const art = await sharp(svg).resize(inner, inner).png().toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: CREAM,
    },
  })
    .composite([{ input: art, gravity: "centre" }])
    .png()
    .toBuffer();
}

const targets = [
  // The actual iOS fix. Next's App Router turns app/apple-icon.png into
  // <link rel="apple-touch-icon"> automatically — the filename is the API.
  { out: join(root, "app", "apple-icon.png"), size: 180 },
  { out: join(root, "public", "icon-192.png"), size: 192 },
  { out: join(root, "public", "icon-512.png"), size: 512 },
  { out: join(root, "public", "icon-maskable-512.png"), size: 512, mask: true },
];

const svg = await readFile(source);

for (const { out, size, mask } of targets) {
  await mkdir(dirname(out), { recursive: true });
  const png = mask
    ? await maskable(svg, size)
    : await sharp(svg).resize(size, size).png().toBuffer();
  await writeFile(out, png);
  console.log(`  ${size}x${size}${mask ? " (maskable)" : ""}  ->  ${out.replace(root + "/", "")}`);
}

console.log("Icons generated from app/icon.svg");
