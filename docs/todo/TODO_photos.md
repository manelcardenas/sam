# TODO — Photos in the app

> **Status: Proposed — not started.** Priced 2026-11-14; waits for the Expo app (ADR 0008).

Two different things:

1. **A photo of a recipe → text.** No storage: the image goes to a vision model and is thrown
   away. Part of [better ingredient capture](./TODO_ingredient-capture-v2.md).
2. **Photos as content:** dishes, restaurants, profile pictures. Needs storage, upload and display.

## What 2 costs (prices checked 2026-11-14)

A phone photo resized in the app to ~1600 px WebP is ~200–300 KB, a thumbnail ~30 KB. A
household with 500 photos holds **~150 MB**; 2,000 photos ~600 MB.

| | Free allowance | Past it | Fits us? |
|---|---|---|---|
| **Vercel Blob** (Hobby) | 1 GB stored, 10 GB transfer/month, 2K uploads/month | **Not billed: Blob is cut off for 30 days** | Yes, ~3,000+ photos. The cut-off is the risk |
| **Cloudflare R2** | 10 GB stored, free egress, 1M writes + 10M reads/month | 0.015 $/GB-month | Yes, by far. One more account (Cloudflare) |
| **S3** (our AWS account predates the July 2025 change, so no new-account credits) | none left | ~0.024 $/GB-month + requests; first 100 GB/month out free | Yes: ~0.01 $/month at 150 MB. Not literally zero |

All three take uploads straight from the phone through a signed URL, so photos never pass
through the API function.

**Revisit when** the Expo app is in daily use (step 4 of the queue). Most of the work is UI
(pick, crop, upload, show), and building it in Next.js now would be thrown away.
