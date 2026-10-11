#!/usr/bin/env python3
"""Asset pipeline for Temple Rush.

Turns the raw AI-generated source art (assets/raw/) into clean, game-ready
sprites and textures (assets/):

  * chroma-keys the magenta backgrounds to real alpha + de-spills the edges
  * slices the 4-pose run cycle into individual, baseline-aligned frames
  * procedurally renders a shaded gold coin sprite
  * converts the sky panorama, seamless ground/wall textures and UI art

Run:  python3 tools/process_assets.py
"""
import math
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "assets", "raw")
OUT = os.path.join(ROOT, "assets")
SPR = os.path.join(OUT, "sprites")
TEX = os.path.join(OUT, "textures")
UI = os.path.join(OUT, "ui")

for d in (SPR, TEX, UI):
    os.makedirs(d, exist_ok=True)


# ----------------------------------------------------------------------------
# chroma key
# ----------------------------------------------------------------------------
def chroma_key_magenta(path, threshold=72.0, soft=30.0):
    """Remove a magenta screen and return an RGBA image."""
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # magenta-ness: how much both red & blue dominate green
    k = np.minimum(r, b) - g
    alpha = np.clip((threshold - k) / soft, 0.0, 1.0)
    # de-spill: pull magenta cast out of the semi transparent fringe
    spill = np.clip(k, 0.0, None) * (1.0 - alpha) * 0.9
    r = np.clip(r - spill * 0.55, 0, 255)
    b = np.clip(b - spill * 0.55, 0, 255)
    g = np.clip(g + spill * 0.06, 0, 255)
    out = np.dstack([r, g, b, alpha * 255.0]).astype(np.uint8)
    img = Image.fromarray(out, "RGBA")
    # eat 1px of leftovers around the new silhouette
    al = img.getchannel("A").filter(ImageFilter.MinFilter(3))
    img.putalpha(al)
    return img


def key_black(path, power=1.25, core=0.9):
    """Turn a black background into alpha (additive-style glow sprite).

    `core` keeps a solid radial centre so the fireball has a burning middle
    instead of turning into a hollow ring.
    """
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.float32) / 255.0
    lum = a.max(axis=2)
    h, w = lum.shape
    yy, xx = np.mgrid[0:h, 0:w]
    nx = (xx / w - 0.5) * 2.0
    ny = (yy / h - 0.5) * 2.0
    r = np.sqrt(nx ** 2 + ny ** 2)
    alpha = np.clip(np.maximum(lum * power, np.clip((1.0 - r / 0.62), 0, 1) * core), 0, 1)
    # keep the core hot: brighten the smoke in the middle
    hot = np.clip((1.0 - r / 0.7), 0, 1)[..., None] * np.array([1.0, 0.35, 0.0], np.float32)
    rgb = np.clip(a + hot * 0.55, 0, 1)
    out = np.dstack([rgb * 255.0, alpha * 255.0]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def bbox_alpha(img, pad=2):
    bb = img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if bb is None:
        return img
    l, t, r, b = bb
    l, t = max(0, l - pad), max(0, t - pad)
    r, b = min(img.width, r + pad), min(img.height, b + pad)
    return img.crop((l, t, r, b))


def fit_height(img, h):
    w = max(1, round(img.width * h / img.height))
    return img.resize((w, h), Image.LANCZOS)


def trim_transparent(img, tol=6):
    a = np.asarray(img.getchannel("A"))
    ys, xs = np.where(a > tol)
    if len(xs) == 0:
        return img
    return img.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


# ----------------------------------------------------------------------------
# 1. run-cycle sprite sheet -> 4 aligned frames
# ----------------------------------------------------------------------------
def slice_runner_sheet(src, count=4, target_h=320):
    sheet = chroma_key_magenta(os.path.join(RAW, src))
    # split into equal columns, then auto-trim each column
    frames = []
    for i in range(count):
        x0 = round(sheet.width * i / count)
        x1 = round(sheet.width * (i + 1) / count)
        frames.append(trim_transparent(sheet.crop((x0, 0, x1, sheet.height))))
    # common scale so the character keeps a constant size between frames
    base_h = max(f.height for f in frames)
    scale = target_h / base_h
    scaled = [f.resize((max(1, round(f.width * scale)), max(1, round(f.height * scale))),
                       Image.LANCZOS) for f in frames]
    # common canvas, bottom-anchored = feet stay on the same ground line
    cw = max(f.width for f in scaled) + 8
    ch = max(f.height for f in scaled) + 8
    names = ["run_0.png", "run_1.png", "run_2.png", "run_3.png"]
    for f, name in zip(scaled, names):
        canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        canvas.paste(f, ((cw - f.width) // 2, ch - f.height - 4), f)
        canvas.save(os.path.join(SPR, name))
        print("  sprite:", name, canvas.size)
    return names


# ----------------------------------------------------------------------------
# 2. procedural gold coin
# ----------------------------------------------------------------------------
def make_coin(size=256):
    S = 4  # supersample
    w = size * S
    img = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx = cy = w / 2
    R = w * 0.46
    # outer disc (dark rim)
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(120, 74, 8, 255))
    # main gold face with a light gradient from the top-left
    face = Image.new("L", (w, w), 0)
    ImageDraw.Draw(face).ellipse([cx - R * 0.90, cy - R * 0.90, cx + R * 0.90, cy + R * 0.90], fill=255)
    grad = np.zeros((w, w, 3), np.float32)
    yy, xx = np.mgrid[0:w, 0:w]
    t = np.clip(1.0 - ((xx - cx) * 0.55 + (yy - cy) * 0.75) / (w * 0.85), 0, 1)
    base = np.array([255, 205, 66], np.float32)
    dark = np.array([196, 132, 18], np.float32)
    for c in range(3):
        grad[..., c] = dark[c] + (base[c] - dark[c]) * (0.35 + 0.65 * t)
    gold = Image.fromarray(np.dstack([grad, np.full((w, w), 255, np.float32)]).astype(np.uint8), "RGBA")
    img.paste(gold, (0, 0), face)
    d = ImageDraw.Draw(img)
    # inner ring
    d.ellipse([cx - R * 0.76, cy - R * 0.76, cx + R * 0.76, cy + R * 0.76],
              outline=(255, 236, 150, 220), width=max(1, int(w * 0.012)))
    d.ellipse([cx - R * 0.70, cy - R * 0.70, cx + R * 0.70, cy + R * 0.70],
              outline=(168, 104, 10, 190), width=max(1, int(w * 0.016)))
    # jaguar / sun glyph
    lw = max(1, int(w * 0.018))
    gr = R * 0.42
    d.ellipse([cx - gr, cy - gr, cx + gr, cy + gr], outline=(122, 70, 6, 235), width=lw)
    for i in range(12):
        a = i * math.pi / 6
        d.line([cx + math.cos(a) * gr * 1.16, cy + math.sin(a) * gr * 1.16,
                cx + math.cos(a) * gr * 1.62, cy + math.sin(a) * gr * 1.62],
               fill=(255, 232, 140, 220), width=max(1, int(w * 0.014)))
    # carved jaguar-mask glyph: angry angled eyes + hooked fangs (not a smiley)
    d.polygon([(cx - gr * 0.55, cy - gr * 0.42), (cx - gr * 0.16, cy - gr * 0.24),
               (cx - gr * 0.50, cy - gr * 0.05)], fill=(146, 88, 8, 235))
    d.polygon([(cx + gr * 0.55, cy - gr * 0.42), (cx + gr * 0.16, cy - gr * 0.24),
               (cx + gr * 0.50, cy - gr * 0.05)], fill=(146, 88, 8, 235))
    d.polygon([(cx - gr * 0.30, cy + gr * 0.10), (cx - gr * 0.14, cy + gr * 0.52),
               (cx - gr * 0.02, cy + gr * 0.10)], fill=(146, 88, 8, 240))
    d.polygon([(cx + gr * 0.30, cy + gr * 0.10), (cx + gr * 0.14, cy + gr * 0.52),
               (cx + gr * 0.02, cy + gr * 0.10)], fill=(146, 88, 8, 240))
    d.polygon([(cx - gr * 0.10, cy - gr * 0.02), (cx, cy + gr * 0.16), (cx + gr * 0.10, cy - gr * 0.02)],
              fill=(120, 68, 4, 245))
    # specular highlight
    hl = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    ImageDraw.Draw(hl).ellipse([cx - R * 0.62, cy - R * 0.78, cx + R * 0.10, cy - R * 0.26], fill=(255, 255, 220, 120))
    hl = hl.filter(ImageFilter.GaussianBlur(w * 0.03))
    img = Image.alpha_composite(img, hl)
    img = img.resize((size, size), Image.LANCZOS)
    img.save(os.path.join(SPR, "coin.png"))
    print("  sprite: coin.png", img.size)


# ----------------------------------------------------------------------------
# 3. textures / panorama / UI
# ----------------------------------------------------------------------------
def make_seamless(arr, band=0.16):
    """Wrap-blend the borders so the texture tiles without a visible seam."""
    h, w, _ = arr.shape
    kx = max(4, int(w * band))
    ky = max(4, int(h * band))
    ramp_x = np.clip(np.minimum(np.arange(w), w - 1 - np.arange(w)) / kx, 0, 1)
    ramp_y = np.clip(np.minimum(np.arange(h), h - 1 - np.arange(h)) / ky, 0, 1)
    # smoothstep for a softer falloff
    ramp_x = ramp_x * ramp_x * (3 - 2 * ramp_x)
    ramp_y = ramp_y * ramp_y * (3 - 2 * ramp_y)
    m = np.minimum(ramp_x[None, :], ramp_y[:, None])[..., None]
    shifted = np.roll(np.roll(arr, h // 2, axis=0), w // 2, axis=1)
    return arr * m + shifted * (1.0 - m)


def make_texture(src, dst, size=512, quality=82):
    im = Image.open(os.path.join(RAW, src)).convert("RGB")
    s = min(im.size)
    l = (im.width - s) // 2
    t = (im.height - s) // 2
    im = im.crop((l, t, l + s, t + s)).resize((size, size), Image.LANCZOS)
    arr = make_seamless(np.asarray(im).astype(np.float32))
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    im.save(os.path.join(TEX, dst), quality=quality, optimize=True)
    print("  texture:", dst, im.size, f"{os.path.getsize(os.path.join(TEX, dst))//1024}KB")


def make_sky(src, dst, w=2048, h=1024):
    im = Image.open(os.path.join(RAW, src)).convert("RGB")
    im = im.resize((w, h), Image.LANCZOS)
    im.save(os.path.join(TEX, dst), quality=78, optimize=True)
    print("  skybox:", dst, os.path.getsize(os.path.join(TEX, dst)) // 1024, "KB")


def make_title(src, dst, w=1400):
    im = Image.open(os.path.join(RAW, src)).convert("RGB")
    h = round(im.height * w / im.width)
    im.resize((w, h), Image.LANCZOS).save(os.path.join(UI, dst), quality=84, optimize=True)
    print("  ui:", dst, os.path.getsize(os.path.join(UI, dst)) // 1024, "KB")


def make_demon(src, dst, h=760):
    im = Image.open(os.path.join(RAW, src)).convert("RGB")
    w = round(im.width * h / im.height)
    im = im.resize((w, h), Image.LANCZOS).convert("RGBA")
    # radial feather so it melts into the dark UI
    yy, xx = np.mgrid[0:h, 0:w]
    nx = (xx / w - 0.5) * 2
    ny = (yy / h - 0.5) * 2
    r = np.sqrt(nx ** 2 + ny ** 2) / 1.35
    m = np.clip((1.08 - r) / 0.42, 0, 1) ** 0.9
    a = np.asarray(im.getchannel("A"), np.float32) * m
    im.putalpha(Image.fromarray(a.astype(np.uint8)))
    im.save(os.path.join(UI, dst))
    print("  ui:", dst, im.size, os.path.getsize(os.path.join(UI, dst)) // 1024, "KB")


# ----------------------------------------------------------------------------
# 4. procedural FX textures (glow, shadow, dust, flame, wood, streak)
# ----------------------------------------------------------------------------
def radial(size, power=2.0, colour=(255, 255, 255)):
    yy, xx = np.mgrid[0:size, 0:size]
    nx = (xx + 0.5) / size * 2 - 1
    ny = (yy + 0.5) / size * 2 - 1
    r = np.clip(np.sqrt(nx ** 2 + ny ** 2), 0, 1)
    a = (1 - r) ** power
    img = np.zeros((size, size, 4), np.uint8)
    img[..., 0], img[..., 1], img[..., 2] = colour
    img[..., 3] = (a * 255).astype(np.uint8)
    return Image.fromarray(img, "RGBA")


def smooth_noise(w, h, cells=(6, 10)):
    low = np.random.rand(cells[1], cells[0], 3).astype(np.float32)
    im = Image.fromarray((low * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    return np.asarray(im).astype(np.float32) / 255.0


def make_fx():
    radial(256, 2.2).save(os.path.join(SPR, "glow.png"))
    radial(128, 1.4, (0, 0, 0)).save(os.path.join(SPR, "shadow.png"))
    radial(64, 1.0, (255, 220, 120)).save(os.path.join(SPR, "spark.png"))

    # dust puff
    n = smooth_noise(128, 128, (5, 5))[..., 0]
    a = np.asarray(radial(128, 1.6).getchannel("A"), np.float32) / 255.0
    dust = np.clip(a * (0.55 + 0.9 * n), 0, 1)
    img = np.zeros((128, 128, 4), np.uint8)
    img[..., 0], img[..., 1], img[..., 2] = 178, 160, 132
    img[..., 3] = (dust * 210).astype(np.uint8)
    Image.fromarray(img, "RGBA").save(os.path.join(SPR, "dust.png"))

    # flame sheet: 2x2 grid of flame tongues, bottom anchored
    W = H = 512
    cell = W // 2
    tex = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for ci in range(4):
        cx = (ci % 2) * cell
        cy = (ci // 2) * cell
        yy, xx = np.mgrid[0:cell, 0:cell]
        u = xx / cell * 2 - 1
        t = 1.0 - yy / cell  # 0 at bottom, 1 at top
        wob = (np.sin(t * 9 + ci * 2.1) * 0.10 + np.sin(t * 21 + ci) * 0.05)
        width = (0.55 * (1 - t) ** 0.75 + 0.06) * (1 + wob)
        core = np.clip(1 - np.abs(u) / np.maximum(width, 1e-3), 0, 1)
        nz = smooth_noise(cell, cell, (4, 6))[..., 0]
        a = np.clip(core ** 0.7 * (0.5 + 0.85 * nz), 0, 1) * np.clip(1.25 - t * 1.15, 0, 1)
        heat = np.clip(core * (1 - t) + 0.12, 0, 1)
        rgb = np.zeros((cell, cell, 3), np.float32)
        rgb[..., 0] = np.clip(200 + 80 * heat, 0, 255)
        rgb[..., 1] = 255 * np.clip(heat * 1.18, 0, 1) ** 1.5
        rgb[..., 2] = 190 * np.clip((heat - 0.88) / 0.20, 0, 1) ** 1.2
        cellimg = np.dstack([np.clip(rgb, 0, 255), a * 255]).astype(np.uint8)
        tex.paste(Image.fromarray(cellimg, "RGBA"), (cx, cy))
    tex.save(os.path.join(SPR, "flame.png"))

    # speed streak
    yy, xx = np.mgrid[0:32, 0:256]
    a = np.clip(1 - np.abs((xx / 256 * 2 - 1)) / 0.9, 0, 1) * np.clip(1 - np.abs((yy / 32 * 2 - 1)), 0, 1) ** 2
    img = np.zeros((32, 256, 4), np.uint8)
    img[..., 0], img[..., 1], img[..., 2] = 255, 245, 220
    img[..., 3] = (a * 190).astype(np.uint8)
    Image.fromarray(img, "RGBA").save(os.path.join(SPR, "streak.png"))

    # wood grain (logs, branches, huts)
    w = 256
    # grain runs along X: low-frequency along X, high-frequency across Y
    grain = smooth_noise(w, w, (3, 26))[..., 0]
    bands = 0.5 + 0.5 * np.sin(np.linspace(0, 26, w) * np.pi)[:, None]
    flat = np.tile(bands, (1, w))
    base = np.clip(0.62 * grain + 0.38 * flat, 0, 1)
    rgb = np.dstack([118 + 78 * base, 74 + 54 * base, 38 + 34 * base])
    Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).save(
        os.path.join(TEX, "wood.jpg"), quality=80, optimize=True)
    print("  fx: glow/shadow/dust/flame/streak + wood.jpg written")


def main():
    print("== sprites ==")
    slice_runner_sheet("runner_sheet.png")
    make_coin()
    # foliage / tree cutouts
    leaf = bbox_alpha(chroma_key_magenta(os.path.join(RAW, "foliage_leaf.png")), 2)
    leaf.save(os.path.join(SPR, "foliage.png"))
    print("  sprite: foliage.png", leaf.size)
    tree = bbox_alpha(chroma_key_magenta(os.path.join(RAW, "tree.png")), 2)
    tree = fit_height(tree, 900)
    tree.save(os.path.join(SPR, "tree.png"))
    print("  sprite: tree.png", tree.size)
    fb = bbox_alpha(key_black(os.path.join(RAW, "fireball.png")), 2)
    fb = fit_height(fb, 256)
    fb.save(os.path.join(SPR, "fireball.png"))
    print("  sprite: fireball.png", fb.size)

    print("== textures ==")
    make_texture("stone_path.png", "stone_path.jpg", 512)
    make_texture("stone_wall.png", "stone_wall.jpg", 512)
    make_texture("ground_jungle.png", "ground_jungle.jpg", 512)
    make_sky("sky_pano.png", "sky_pano.jpg")

    print("== ui ==")
    make_title("title_bg.png", "title_bg.jpg")
    make_demon("demon_idol.png", "demon_idol.png")

    print("== fx ==")
    make_fx()
    print("done.")


if __name__ == "__main__":
    main()
