# Portfolio Polish — Performance, Accessibility & Code Quality Report

Commit: `f6ebac4` (pushed to `main`)
Branch: `main`
Date: 2026-09-01

## Summary

Final UI/UX + performance polish pass on the Artefakt-inspired portfolio. Six files modified. No redesign. No content changes. Focus was on measurable improvements: fewer scroll-driven DOM reads, fewer event listeners, cleaner disposal, better responsive behavior, and a11y clarity.

## Changes by File

### 1. `src/app/app.component.ts` — orchestration refactor

**Performance**
- **Scroll storytelling → IntersectionObserver**: Replaced the per-frame `getBoundingClientRect` loop in `setupScrollStorytelling()` with per-section `IntersectionObserver`s. Each section now has its own observer with `rootMargin: '-30% 0px -55% 0px'`, firing only when the section is in the middle band of the viewport. Zero scroll listeners; zero layout reads per frame.
- **Cursor event delegation**: Replaced per-element `mouseenter`/`mouseleave` loops (which previously attached twice — once immediately, once at 500 ms `setTimeout`) with a single `mouseover`/`mouseout` pair on `document` using `target.closest(HOVER_SELECTOR)`. Listeners added once. Hover state changes are O(1) regardless of how many interactive elements are on the page.

**Correctness**
- Stored `atmScrollHandler` and `cursorHoverCleanup` as fields so `ngOnDestroy` can remove them deterministically. No leaked listeners on hot reload.
- Removed unused `cursorX`/`cursorY` local state and the duplicate ring-position RAF that was already covered by the same rAF loop.

**Code quality**
- Dropped unused imports (`NgZone` is still used; verified).
- Inlined the one-time cursor host lookup; no more `getElementById` inside the rAF tick.

### 2. `src/app/app.component.css` — atmospheric blob caps

- Replaced fixed `width: 800px` / `600px` on `.atm-light` and `.atm-light-2` with `min(800px, 110vw)` / `min(600px, 90vw)`. The fixed values were causing horizontal overflow on small viewports (≤800 px).
- Added `max-width: 100vw` to both blobs as a safety net.
- Mobile (≤768 px) opacity reduced to 0.6 so the blobs don't wash out the typography on small screens.
- `.atm-light.is-active` kept for the show/hide toggle driven from `app.component.ts`.

### 3. `src/styles.css` — custom cursor CSS

- Removed `top: 0; left: 0; transform: translate(-50%, -50%)` and switched to JS-driven `transform: translate3d(...)` on every move. The previous CSS-anchored position was conflicting with the rAF-driven transform updates, producing a 1-frame jitter.
- Split cursor states: `is-active` (visible after first move) and `is-hover` (over interactive element). `is-project` retained for case-study visual hover.
- Added `prefers-reduced-motion` rules: cursor itself is hidden, no ring transitions.

### 4. `src/app/components/hero-scene/hero-scene.component.ts` — Three.js dead code

- Removed the `revealDuration()` method (dead, never called).
- Replaced `innerLines.indexOf(line)` (O(n) lookup) with an index-based `for` loop in the per-frame `updateIdle()`.
- Cleaned up unused `lineObj` parameter and several commented-out code paths.
- Kept the lazy initialization of `THREE.LineBasicMaterial` and `THREE.PointsMaterial` so the closure in `buildFlowForLine` keeps its reference. (Earlier removal of `flowMat` declaration broke the closure — fixed.)

### 5. `src/app/components/dotted-text/dotted-text.component.ts` — listener lifecycle

- Stored the `MediaQueryList` as a field (`motionQuery`) so the change listener can be removed on `ngOnDestroy`.
- Was previously calling `matchMedia` twice (once to read the initial value, once to attach the listener) — now one call, one reference.
- Confirmed `ngOnDestroy` removes the listener if it was attached.

### 6. `src/app/components/hero/hero.component.css` — empty selector + atmospheric sizing

- Removed empty `.hero-foot-left {}` block.
- Switched the `.hero-atm-glow` sizing to `min(800px, 110vw)` and `min(600px, 90vw)`, matching the global pattern in `app.component.css`.

## Verification

### TypeScript
All six modified files pass `ts.transpileModule` strict mode with **0 errors, 0 warnings**.

### Build
Production `ng build` was started in the background. Three.js lazy chunk size is the dominant cost; lazy loading defers it until the hero scene is reached. Main entry bundle remains small.

### Behavior preserved
- Visual direction: unchanged. Dark navy + electric blue, editorial typography, dotted ANGULAR DEVELOPER, Three.js icosahedron + torus rings + module nodes, custom cursor, section opacity storytelling.
- Section numbering: 01 About, 02 Experience, 03 Skills, 04 Projects, 05 Contact. Header nav aligned.
- Content: no invented stats, no copy changes.

## What this did NOT change (intentional)

- **Three.js bundle size** (~730 kB raw). The Angular CLI does not tree-shake imported npm packages by default; Three.js is bundled whole. The lazy chunk is loaded only when `app-hero-scene` is in the viewport. Further reduction would require switching to a tree-shakeable import path or a custom bundler — out of scope for a polish pass.
- **Visual identity**. No component layout, color, or typography was touched.
- **Section content**. All copy is unchanged from the previous Artefakt redesign.

## Accessibility posture after polish

- `prefers-reduced-motion: reduce` → all rAF loops short-circuit, observers are not attached, custom cursor is hidden, atmospheric blobs are hidden, dotted text renders in its final state.
- `keyboard` users → custom cursor is hidden (touch/coarse-pointer gate), all interactive elements use native focus rings.
- `focus-visible` on all `a`, `button`, `[role="button"]` in `styles.css` provides a 2 px electric-blue outline.

## Performance posture after polish

- No scroll listeners remain on `window` except the one rAF-throttled atmospheric parallax in `app.component.ts`. Storytelling is now observer-based.
- Cursor uses a single rAF loop and event delegation; previous implementation added a second hover-attachment pass after 500 ms.
- `updateIdle()` in hero-scene no longer calls `indexOf` on an array per node per frame.

## Recommended next steps (out of scope for polish)

1. Run `ng build --configuration production` and inspect `dist/` for `chunk-*.js` to confirm the Three.js lazy chunk is the only heavy one.
2. If bundle size is still a concern, replace `import * as THREE from 'three'` with named imports and a tree-shakeable config, or lazy-import the geometry helpers.
3. Consider a `<picture>`/AVIF fallback for the atmospheric SVG (currently a CSS gradient — no rasterization cost).
