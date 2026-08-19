/**
 * Photographs, loaded from the CDN into their own textures.
 *
 * Deliberately separate from the card textures the glass samples. These are
 * the SOURCE images: the Ken Burns pass reads them and writes the result into
 * a card texture, so these get mipmaps (they are minified from 1200 wide to
 * the card's 896) while the card textures stay mip-free (refraction spikes
 * the uv derivative across the bevel, and a mipped fetch there is what turns
 * the lens back into a smear).
 *
 * A failed or slow load is not an error state: that card simply keeps
 * rendering its procedural scene until the image arrives, so the grid is
 * complete from the first frame and fills in as the network allows.
 */

export type ImageBank = {
  /** The source texture for a pool slot, or null while it is still loading. */
  textureFor(slot: number): WebGLTexture | null;
  /** Source aspect, for cover-fitting against the card. */
  aspect(slot: number): number;
  readonly count: number;
  dispose(): void;
};

export function createImageBank(gl: WebGL2RenderingContext, urls: readonly string[]): ImageBank {
  const textures: (WebGLTexture | null)[] = urls.map(() => null);
  const aspects: number[] = urls.map(() => 4 / 3);
  let disposed = false;

  urls.forEach((url, i) => {
    const img = new Image();
    /* Required for the texture upload. Without it the image still paints in a
       DOM element but taints the context, and texImage2D throws. */
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';

    img.onload = () => {
      if (disposed) return;
      const tex = gl.createTexture();
      if (!tex) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      /* Card uv has v=0 at the bottom; an image decodes top-row-first, so it
         needs the same flip the labels and video frames get. */
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
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
      if (img.naturalHeight > 0) aspects[i] = img.naturalWidth / img.naturalHeight;
      textures[i] = tex;
    };
    /* Left null on failure. The card keeps its procedural scene rather than
       showing a hole, so one dead URL costs one photograph, not the grid. */
    img.onerror = () => {};
    img.src = url;
  });

  return {
    count: urls.length,
    textureFor: (slot) => textures[slot] ?? null,
    aspect: (slot) => aspects[slot] ?? 4 / 3,
    dispose() {
      disposed = true;
      for (const t of textures) if (t) gl.deleteTexture(t);
      textures.fill(null);
    },
  };
}
