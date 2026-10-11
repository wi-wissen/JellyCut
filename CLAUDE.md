# Jelly Cut

Browser-based video editor for schools (Vue 3 Options API, TypeScript core, Vite, Vitest, Pinia, vue-i18n, Tailwind v4). Multi-page static site: `/` landing, `/app/` editor, `/help/**` help pages. README.md has the architecture map, commands and the e2e list with ports.

## Rules
- Chat with the user in German. Source code, identifiers, comments, commit messages: English. UI strings: i18n (de + en), never hardcoded in components.
- `src/core/` is pure TypeScript: no Vue, no DOM access, fully unit-tested with Vitest.
- `src/engine/` is the browser layer (WebGL2 compositor, WebCodecs/Mediabunny media access, audio, export). It may use DOM/WebCodecs APIs but must stay free of Vue and must run in a worker where possible (OffscreenCanvas). Everything it draws comes from a pure `Scene` built by `src/core/render/scene.ts`; preview and export share that path.
- All times are whole integer microseconds (`Micros`, see `src/core/time.ts`). Never use floating seconds in the model.
- Project edits go through the single commit path of the editor store (`commitProject`); it also applies the invariants (overlays and texts end with the video, see `src/core/timeline/fit.ts`). Do not write project state around it.
- Texts: shared texts in `src/locales/{de,en}.json`; page texts in `src/locales/pages/<name>.{de,en}.json` (merged by `src/ui/i18n.ts`, a key lives in one file only). The de/en parity test, the templates audit and the contrast test must stay green.
- No new dependencies without asking. No GSAP, PixiJS, Konva. Approved: `lucide-vue-next` (icons), Mediabunny (pinned exactly). Vendored asset files are fine but need a licence note (README, `docs/sources-review.md`): Fluent Emoji stickers (MIT), Fontsource fonts (OFL), AI-generated help photos.
- Keep comments sparse and only where the "why" is not obvious.

## Checks
- Before finishing any task: `npm run typecheck` and `npm test` must pass. Also run `npm run build` when pages, `vite.config.ts` or `public/sw.js` change (CI runs it).
- Real-browser checks live in `scripts/e2e-*.mjs` (Playwright + Chromium + Vite dev server, each script has its own port, see README). Run them one after another, never in parallel; a second run often fixes a timing flake, a second failure is real. The test Chromium decodes VP8/VP9/AV1/Opus but NOT H.264/AAC; fixtures in `tests/fixtures` are VP9/Opus WebM, PNG stills (plus one H.264 MP4 for the 'cannot decode' path). Headless Chromium has no file dialogs: scripts disable `showSaveFilePicker` to use the download path.
- `docs/requirements-and-mockups.html` is the frozen original requirements artifact: do not edit it. Keep `docs/decisions.md` consistent (mark superseded decisions) and use `docs/release-checklist.md` before a release.
