#!/usr/bin/env python3
"""Generate the Coach iOS app icon.

Produces a 1024x1024 RGB PNG (no alpha — App Store rejects alpha channels)
with a white "C" centered on a near-black background.

Run once after a design change; commit the resulting PNG.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
BACKGROUND = (10, 10, 10)
FOREGROUND = (255, 255, 255)
GLYPH = "C"

# Search order for a bold sans-serif system font; first match wins.
FONT_CANDIDATES = [
    "/System/Library/Fonts/SFNS.ttf",
    "/System/Library/Fonts/SFNSDisplay.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial Bold.ttf",
]

OUTPUT = (
    Path(__file__).resolve().parent.parent
    / "apps/ios/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"
)


def find_font(point_size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, point_size)
            except OSError:
                continue
    return ImageFont.load_default()


def main() -> None:
    image = Image.new("RGB", (SIZE, SIZE), BACKGROUND)
    draw = ImageDraw.Draw(image)

    # Target glyph height ≈ 60% of canvas. Pillow font sizing is in points, not
    # pixels, so we measure and rescale.
    target_height = int(SIZE * 0.6)
    font = find_font(target_height)
    bbox = draw.textbbox((0, 0), GLYPH, font=font)
    glyph_h = bbox[3] - bbox[1]
    if glyph_h > 0:
        font = find_font(int(target_height * target_height / glyph_h))
        bbox = draw.textbbox((0, 0), GLYPH, font=font)

    glyph_w = bbox[2] - bbox[0]
    glyph_h = bbox[3] - bbox[1]
    x = (SIZE - glyph_w) // 2 - bbox[0]
    y = (SIZE - glyph_h) // 2 - bbox[1]
    draw.text((x, y), GLYPH, fill=FOREGROUND, font=font)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUTPUT, format="PNG")
    print(f"wrote {OUTPUT} ({SIZE}x{SIZE})")


if __name__ == "__main__":
    main()
