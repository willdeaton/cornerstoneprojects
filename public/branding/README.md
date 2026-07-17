# Company logo

This folder holds the company logo used across the app — the sign-in screen,
the desktop sidebar, and the mobile top bar.

## How to change the logo

1. Prepare your logo image and **name it exactly `logo.png`**.
2. In GitHub, open this folder (`public/branding/`).
3. Click **Add file → Upload files** (or open `logo.png` and choose **Replace**),
   drop your file in, and commit.

That's it — once deployed, the app uses your new logo everywhere.

## Tips for a good logo

- The sidebar and sign-in screen use a **dark background**, so a logo with a
  **transparent background** and **light-colored artwork** looks best.
- PNG or SVG works well. If you use SVG, name it `logo.png`'s counterpart and
  update the path in `src/lib/branding.ts` accordingly, or keep it as `logo.png`.
- Keep the file reasonably small (well under ~1 MB) so pages load fast.

The code points at this file via `DEFAULT_LOGO` in
[`src/lib/branding.ts`](../../src/lib/branding.ts).
