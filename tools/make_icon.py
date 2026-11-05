"""Generates build/icon.png (512x512) and build/icon.ico: chamber ring, four press heads, gold core."""
from PIL import Image, ImageDraw, ImageFilter
import os, sys
S = 1024
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
c = S // 2
d.rounded_rectangle([40, 40, S - 40, S - 40], radius=220, fill=(10, 14, 22, 255))
R = 360
d.ellipse([c - R, c - R, c + R, c + R], fill=(20, 27, 40, 255), outline=(222, 230, 242, 255), width=34)
for k in range(4):
    w, h, off = 70, 280, 170
    boxes = [(c + off, c - h // 2, c + off + w, c + h // 2), (c - off - w, c - h // 2, c - off, c + h // 2),
             (c - h // 2, c + off, c + h // 2, c + off + w), (c - h // 2, c - off - w, c + h // 2, c - off)]
    d.rounded_rectangle(boxes[k], radius=14, fill=(200, 208, 220, 255))
glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse([c - 120, c - 120, c + 120, c + 120], fill=(255, 190, 60, 150))
img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(40)))
d = ImageDraw.Draw(img)
d.ellipse([c - 78, c - 78, c + 78, c + 78], fill=(242, 180, 55, 255))
d.ellipse([c - 50, c - 58, c - 4, c - 12], fill=(255, 238, 190, 255))
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
img.resize((512, 512), Image.LANCZOS).save(os.path.join(out, 'icon.png'))
img.save(os.path.join(out, 'icon.ico'), sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
print('ok')
