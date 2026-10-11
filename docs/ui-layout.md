# Editor layout spec (desktop, matches the approved mockups)

Reference size 1120x700, but the layout is fluid (flex/grid), never fixed px widths except where stated.

```
+--------------------------------------------------------------+
| TopBar (52px)  logo | project chip | ratio chip | undo redo | [theme] [Export]
+------------------+-------------------------------------------+
| Left (350px)     | Player stage (flex, dark --jc-stage bg)   |
|  TabBar          |   16:9 gradient placeholder + subtitle    |
|   3 groups       +-------------------------------------------+
|  Library panel   | ActionBar: play, frame back/fwd, time,    |
|  (media grid)    |  | Split(hot) FineCut Duplicate Flip      |
|                  |  Rotate Speed Mute Delete                 |
+------------------+-------------------------------------------+
| Timeline (236px): toolbar (magnet, snap label, zoom slider, fit)
|  ruler, tracks: Text, Overlay, Video, Original audio, Music, playhead
+--------------------------------------------------------------+
```

- TopBar: height 52px, panel background, bottom border. Logo = small rounded square with a violet/lime split gradient + "Jelly Cut". Export button right-aligned, lime (`--jc-signal`) with dark text, bold, 36px high.
- TabBar (top of left panel): three labelled groups, each a small uppercase muted heading (10px, letter-spacing .12em) over a row of tab buttons. Material: Media, Audio, Record. Design: Text, Sticker, Draw, Captions. Look: Filter, Transitions. Tab = icon + label, 34px high, active tab filled violet (`--jc-fill`), Sticker/Draw/Captions/Filter are "soon" (opacity .45, not clickable but visible).
- Library panel: heading "Media", 2-column grid of thumbnails (16:10, rounded 8px, gradient placeholder + file name bottom-left in white 11px), a dashed "+" tile, and a link line at the bottom (freeSources).
- Player stage: 14px padding, centered 16:9 box (max size), gradient placeholder, a subtitle sample at the bottom center (white bold 26px; one word highlighted with lime background).
- ActionBar: panel background, top and bottom border, 6px/10px padding. Play = 40px round violet button. Every action is a vertical stack: icon (18px) over label (10.5px, 600 weight), min-width 50px, min touch height 44px; "Split" has the lime "hot" style.
- Timeline: panel background, toolbar 36px, ruler 22px with mono 10px time labels, each track 38px high with an 84px label column (icon + name, muted) and a lane. Clips are rounded 6px boxes with a name (11px, white, 600) positioned by percentage from the project data; video clips use --jc-track-video-1/2/3; music uses --jc-music; original audio uses a striped waveform look in --jc-wave. Playhead = 2px violet vertical line with a small triangle at the top.
- Icons: inline SVG, 24px viewBox, stroke currentColor, width 2, round caps. Put them in one `Icon.vue` component with a `name` prop (no icon libraries).
- Dark mode: toggled by setting `data-theme` on <html> (button in TopBar); tokens are already defined in `src/ui/styles/tokens.css`.
- Touch targets >= 44px on buttons, every icon button has an aria-label or visible text. Focus ring is global.

## Track colours

- Video clips: three blues (`--jc-track-video-1..3`) alternate from clip to clip, so every cut is visible; white labels.
- Original audio: green striped wave (`--jc-wave`), dark labels.
- Added music: teal (`--jc-track-music`), white labels.
- Text: amber/gold (`--jc-track-text`), dark labels (`--jc-track-text-fg`).
- Selection: always a 2 px lime outline (`--jc-signal`) with corner handles, never a violet (`--jc-fill`) fill.
- All label pairs meet WCAG AA (4.5:1) in light and dark; lane swatches in the label column show the same colours.
