# Іконка «Нотатки» у спільному стилі сайтів: темна плитка, м'яке світіння,
# один товстий лінійний символ кольору сайту (жовта нотатка із загнутим кутом і рядками).
# Запуск: python3 tools/icon.py  → public/icon-v4-180.png, public/icon-v4-512.png
from PIL import Image, ImageDraw, ImageFilter
import os

S = 1024
ACCENT = (242, 193, 78)
BG_TOP, BG_BOT = (34, 35, 40), (16, 17, 20)

img = Image.new('RGB', (S, S), BG_BOT)
d = ImageDraw.Draw(img)
for y in range(S):
    t = y / S
    d.line([(0, y), (S, y)], fill=tuple(int(BG_TOP[i] * (1 - t) + BG_BOT[i] * t) for i in range(3)))

# м'яке світіння
glow = Image.new('L', (S, S), 0)
ImageDraw.Draw(glow).ellipse([S * .2, S * .2, S * .8, S * .8], fill=90)
glow = glow.filter(ImageFilter.GaussianBlur(120))
img = Image.composite(Image.new('RGB', (S, S), ACCENT), img, glow)

# символ
sym = Image.new('L', (S, S), 0)
g = ImageDraw.Draw(sym)
W = 52
x0, y0, x1, y1 = 300, 230, 724, 794
fold = 150
pts = [(x0, y0), (x1 - fold, y0), (x1, y0 + fold), (x1, y1), (x0, y1), (x0, y0)]
g.line(pts, fill=255, width=W, joint='curve')
for p in pts[:5]:
    g.ellipse([p[0] - W / 2, p[1] - W / 2, p[0] + W / 2, p[1] + W / 2], fill=255)
# загнутий кут
g.line([(x1 - fold, y0), (x1 - fold, y0 + fold), (x1, y0 + fold)], fill=255, width=W, joint='curve')
g.ellipse([x1 - fold - W / 2, y0 + fold - W / 2, x1 - fold + W / 2, y0 + fold + W / 2], fill=255)
# рядки
for i, (ly, lx1) in enumerate([(470, 620), (580, 620), (690, 520)]):
    g.line([(x0 + 96, ly), (lx1, ly)], fill=255, width=W)
    for px in (x0 + 96, lx1):
        g.ellipse([px - W / 2, ly - W / 2, px + W / 2, ly + W / 2], fill=255)

shine = sym.filter(ImageFilter.GaussianBlur(28)).point(lambda v: v * 0.55)
img = Image.composite(Image.new('RGB', (S, S), ACCENT), img, shine)
img = Image.composite(Image.new('RGB', (S, S), ACCENT), img, sym)

out = os.path.join(os.path.dirname(__file__), '..', 'public')
for size in (180, 512):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(out, f'icon-v4-{size}.png'), optimize=True)
print('ok')
