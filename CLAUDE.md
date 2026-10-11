# Jelly Cut

Browser-based video editor for schools (Vue 3 Options API, TypeScript core, Vite, Vitest, Pinia, vue-i18n).

## Rules
- Chat with the user in German. Source code, identifiers, comments, commit messages: English. UI strings: i18n (de + en), never hardcoded in components.
- `src/core/` is pure TypeScript: no Vue, no DOM access, fully unit-tested with Vitest.
- All times are whole integer microseconds (`Micros`, see `src/core/time.ts`). Never use floating seconds in the model.
- No new dependencies without asking. No GSAP, PixiJS, Konva.
- Keep comments sparse and only where the "why" is not obvious.
- Checks before finishing any task: `npm run typecheck` and `npm test` must pass.
