"""Draws the app icons (a white car on blue). Run: python3 tools/make-icons.py"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "web" / "icons"
BLUE = (37, 99, 235)
WHITE = (255, 255, 255)
DARK = (15, 23, 42)


def draw(size):
    s = size / 512
    img = Image.new("RGB", (size, size), BLUE)
    d = ImageDraw.Draw(img)
    # Body and cabin, kept inside the middle 60% so "maskable" crops look right.
    d.rounded_rectangle([108 * s, 250 * s, 404 * s, 340 * s], radius=28 * s, fill=WHITE)
    d.polygon([(160 * s, 252 * s), (196 * s, 182 * s), (316 * s, 182 * s), (352 * s, 252 * s)], fill=WHITE)
    # Windows
    d.polygon([(186 * s, 244 * s), (208 * s, 200 * s), (250 * s, 200 * s), (250 * s, 244 * s)], fill=BLUE)
    d.polygon([(262 * s, 244 * s), (262 * s, 200 * s), (304 * s, 200 * s), (326 * s, 244 * s)], fill=BLUE)
    # Wheels
    for cx in (176, 336):
        d.ellipse([(cx - 34) * s, (306 * s), (cx + 34) * s, (374 * s)], fill=DARK)
        d.ellipse([(cx - 14) * s, (326 * s), (cx + 14) * s, (354 * s)], fill=WHITE)
    return img


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    draw(192).save(OUT / "icon-192.png")
    draw(512).save(OUT / "icon-512.png")
    draw(180).save(OUT / "apple-touch-icon.png")
    (OUT / "icon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
        '<rect width="512" height="512" rx="96" fill="#2563eb"/>'
        '<rect x="108" y="250" width="296" height="90" rx="28" fill="#fff"/>'
        '<polygon points="160,252 196,182 316,182 352,252" fill="#fff"/>'
        '<polygon points="186,244 208,200 250,200 250,244" fill="#2563eb"/>'
        '<polygon points="262,244 262,200 304,200 326,244" fill="#2563eb"/>'
        '<circle cx="176" cy="340" r="34" fill="#0f172a"/><circle cx="176" cy="340" r="14" fill="#fff"/>'
        '<circle cx="336" cy="340" r="34" fill="#0f172a"/><circle cx="336" cy="340" r="14" fill="#fff"/>'
        "</svg>\n"
    )


if __name__ == "__main__":
    main()
