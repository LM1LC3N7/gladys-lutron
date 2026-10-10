// -----------------------------------------------------------------------------
// Colour conversions: Gladys stores a colour as an integer 0xRRGGBB, LEAP
// speaks hue (0-360) and saturation (0-100); brightness is the zone level.
// -----------------------------------------------------------------------------

/**
 * @param {number} rgb integer 0xRRGGBB
 * @returns {{ hue: number, saturation: number }}
 */
export function rgbToHueSaturation(rgb) {
  const value = Math.max(0, Math.min(0xffffff, Math.round(Number(rgb) || 0)));
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  return {
    hue: Math.round((hue + 360) % 360),
    saturation: max === 0 ? 0 : Math.round((delta / max) * 100),
  };
}

/**
 * Full-brightness colour of a hue and saturation.
 *
 * @param {number} hue 0-360
 * @param {number} saturation 0-100
 * @returns {number} integer 0xRRGGBB
 */
export function hueSaturationToRgb(hue, saturation) {
  const h = (((Number(hue) || 0) % 360) + 360) % 360;
  const s = Math.max(0, Math.min(100, Number(saturation) || 0)) / 100;
  const chroma = s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = 1 - chroma;
  const [r, g, b] =
    h < 60
      ? [chroma, x, 0]
      : h < 120
        ? [x, chroma, 0]
        : h < 180
          ? [0, chroma, x]
          : h < 240
            ? [0, x, chroma]
            : h < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const byte = (channel) => Math.round((channel + m) * 255);
  return (byte(r) << 16) | (byte(g) << 8) | byte(b);
}
