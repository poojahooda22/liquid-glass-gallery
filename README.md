# Infinite Liquid Glass — a reimplementation study

An infinite, draggable grid of cards rendered through a liquid-glass refraction
shader. Every card's artwork is generated procedurally on the GPU rather than
streamed, so nothing is fetched and nothing is licensed — the scenes are live,
not stills.

## Stack

- **Vite 7** + **TypeScript 5.9** — no framework, no runtime dependencies
- **Raw WebGL** — hand-written GLSL for the glass refraction and the scene painters

## Running it

```bash
npm install
npm run dev      # dev server
npm run build    # typecheck + production build to dist/
npm run preview  # serve the production build
```

## Layout

```
src/
  main.ts            entry — canvas, render loop, input
  layout.ts          the torus grid solver
  assign.ts          card → cell assignment (no card repeats near itself)
  content.ts         30 card records mapped onto 12 scene painters
  config.ts          tunables
  math.ts            vector / easing helpers
  spring.ts          drag inertia
  gl/
    program.ts       shader compile + link
    plane.ts         geometry
    textures.ts      texture allocation
    scenegen.ts      offscreen scene rendering
  shaders/
    glass.ts         the liquid-glass refraction shader
    scenes.ts        the twelve procedural scene painters
  style.css
```

## Interaction

Drag to explore. The grid wraps in both axes, so there is no edge to hit.
