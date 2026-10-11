# Editor layout spec (desktop, matches the approved mockups)

Reference size 1120x700, but the layout is fluid (flex/grid), never fixed px widths except where stated.

```
+--------------------------------------------------------------+
| TopBar (52px)  logo | project chip | ratio chip | undo redo | [theme] [Export]
+------------------+-------------------------------------------+
| Left (350px)     | Player stage (flex, dark --jc-stage bg)   |
|  TabBar          |   16:9 picture, start card when empty     |
|   3 groups       +-------------------------------------------+
|  Left panel      | ActionBar: play, frame back/fwd, time,    |
|  (library, or    |  Split(hot) FineCut Duplicate Flip        |
|  the tab's panel)|  Rotate Speed Mute Delete                 |
+------------------+-------------------------------------------+
| Timeline (default 248px, resizable): toolbar 36px (magnet, snap, zoom, fit)
|  ruler 22px, lanes: Text, Overlay (up to 4 rows), Video, Original audio, Music, playhead
+--------------------------------------------------------------+
```

- TopBar: height 52px, panel background, bottom border. Logo: the flat badge of `src/assets/logo.svg` at 32 px (see [`logo-notes.md`](logo-notes.md)), links to the landing page. Export button right-aligned, lime (`--jc-signal`) with dark text, bold, 36px high (`h-9`).
- TabBar (top of left panel): three labelled groups, each a small uppercase muted heading (10px, letter-spacing .12em) over a row of tab buttons. Material: Media, Audio, Record. Design (two rows of three): Text, Aufkleber (stickers), Formen (rectangle, ellipse, arrow), Zeichnen (pen and marker), Verbergen (blur or pixelate areas), Bild im Bild (library pictures and videos). Look: Filter, Transitions. Tab = icon + label, 44px high, active tab filled violet (`--jc-fill`). Design tabs work as described in [`decisions.md`](decisions.md#design-tabs-one-way-to-work-with-every-item-ui).
- Library panel: heading "Media", 2-column grid of thumbnails (16:10, rounded 8px, file name bottom-left in white 11px), a dashed "+" tile, and a link line at the bottom to the sources guide (`/help/sources/`).
- Player stage: 14px padding, centered 16:9 box on the stage colour. With no clip, the start card is shown instead.
- ActionBar: panel background, top and bottom border, 6px/10px padding. Play = 40px round violet button. Every action is a vertical stack: icon (18px) over label (10.5px, 600 weight), min-width 50px, min touch height 44px; "Split" has the lime "hot" style.
- Format popover (ratio chip): format, the project-wide Fit / Fill switch, and the background (Blur or Colour) when Fit is on.
- Timeline: panel background, toolbar 36px, ruler 22px with mono 10px time labels. Label column 124px (icon + name, muted) and a lane. Each lane is 38px high (48px for touch). Clips are rounded boxes with a name (11px, white, 600) positioned by percentage from the project data. Video clips use `--jc-track-video-1/2/3`; music uses `--jc-track-music`; original audio uses a striped waveform look in `--jc-wave`. Playhead = 2px violet vertical line (`--jc-fill`) with a small triangle at the top.
- Video end: a dashed line marks the end of the last clip. Overlays and texts cannot be dragged, trimmed or added past it, and they are shortened when the video gets shorter (see decisions.md, 'Overlays end with the video').
- Timeline height: a grip above the panel (drag or arrow keys) sets it; minimum 160px, at most 70 % of the window height. The value is kept in this browser (`jellycut.timelineHeight`).
- Timeline overlay lane: up to four rows (28px each on a mouse). Overlaps beyond four rows share the last row; the selected bar is drawn on top. A context menu on items and a "more" button on touch.
- Icons: Lucide icons (`lucide-vue-next`), drawn through `src/ui/components/Icon.vue` by name. Stroke currentColor, round caps.
- Dark mode: toggled by setting `data-theme` on <html> (button in TopBar); tokens are in `src/ui/styles/tokens.css`. The choice of the static pages (landing, help) is kept in this browser too (`src/ui/site/theme.ts`).
- Touch targets >= 44px on buttons, every icon button has an aria-label or visible text. Focus ring is global.

## Breakpoints

- From 1100px: two columns (the left column of 350px and the stage). Below 1100px the left column becomes a tool sheet above the tab bar, which can be shown or hidden (`TabBar`, `sheetOpen`).
- Below 768px: phone layout. Below 1100px and 500px high (a landscape phone, for example) a compact set of rules applies.
- Coarse pointers (touch) get the 44px targets and the 48px timeline lanes whatever the width.

## Track colours

- Video clips: three blues (`--jc-track-video-1..3`) alternate from clip to clip, so every cut is visible; white labels.
- Original audio: green striped wave (`--jc-wave`), dark labels.
- Added music: teal (`--jc-track-music`), white labels.
- Text: amber/gold (`--jc-track-text`), dark labels (`--jc-track-text-fg`).
- Overlays (stickers, shapes, areas, pictures, pen): raspberry (`--jc-track-overlay`), light labels (`--jc-track-overlay-fg`).
- Selection: always a 2 px lime outline (`--jc-signal`) with corner handles, never a violet (`--jc-fill`) fill.
- All label pairs meet WCAG AA (4.5:1) in light and dark; lane swatches in the label column show the same colours. `src/ui/styles/tokens.contrast.test.ts` checks the pairs.

## Save state (project dot)

- The dot behind the project name tells where the work is kept; its tooltip and aria-label give the text (`ProjectMenu.vue`).
- Green: autosaved in this browser (or saved as a file when nothing changed since the last file save).
- Amber: unsaved changes (autosave pending), changes since the last save to the file, or "Not saved as a file yet" after 10 minutes of edits without a file.
- Red: the last autosave failed; the panel shows the reason. Grey with a pulse: saving. Demo sessions say nothing is saved.
