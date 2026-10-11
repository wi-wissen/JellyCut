# Jelly Cut

Browser-based video editor for schools (Vue 3 Options API, TypeScript core, Vite, Vitest, Pinia, vue-i18n).

## Rules
- Chat with the user in German. Source code, identifiers, comments, commit messages: English. UI strings: i18n (de + en), never hardcoded in components.
- `src/core/` is pure TypeScript: no Vue, no DOM access, fully unit-tested with Vitest.
- `src/engine/` is the browser layer (WebGL2 compositor, WebCodecs/Mediabunny media access, audio, export). It may use DOM/WebCodecs APIs but must stay free of Vue and must run in a worker where possible (OffscreenCanvas). Everything it draws comes from a pure `Scene` built by `src/core/render/scene.ts`; preview and export share that path.
- Real-browser checks live in `scripts/e2e-*.mjs` (Playwright + Chromium + Vite dev server). The test Chromium decodes VP8/VP9/AV1/Opus but NOT H.264/AAC; fixtures in `tests/fixtures` are VP9/Opus WebM (plus one H.264 MP4 used to test the 'cannot decode' path).
- All times are whole integer microseconds (`Micros`, see `src/core/time.ts`). Never use floating seconds in the model.
- No new dependencies without asking. No GSAP, PixiJS, Konva.
- Keep comments sparse and only where the "why" is not obvious.
- Checks before finishing any task: `npm run typecheck` and `npm test` must pass.
