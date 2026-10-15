"""Generate web brand assets from icon.png. Requires Python and Pillow."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "brand"
OUT.mkdir(parents=True, exist_ok=True)
source = Image.open(ROOT / "icon.png").convert("RGBA")
alpha = source.getchannel("A")
# Ignore nearly invisible stray pixels when trimming the supplied artwork.
bounds = alpha.point(lambda value: 255 if value > 8 else 0).getbbox()
if bounds is None:
    raise ValueError("The source icon is empty")
source.putalpha(alpha.point(lambda value: value if value > 8 else 0))
art = source.crop(bounds)


def icon(size, background=None, inset=0.08):
    canvas = Image.new("RGBA", (size, size), background or (0, 0, 0, 0))
    image = art.copy()
    limit = round(size * (1 - 2 * inset))
    image.thumbnail((limit, limit), Image.Resampling.LANCZOS)
    canvas.alpha_composite(image, ((size - image.width) // 2, (size - image.height) // 2))
    return canvas


for size in (96, 192):
    icon(size).save(OUT / f"logo-{size}.webp", lossless=True, method=6)
for size in (192, 512):
    icon(size).save(OUT / f"icon-{size}.png", optimize=True)
icon(180, "#f4f7f6").convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)
icon(32, inset=0.04).save(OUT / "favicon-32.png", optimize=True)
icon(48, inset=0.04).save(ROOT / "public" / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
print(f"Generated brand assets from crop {bounds} in {OUT}")
