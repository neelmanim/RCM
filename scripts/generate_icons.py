#!/usr/bin/env python3
"""
RCM Icon Generator
========================
Regenerates all required icon sizes from the master logo PNG.

Usage:
    python3 scripts/generate_icons.py

Requirements:
    pip install Pillow

Source file:
    frontend/img/icons/rcm-logo-master.png  (788x788 square, no padding)

Outputs:
    frontend/favicon.ico                       — 16/32/48 multi-res (browser tab)
    frontend/img/icons/favicon-16x16.png       — Legacy <link rel="icon"> fallback
    frontend/img/icons/favicon-32x32.png       — Retina browser tabs
    frontend/img/icons/favicon-48x48.png       — Windows taskbar pinned sites
    frontend/img/icons/apple-touch-icon.png    — iOS/iPadOS home screen (180x180)
    frontend/img/icons/icon-192x192.png        — Android / PWA manifest
    frontend/img/icons/icon-512x512.png        — PWA splash screen
    frontend/img/icons/og-image.png            — Open Graph / social share
    frontend/img/rcm-logo.png            — Sidebar brand image (192x192)

Future logo update process:
    1. Obtain new logo: must be square PNG, min 1024x1024, high quality
    2. Save as: frontend/img/icons/rcm-logo-master.png
    3. Run: python3 scripts/generate_icons.py
    4. Commit: git add frontend/favicon.ico frontend/img/icons/ frontend/img/rcm-logo.png
    5. Test: verify favicon in Chrome/Firefox/Safari; iOS home screen icon
    6. Deploy and check OG image via https://www.opengraph.xyz
"""

import os
import sys
import shutil

# Try to import Pillow
try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow is not installed. Run: pip install Pillow")
    sys.exit(1)

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")
ICONS_DIR    = os.path.join(FRONTEND_DIR, "img", "icons")
MASTER_SRC   = os.path.join(ICONS_DIR, "rcm-logo-master.png")

# ── Icon output targets ─────────────────────────────────────────────────────
ICONS = {
    "favicon-16x16.png":    16,
    "favicon-32x32.png":    32,
    "favicon-48x48.png":    48,
    "apple-touch-icon.png": 180,
    "icon-192x192.png":     192,
    "icon-512x512.png":     512,
    "og-image.png":         512,
}


def main():
    if not os.path.exists(MASTER_SRC):
        print(f"ERROR: Master logo not found at {MASTER_SRC}")
        print("Please place the new square PNG logo at that path first.")
        sys.exit(1)

    os.makedirs(ICONS_DIR, exist_ok=True)

    img = Image.open(MASTER_SRC).convert("RGBA")
    w, h = img.size
    print(f"Loaded master: {w}x{h}")

    # Ensure square
    side = min(w, h)
    if w != h:
        print(f"  Cropping to square: {side}x{side}")
        img = img.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2))

    print("\nGenerating icons:")
    for filename, size in ICONS.items():
        out_path = os.path.join(ICONS_DIR, filename)
        resized = img.resize((size, size), Image.LANCZOS)
        resized.save(out_path, optimize=True)
        kb = os.path.getsize(out_path) / 1024
        print(f"  ✓ {filename:40s} {size:>3}x{size:<3} → {kb:.1f}KB")

    # favicon.ico (multi-resolution: 16, 32, 48)
    ico_path = os.path.join(FRONTEND_DIR, "favicon.ico")
    img.resize((16, 16), Image.LANCZOS).save(
        ico_path, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)]
    )
    print(f"  ✓ {'favicon.ico':40s} 16/32/48 multi-res")

    # Sidebar logo (copy of 192x192)
    logo_path = os.path.join(FRONTEND_DIR, "img", "rcm-logo.png")
    shutil.copy(os.path.join(ICONS_DIR, "icon-192x192.png"), logo_path)
    print(f"  ✓ {'img/rcm-logo.png':40s} (copy of 192x192)")

    print("\n✅ All icons generated successfully.")
    print("\nNext steps:")
    print("  git add frontend/favicon.ico frontend/img/icons/ frontend/img/rcm-logo.png")
    print("  git commit -m 'brand: update RCM icons'")


if __name__ == "__main__":
    main()
