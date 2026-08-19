# Infinite Liquid Glass — a reimplementation study

A reimplementation of [infinite-liquid-glass.shader.se](https://infinite-liquid-glass.shader.se):
a grid of glass cards laid out on a flat torus that is bent onto a sphere, so
the grid wraps in both axes and there is no edge to drag to.

The reference streams a video per card. This build renders each card's artwork
procedurally on the GPU instead — nothing is fetched, nothing is licensed, and
every card is live rather than a still. Thirty card records are mapped across
twelve scene painters.

The glass itself is one material on one subdivided plane: no transmission
material, no backdrop read, no render target, no post pass. Each card refracts
its **own** texture through a virtual slab described analytically by a signed
distance field, which is why a hundred panes cost about a hundred draw calls of
a single shared program.

## Stack

- **Vite 7** + **TypeScript 5.9** — no framework, zero runtime dependencies
- **WebGL2** with hand-written **GLSL ES 3.00**, ported from the reference's TSL node graph

## Running it

```bash
npm install
npm run dev      # dev server
npm run build    # tsc --noEmit, then vite build to dist/
npm run preview  # serve the production build
```

## Layout

```
src/
  main.ts            the frame loop — two draw calls per card
  config.ts          shipped constants from the teardown of the reference
  layout.ts          grid solver: cell count and card size against the
                     spherical projection, solved by bisection because
                     screen offset saturates toward the horizon
  assign.ts          which card lands in which cell — greedy graph colouring
                     over each cell's six staggered neighbours, so no card
                     repeats near itself
  content.ts         30 card records across 12 scene kinds
  spring.ts          damped spring (framer-motion's stiffness/damping/mass),
                     substepped at a fixed 8ms so motion matches at 60/144Hz
  math.ts            clamp, periodic wrap, perspective/TRS/quaternion matrices
                     — allocation-free in the frame loop
  gl/
    program.ts       shader compile/link that throws with the info log
    plane.ts         unit plane subdivided 16x12 for the spherical dish,
                     plus the spectral weights for dispersion
    textures.ts      card labels rasterised on a 2D canvas, sampled in a
                     second pass with refraction off so glyphs stay sharp
    scenegen.ts      card artwork + studio environment, re-rendered per frame
                     under a budget so the scenes stay in motion
  shaders/
    glass.ts         the liquid-glass material — SDF slab, refraction, dispersion
    scenes.ts        the twelve procedural scene painters
  style.css
```

## Interaction

Drag to explore.
