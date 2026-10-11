# Checklist: review of the sources guide before a release

The guide at `/help/sources/` (`src/ui/views/SourcesGuideView.vue`, texts in `src/locales/pages/help-sources.de.json` and `help-sources.en.json` under `help.sources`) and the licence list in `src/core/credits/credits.ts` (`LICENSES`) must be re-checked before every release. Terms change; this list is the maintainer's record that the check happened.

Reviewed on: ____________  by: ____________  release: ____________

## 1. Links

Open each link in a current browser and confirm it is reachable and still the expected service.

- [ ] https://pixabay.com
- [ ] https://www.pexels.com
- [ ] https://unsplash.com
- [ ] https://commons.wikimedia.org
- [ ] https://openverse.org
- [ ] https://www.pexels.com/videos/
- [ ] https://pixabay.com/videos/
- [ ] https://pixabay.com/music/
- [ ] https://freemusicarchive.org/home
- [ ] Licence links in `LICENSES`: creativecommons.org (CC0 1.0, CC BY 4.0, CC BY-SA 4.0), pixabay.com/service/license-summary/, www.pexels.com/license/, unsplash.com/license

## 2. Licence statements

For every site, read the licence or terms page itself and confirm the statements in the guide still hold:

- [ ] Pixabay: the guide says the Pixabay Content License applies to photos, illustrations and music. Still true?
- [ ] Pexels (photos and videos): the Pexels License applies. Still true?
- [ ] Unsplash: the Unsplash License applies. Still true?
- [ ] Wikimedia Commons: each file has its own licence; the guide says so. Still true?
- [ ] Openverse: a search engine over openly licensed works; each result shows its licence. Still true?
- [ ] Free Music Archive: licences differ per track. Still true?

## 3. Jelly Cut defaults

- [ ] `needsAttribution` in `LICENSES` matches the licence terms. Pixabay, Pexels and Unsplash are set to "needs credit" (not strictly required by their terms, but the school workflow asks for it). Decide again whether that stays.
- [ ] Public domain has no official licence link in `LICENSES`; add one if a suitable source is confirmed.
- [ ] The example credit line in the guide matches what `generateCreditsText` produces for the same input (format: "Title by Author, source: Source (URL), licence: NAME (LICENCE URL)").

## 4. Wording

- [ ] No claim about a site goes beyond what the guide states. Keep wording cautious ("usually", "check the licence").
- [ ] German and English texts say the same thing.
- [ ] The school note (rules also apply when publishing outside school) still reflects the school's policy.
- [ ] The "what not to use" list and the rights notes live on `/help/rights/`. Check them against the same sources (no legal advice claims).
- [ ] Sticker artwork: https://github.com/microsoft/fluentui-emoji is still MIT (LICENSE file text unchanged), and `/help/tech/` still credits it.
- [ ] `/help/tech/`: each library or browser link still points to the project's official site, package homepage or MDN, and the version statements still match `package.json`.

## 5. Technical

- [ ] `node scripts/e2e-credits.mjs` passes (checks that every listed link is present with `target="_blank"` and `rel="noopener noreferrer"`).
- [ ] `node scripts/e2e-help.mjs` passes (help pages, navigation, links, overflow, screenshots).
- [ ] Guide readable at 390 px and in dark mode.
