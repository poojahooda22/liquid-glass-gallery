import { CARDS, type Card } from '../content';
import { LOW_TIER } from '../config';

/**
 * Card labels, rasterised on a 2D canvas.
 *
 * Type is the one thing that does not belong on the GPU here. The reference
 * keeps its titles in the DOM and syncs them to each card with a matrix, for
 * exactly one reason: glyphs must never pass through the distortion. This
 * build gets the same result by drawing them into their own texture and
 * sampling it in a second pass with refraction switched off, so the edges
 * keep the antialiasing the browser's rasteriser gave them.
 */

export type LabelCanvas = HTMLCanvasElement;

const LABEL_W = LOW_TIER ? 512 : 896;
const LABEL_H = Math.round((LABEL_W * 3) / 4);

const SANS = 'ui-sans-serif, -apple-system, "Segoe UI", Inter, system-ui, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, "Cascadia Mono", monospace';

type Ctx = CanvasRenderingContext2D;

/** Best-effort tracking; Chromium supports it, other engines keep 0. */
function setTracking(x: Ctx, px: number): void {
  const c = x as Ctx & { letterSpacing?: string };
  if ('letterSpacing' in c) c.letterSpacing = px.toFixed(2) + 'px';
}

function drawLabel(x: Ctx, w: number, h: number, card: Card): void {
  x.clearRect(0, 0, w, h);

  /* Scrims kept deliberately light. The artwork behind the type runs from a
     night skyline to a white cloud deck, so some ground is needed, but a
     heavy gradient reads as a dark card rather than a bright one seen
     through glass. */
  const top = x.createLinearGradient(0, 0, 0, h * 0.2);
  top.addColorStop(0, 'rgba(0,0,0,0.38)');
  top.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = top;
  x.fillRect(0, 0, w, h * 0.2);

  const bottom = x.createLinearGradient(0, h * 0.48, 0, h);
  bottom.addColorStop(0, 'rgba(0,0,0,0)');
  bottom.addColorStop(0.6, 'rgba(0,0,0,0.26)');
  bottom.addColorStop(1, 'rgba(0,0,0,0.56)');
  x.fillStyle = bottom;
  x.fillRect(0, h * 0.48, w, h * 0.52);

  /* Split axes on purpose: the horizontal inset is what keeps type clear of
     the bevel, where refraction is strongest and a glyph sitting too close
     gets bent and colour-fringed. Vertical stays where it was so the meta row
     and the title keep their existing relationship to the card edges. */
  const padX = w * 0.085;
  const padY = w * 0.055;
  const metaY = padY + w * 0.019;
  x.textBaseline = 'alphabetic';
  x.font = '500 ' + (w * 0.0205).toFixed(1) + 'px ' + MONO;
  setTracking(x, w * 0.0024);

  x.textAlign = 'left';
  x.fillStyle = 'rgba(255,255,255,0.95)';
  x.fillText(card.code, padX, metaY);
  const codeWidth = x.measureText(card.code).width;
  x.fillStyle = 'rgba(255,255,255,0.66)';
  x.fillText(card.type, padX + codeWidth + w * 0.028, metaY);

  x.textAlign = 'right';
  x.fillStyle = 'rgba(255,255,255,0.55)';
  x.fillText('SELECTED WORK · 2026', w - padX, metaY);

  x.textAlign = 'left';
  setTracking(x, -w * 0.0014);
  x.font = '600 ' + (w * 0.079).toFixed(1) + 'px ' + SANS;
  x.fillStyle = '#ffffff';
  x.fillText(card.title, padX, h - padY - w * 0.046);

  setTracking(x, 0);
  x.font = '400 ' + (w * 0.0265).toFixed(1) + 'px ' + SANS;
  x.fillStyle = 'rgba(255,255,255,0.74)';
  x.fillText(card.desc, padX, h - padY);
}

export function buildLabelCanvases(): LabelCanvas[] {
  return CARDS.map((card) => {
    const canvas = document.createElement('canvas');
    canvas.width = LABEL_W;
    canvas.height = LABEL_H;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('2D context unavailable');
    drawLabel(ctx, LABEL_W, LABEL_H, card);
    return canvas;
  });
}

export function uploadLabels(gl: WebGL2RenderingContext, canvases: LabelCanvas[]): WebGLTexture[] {
  return canvases.map((source) => {
    const tex = gl.createTexture();
    if (!tex) throw new Error('createTexture returned null');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) {
      const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
      gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  });
}
