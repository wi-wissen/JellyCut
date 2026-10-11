# Logo notes

- Idea: "sliced play". A soft, round-cornered play triangle (the "jelly") cut once by a straight slash (the "Cut"): video plus editing in one gesture.
- Colours: only violet #6D4CF5 (badge and the slash gap) and lime #C6F432 (the mark). Flat fills, no gradients, no outlines, no third colour.
- Construction (64x64): badge `rect` rx 14; mark = triangle (21.5,18) (47.5,32) (21.5,46) grown by a 5 unit radius; slash = 6 unit violet bar rotated 21 degrees through the centre.
- `public/favicon.svg` and `src/assets/logo.svg` (the top bar logo) are the same self-contained badge; they need no tile or CSS behind them and work on light (#F4F3FA) and dark (#0E0F14) pages.
- Usage: about 32 px high (the top bar uses 32 px) to the left of the bold wordmark "Jelly Cut", gap about 10 px; keep at least 4 px clear space around the badge.
- Minimum size: 16 px (favicon). Do not use it smaller; the slash closes up.
- Do not: round the cut edges, mirror the slash, recolour the mark (e.g. white or violet on lime), add a face, shadows or tentacles, or put the lime mark on a light background without the violet badge (lime on white has almost no contrast).
