import { LOW_TIER } from '../config';

/**
 * Video-backed card content — the reference's own scheme, rebuilt on plain
 * WebGL2.
 *
 * How the reference actually does it, read off the running page rather than
 * guessed at:
 *
 *   - There is not a single <video> element in the document. Every one is
 *     created with document.createElement('video') and never appended; the
 *     browser will still decode and play a detached element, and keeping it
 *     out of the tree means no layout, no compositing layer, and no chance of
 *     a stray video box painting over the canvas.
 *   - Each element's currentSrc is a blob: URL, which means MSE — hls.js
 *     attaching a MediaSource and feeding it segments from a Mux .m3u8. The
 *     manifest is capped by rendition height on weak devices rather than
 *     letting ABR pick 1080p for a card that is 400px wide.
 *   - 19 video textures serve 100 meshes. Materials are shared: roughly five
 *     meshes point at the same material, which is why the grid visibly
 *     repeats. Nineteen simultaneous decodes is already a lot; a hundred
 *     would not run anywhere.
 *   - Elements are muted, looped, playsInline and autoplaying. Muted is not a
 *     preference, it is the precondition for autoplay without a gesture, and
 *     it has to be set as BOTH the property and the attribute for iOS.
 *   - Texture upload is driven by requestVideoFrameCallback, so a texture is
 *     only re-uploaded when the decoder actually produced a new frame. A 24fps
 *     source on a 120Hz display otherwise costs five identical uploads per
 *     frame, per card.
 *
 * The bank below does all of that. Cards with no video fall through to the
 * procedural scene bank, so a partial list is fine and the low-tier cap is
 * just a smaller list.
 */

export type VideoSource = {
  /** .m3u8 for HLS, or any file an <video> can play directly. */
  src: string;
  /** Optional still shown until the first frame decodes. */
  poster?: string;
};

export type VideoBank = {
  /** The texture for a pool slot, or null until its first frame decodes. */
  textureFor(slot: number): WebGLTexture | null;
  /** Source aspect, for cover-fitting against the card. */
  aspect(slot: number): number;
  readonly count: number;
  /** Upload any decoded frames. Call once per frame, before drawing. */
  update(): void;
  dispose(): void;
};

/* Device tiering, matching the reference's own thresholds. */
const MAX_VIDEOS = LOW_TIER ? 8 : 19;
const MAX_HEIGHT = LOW_TIER ? 540 : 1080;

type Slot = {
  el: HTMLVideoElement;
  tex: WebGLTexture;
  dirty: boolean;
  ready: boolean;
  aspect: number;
  detach: () => void;
};

type HlsLike = {
  loadSource(url: string): void;
  attachMedia(el: HTMLVideoElement): void;
  on(event: string, cb: (e: unknown, data: unknown) => void): void;
  destroy(): void;
  autoLevelCapping: number;
  levels: { height?: number }[];
};
type HlsCtor = {
  new (cfg?: Record<string, unknown>): HlsLike;
  isSupported(): boolean;
  Events: { ERROR: string; MANIFEST_PARSED: string };
};

/**
 * hls.js if it is available, otherwise nothing.
 *
 * Checked as a global first, so `npm i hls.js` plus a static import in your
 * own entry file wins and nothing is fetched. Otherwise the module URL from
 * config is imported at runtime. It is deliberately a full URL and held in a
 * variable: a bare "hls.js" specifier would either fail to resolve in the
 * browser or force the bundler to hard-depend on a package most builds of
 * this project do not need. Safari needs neither path — it plays .m3u8
 * natively, and layering hls.js on top of that is strictly worse.
 */
let hlsPromise: Promise<HlsCtor | null> | null = null;
function getHls(url: string): Promise<HlsCtor | null> {
  if (hlsPromise) return hlsPromise;
  const g = (globalThis as { Hls?: HlsCtor }).Hls;
  if (g?.isSupported?.()) {
    hlsPromise = Promise.resolve(g);
    return hlsPromise;
  }
  if (!url) {
    hlsPromise = Promise.resolve(null);
    return hlsPromise;
  }
  const spec = url;
  hlsPromise = import(/* @vite-ignore */ spec)
    .then((mod: { default?: HlsCtor }) => {
      const H = mod.default ?? (globalThis as { Hls?: HlsCtor }).Hls;
      return H?.isSupported?.() ? H : null;
    })
    .catch(() => null);
  return hlsPromise;
}

function nativeHls(el: HTMLVideoElement): boolean {
  return el.canPlayType('application/vnd.apple.mpegurl') !== '';
}

export function createVideoBank(
  gl: WebGL2RenderingContext,
  sources: readonly VideoSource[],
  hlsUrl = '',
): VideoBank {
  /* Capped by device tier. Simultaneous decodes are the real cost here, not
     the draws: the caller cycles cards over whatever slots exist, the same
     way the reference shares nineteen clips across a hundred meshes. */
  const list = sources.slice(0, Math.min(sources.length, MAX_VIDEOS));
  const slots: Slot[] = [];

  /* One grey texel per slot, so a card that has not decoded yet draws as a
     neutral pane instead of flashing black through the glass. */
  function placeholder(): WebGLTexture {
    const tex = gl.createTexture();
    if (!tex) throw new Error('createTexture returned null');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([28, 30, 38, 255]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  for (const source of list) {
    const el = document.createElement('video');
    /* Never appended to the document — see the note at the top. */
    el.crossOrigin = 'anonymous';
    el.loop = true;
    el.muted = true;
    el.defaultMuted = true;
    el.playsInline = true;
    el.autoplay = true;
    el.preload = 'auto';
    /* The attributes as well as the properties: iOS reads the attribute when
       it decides whether an autoplay is allowed, and ignores the property. */
    el.setAttribute('muted', '');
    el.setAttribute('playsinline', '');
    el.setAttribute('autoplay', '');
    if (source.poster) el.poster = source.poster;

    const slot: Slot = {
      el, tex: placeholder(), dirty: false, ready: false, aspect: 4 / 3,
      detach: () => {},
    };

    const markDirty = (): void => {
      slot.dirty = true;
      if (el.videoWidth > 0) slot.aspect = el.videoWidth / el.videoHeight;
    };

    /* Three.js drives VideoTexture this way and so does this: only flag an
       upload when the decoder hands over a new frame. Without it a 24fps clip
       on a 120Hz display uploads the same pixels five times per frame. */
    type RVFC = HTMLVideoElement & {
      requestVideoFrameCallback?(cb: () => void): number;
      cancelVideoFrameCallback?(handle: number): void;
    };
    const rv = el as RVFC;
    if (typeof rv.requestVideoFrameCallback === 'function') {
      let handle = 0;
      let cancelled = false;
      const tick = (): void => {
        markDirty();
        if (!cancelled) handle = rv.requestVideoFrameCallback!(tick);
      };
      handle = rv.requestVideoFrameCallback(tick);
      slot.detach = () => {
        cancelled = true;
        rv.cancelVideoFrameCallback?.(handle);
      };
    } else {
      /* Firefox has no rVFC yet: fall back to timeupdate plus a per-frame
         readiness check in update(). */
      el.addEventListener('timeupdate', markDirty);
      slot.detach = () => el.removeEventListener('timeupdate', markDirty);
    }

    const start = (): void => {
      el.muted = true;
      /* A rejected play() is normal on a cold load with no user gesture; the
         pointerdown handler in main.ts retries. It must not throw here. */
      void el.play().catch(() => {});
    };
    el.addEventListener('loadeddata', () => { slot.ready = true; markDirty(); start(); });
    el.addEventListener('canplay', start);

    if (source.src.includes('.m3u8') && !nativeHls(el)) {
      void getHls(hlsUrl).then((Hls) => {
        if (!Hls) {
          /* No hls.js and no native support: try the URL anyway rather than
             leaving the card grey forever. */
          el.src = source.src;
          el.load();
          return;
        }
        const hls = new Hls({ capLevelToPlayerSize: false });
        hls.loadSource(source.src);
        hls.attachMedia(el);
        /* Cap the rendition by height. A card is a few hundred pixels wide on
           a sphere; pulling 1080p for it burns bandwidth and decode budget for
           detail the refraction immediately throws away. */
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          let best = -1;
          for (let i = 0; i < hls.levels.length; i++) {
            if ((hls.levels[i]?.height ?? 0) <= MAX_HEIGHT) best = i;
          }
          if (best >= 0) hls.autoLevelCapping = best;
        });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if ((data as { fatal?: boolean })?.fatal) hls.destroy();
        });
        const prev = slot.detach;
        slot.detach = () => { prev(); hls.destroy(); };
      });
    } else {
      el.src = source.src;
      el.load();
    }

    slots.push(slot);
  }

  /* Browsers block autoplay until the page has been interacted with. The
     reference gets away with it because the videos are muted, but a muted
     autoplay can still be refused on a first visit; retrying on the first
     pointer costs nothing and fixes the case where it was. */
  const kick = (): void => { for (const s of slots) void s.el.play().catch(() => {}); };
  window.addEventListener('pointerdown', kick, { once: true });
  window.addEventListener('touchstart', kick, { once: true });

  function update(): void {
    for (const slot of slots) {
      if (!slot.dirty) continue;
      const el = slot.el;
      if (el.readyState < 2 || el.videoWidth === 0) continue;
      slot.dirty = false;
      gl.bindTexture(gl.TEXTURE_2D, slot.tex);
      /* Card uv has v=0 at the bottom; a video frame arrives top-row-first,
         same as a canvas, so it needs the same flip the labels get. */
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      /* No mipmaps, for the same reason the procedural scenes have none:
         refraction spikes the uv derivative across the bevel, and a mipped
         sample drops to a blurry level exactly where the lens detail should
         be sharpest. */
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  function textureFor(slot: number): WebGLTexture | null {
    const s = slots[slot];
    return s && s.ready ? s.tex : null;
  }

  function aspect(slot: number): number {
    return slots[slot]?.aspect ?? 4 / 3;
  }

  function dispose(): void {
    for (const slot of slots) {
      slot.detach();
      slot.el.pause();
      slot.el.removeAttribute('src');
      slot.el.load();
      gl.deleteTexture(slot.tex);
    }
    slots.length = 0;
  }

  return { textureFor, aspect, count: list.length, update, dispose };
}
