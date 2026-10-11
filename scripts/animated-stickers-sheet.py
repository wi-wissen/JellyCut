"""Dev-time helper of scripts/build-animated-stickers.mjs (Pillow + numpy, not shipped).

sheet:  APNG -> one WebP sprite sheet (grid of cells) and a JSON line with the numbers the catalogue needs.
static: PNG -> lossy WebP at the same size (the static twin of a new animated sticker).
Run as: python3 -I animated-stickers-sheet.py sheet|static ...
"""
import argparse
import json
import math
import os
import sys

import numpy as np
from PIL import Image


def decode(path):
    image = Image.open(path)
    frames, delays = [], []
    for index in range(image.n_frames):
        image.seek(index)
        frames.append(image.convert('RGBA').copy())
        delays.append(int(image.info.get('duration', 0)))
    return frames, delays


def small(frame):
    # Premultiplied at 64 px: transparent pixels carry no colour and do not count as motion.
    pixels = np.asarray(frame.resize((64, 64), Image.BILINEAR)).astype(np.float32)
    pixels[..., :3] *= pixels[..., 3:4] / 255.0
    return pixels


def loop_numbers(frames):
    pics = [small(f) for f in frames]
    steps = [float(np.abs(pics[i + 1] - pics[i]).mean()) for i in range(len(pics) - 1)]
    motion = sum(steps) / len(steps) if steps else 0.0
    wrap = float(np.abs(pics[0] - pics[-1]).mean())
    return motion, (wrap / motion if motion > 0 else 99.0)


def sheet(args):
    frames, delays = decode(args.input)
    count = len(frames)
    total_ms = sum(delays)
    if count < 2 or total_ms <= 0:
        raise SystemExit('not an animation: ' + args.input)
    stride = max(1, math.ceil(count / args.max_frames))
    kept = math.ceil(count / stride)
    # Evenly spaced picks, so the wrap from the last pick to the first is as long as every other step.
    picks = [min(count - 1, round(k * count / kept)) for k in range(kept)]
    cols = math.ceil(math.sqrt(kept))
    rows = math.ceil(kept / cols)
    cell = args.cell
    out = Image.new('RGBA', (cols * cell, rows * cell), (0, 0, 0, 0))
    for k, index in enumerate(picks):
        out.paste(frames[index].resize((cell, cell), Image.LANCZOS), ((k % cols) * cell, (k // cols) * cell))
    out.save(args.output, 'WEBP', quality=args.quality, alpha_quality=args.alpha_quality, method=6)
    frame_micros = round(total_ms * 1000 / kept)
    motion, ratio = loop_numbers(frames)
    print(json.dumps({
        'sourceFrames': count,
        'stride': stride,
        'frames': kept,
        'cols': cols,
        'rows': rows,
        'cell': cell,
        'frameMicros': frame_micros,
        'loopMicros': frame_micros * kept,
        'bytes': os.path.getsize(args.output),
        'motion': round(motion, 3),
        'loopRatio': round(ratio, 3),
    }))


def static(args):
    image = Image.open(args.input).convert('RGBA')
    if image.size != (args.size, args.size):
        image = image.resize((args.size, args.size), Image.LANCZOS)
    image.save(args.output, 'WEBP', quality=args.quality, method=6)
    print(json.dumps({'bytes': os.path.getsize(args.output)}))


parser = argparse.ArgumentParser()
sub = parser.add_subparsers(dest='command', required=True)
a = sub.add_parser('sheet')
a.add_argument('input')
a.add_argument('output')
a.add_argument('--cell', type=int, default=128)
a.add_argument('--quality', type=int, default=62)
a.add_argument('--alpha-quality', type=int, default=80)
a.add_argument('--max-frames', type=int, default=48)
a.set_defaults(run=sheet)
b = sub.add_parser('static')
b.add_argument('input')
b.add_argument('output')
b.add_argument('--size', type=int, default=256)
b.add_argument('--quality', type=int, default=88)
b.set_defaults(run=static)
parsed = parser.parse_args()
parsed.run(parsed)
sys.stdout.flush()
