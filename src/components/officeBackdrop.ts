/**
 * A virtual office to sit each interviewer in (2026-10-13).
 *
 * The user: "the avatars have a black background that looks weird — make it
 * like the ones in Zoom, a virtual one of an office", then "for all avatars
 * different backgrounds". A 3D head is drawn on a flat clear colour, so each
 * tile was a face on a slab of near-black. This is the picture behind it
 * instead: a softly blurred room painted on a canvas, so it needs no image
 * file and no network, and costs nothing until a face is shown.
 *
 * Every persona gets a room of their own: the persona id seeds a small
 * generator that picks the colours (wall, sky, wood, plant), which side the
 * window is on, what stands opposite it (a bookshelf, a wall of frames, or a
 * shelf of plants), and where the lamp and the picture sit. The same person
 * always has the same room; two people almost never do.
 *
 * The blur is the point: it is a backdrop, and reads as depth of field the
 * way a Zoom virtual background does, so the face stays the sharpest thing in
 * the tile.
 */

const W = 800;
const H = 600;

/**
 * Real photographs, when there are any: every image in `src/assets/office/`
 * is a room somebody can sit in, and a persona is given one by their id. With
 * none there (or outside Vite, where the glob does not exist) the painted
 * rooms below are used, so nothing is ever missing.
 */
function photoList(): string[] {
  try {
    // @ts-ignore: Vite's glob; absent under plain node and in the tests.
    const found = import.meta.glob("../assets/office/*.{jpg,jpeg,png,webp}", {
      eager: true,
      query: "?url",
      import: "default",
    }) as Record<string, string>;
    return Object.keys(found)
      .sort()
      .map((key) => found[key]!);
  } catch {
    return [];
  }
}
const PHOTOS = photoList();

function photoFor(persona: string): string | null {
  if (PHOTOS.length === 0) return null;
  const rnd = seeded(persona + ":photo");
  return PHOTOS[Math.floor(rnd() * PHOTOS.length) % PHOTOS.length] ?? null;
}

/** A seeded stream of numbers in [0, 1): the same id, the same room. */
function seeded(persona: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < persona.length; i++) {
    h ^= persona.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${Math.round(((h % 360) + 360) % 360)}, ${Math.round(s)}%, ${Math.round(l)}%, ${a})`;
}

function rect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string | CanvasGradient) {
  g.fillStyle = fill;
  g.fillRect(x, y, w, h);
}

function paint(persona: string): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const rnd = seeded(persona);
  const between = (lo: number, hi: number) => lo + rnd() * (hi - lo);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rnd() * items.length) % items.length]!;

  // The room's character: one wall hue, a different sky, a wood, a plant.
  const wallHue = between(0, 360);
  const skyHue = pick([200, 210, 25, 35, 150, 280, 190]);
  const woodHue = between(18, 40);
  const plantHue = between(95, 160);
  const warm = rnd() < 0.6;
  const windowLeft = rnd() < 0.5;
  const opposite = pick(["books", "frames", "plants"] as const);
  const plantLeft = rnd() < 0.5;
  const booksHue0 = between(0, 360);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d");
  if (!g) return null;

  // The room is drawn onto a scratch layer first and blurred as one: a
  // blurred wall with a sharp window edge would not look out of focus.
  const layer = document.createElement("canvas");
  layer.width = W;
  layer.height = H;
  const c = layer.getContext("2d");
  if (!c) return null;

  // Wall, lit from the window's side.
  const wall = c.createLinearGradient(windowLeft ? 0 : W, 0, windowLeft ? W : 0, 0);
  wall.addColorStop(0, hsl(wallHue, between(14, 32), between(82, 90)));
  wall.addColorStop(1, hsl(wallHue + between(-12, 12), between(14, 34), between(66, 76)));
  rect(c, 0, 0, W, H, wall);

  // Window: a sky, a few far buildings, and a frame with a mullion.
  const ww = between(210, 290);
  const wh = between(250, 330);
  const wx = windowLeft ? 36 : W - ww - 36;
  const wy = between(50, 90);
  const sky = c.createLinearGradient(0, wy, 0, wy + wh);
  sky.addColorStop(0, hsl(skyHue, between(55, 80), between(78, 86)));
  sky.addColorStop(1, hsl(skyHue + 10, between(35, 60), between(90, 95)));
  rect(c, wx, wy, ww, wh, sky);
  c.save();
  c.beginPath();
  c.rect(wx, wy, ww, wh);
  c.clip();
  const towers = 3 + Math.floor(rnd() * 4);
  let tx = 0;
  for (let i = 0; i < towers && tx < ww; i++) {
    const bw = between(36, 66);
    const top = between(wh * 0.35, wh * 0.72);
    rect(c, wx + tx, wy + top, bw, wh - top, hsl(skyHue + 15, 22, between(52, 64), 0.5));
    tx += bw + between(2, 14);
  }
  c.restore();
  const frame = hsl(wallHue, 20, between(94, 99));
  c.strokeStyle = frame;
  c.lineWidth = 14;
  c.strokeRect(wx, wy, ww, wh);
  rect(c, wx + ww / 2 - 5, wy, 10, wh, frame);
  if (rnd() < 0.6) rect(c, wx, wy + wh / 2 - 5, ww, 10, frame);
  // Light from the window across the wall.
  const beam = c.createRadialGradient(wx + ww / 2, wy + wh / 2, 20, wx + ww / 2, wy + wh / 2, 470);
  beam.addColorStop(0, "rgba(255,255,255,0.38)");
  beam.addColorStop(1, "rgba(255,255,255,0)");
  rect(c, 0, 0, W, H, beam);

  // What stands opposite the window.
  const ox = windowLeft ? W - 250 : 40;
  const woodDark = hsl(woodHue, between(25, 45), between(26, 42));
  if (opposite === "books") {
    const sw = between(190, 230);
    const sy = between(40, 80);
    const sh = between(380, 430);
    const rows = rnd() < 0.5 ? 3 : 4;
    const rowH = (sh - 20) / rows;
    rect(c, ox, sy, sw, sh, woodDark);
    for (let row = 0; row < rows; row++) {
      const top = sy + 10 + row * rowH;
      rect(c, ox + 10, top, sw - 20, rowH - 12, "rgba(0,0,0,0.28)");
      let x = ox + 14;
      while (x < ox + sw - 26) {
        const bw = between(10, 24);
        const bh = between(rowH * 0.45, rowH - 18);
        rect(c, x, top + rowH - 12 - bh, bw, bh, hsl(booksHue0 + between(-70, 70) + row * 40, between(30, 55), between(34, 66)));
        x += bw + 2;
      }
    }
  } else if (opposite === "frames") {
    // A grid of frames, as on a gallery wall.
    const n = 4 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const fw = between(60, 110);
      const fh = between(70, 130);
      const fx = ox + (i % 2) * 110 + between(-6, 10);
      const fy = 60 + Math.floor(i / 2) * 135 + between(-6, 10);
      rect(c, fx, fy, fw, fh, hsl(woodHue, 30, between(20, 90)));
      rect(c, fx + 7, fy + 7, fw - 14, fh - 14, hsl(rnd() * 360, between(30, 55), between(60, 82)));
      rect(c, fx + 7, fy + (fh - 14) * 0.6, fw - 14, (fh - 14) * 0.4 + 7, hsl(rnd() * 360, between(25, 45), between(40, 58), 0.7));
    }
  } else {
    // Two floating shelves, each with plants and a few objects.
    for (let i = 0; i < 2; i++) {
      const sy = 150 + i * 150;
      rect(c, ox, sy, 210, 10, woodDark);
      let x = ox + 14;
      while (x < ox + 190) {
        const kind = rnd();
        if (kind < 0.55) {
          c.fillStyle = hsl(plantHue + between(-20, 20), between(35, 55), between(36, 52));
          c.beginPath();
          c.ellipse(x + 14, sy - 26, 16, between(22, 38), between(-0.4, 0.4), 0, Math.PI * 2);
          c.fill();
          rect(c, x + 4, sy - 12, 20, 12, hsl(between(0, 40), between(30, 50), between(55, 70)));
          x += 36;
        } else {
          const bh = between(22, 52);
          rect(c, x, sy - bh, between(14, 26), bh, hsl(rnd() * 360, between(30, 55), between(40, 70)));
          x += 30;
        }
      }
    }
  }

  // A picture and a wall lamp between window and opposite side.
  const px = W / 2 - between(40, 100);
  const pw = between(100, 160);
  const ph = between(70, 110);
  rect(c, px, 80, pw, ph, hsl(wallHue, 15, between(92, 98)));
  rect(c, px + 9, 89, pw - 18, ph - 18, hsl(skyHue + between(-30, 30), between(35, 60), between(70, 84)));
  rect(c, px + 9, 80 + ph * 0.6, pw - 18, ph * 0.4 - 9, hsl(plantHue, 30, between(40, 55), 0.55));
  const lampColor = warm ? hsl(between(30, 48), 100, 82) : hsl(between(190, 215), 80, 90);
  const glow = c.createRadialGradient(W / 2, 250, 6, W / 2, 250, 130);
  glow.addColorStop(0, lampColor);
  glow.addColorStop(1, "rgba(255,255,255,0)");
  rect(c, W / 2 - 140, 120, 280, 260, glow);

  // A plant in a pot, low in a corner.
  const kx = plantLeft ? between(90, 150) : W - between(90, 150);
  c.fillStyle = hsl(between(8, 30), between(40, 55), between(50, 62));
  c.beginPath();
  c.moveTo(kx - 34, H - 150);
  c.lineTo(kx + 34, H - 150);
  c.lineTo(kx + 24, H - 90);
  c.lineTo(kx - 24, H - 90);
  c.closePath();
  c.fill();
  const leaves = 4 + Math.floor(rnd() * 4);
  for (let i = 0; i < leaves; i++) {
    const a = (i / (leaves - 1) - 0.5) * 1.5;
    c.fillStyle = hsl(plantHue + between(-12, 12), between(35, 52), between(36, 52));
    c.beginPath();
    c.ellipse(kx + Math.sin(a) * 36, H - 150 - Math.cos(a) * 50 - between(0, 30), between(14, 22), between(46, 78), a, 0, Math.PI * 2);
    c.fill();
  }

  // The desk across the bottom, where the shoulders will cover most of it.
  const desk = c.createLinearGradient(0, H - 90, 0, H);
  desk.addColorStop(0, hsl(woodHue, between(25, 45), between(30, 44)));
  desk.addColorStop(1, "rgba(0,0,0,0.55)");
  rect(c, 0, H - 90, W, 90, desk);

  // Out of focus, and a touch softer in tone so the face is the brightest
  // thing: `filter` is missing in Safari, where the room is simply sharp.
  g.filter = "blur(7px)";
  g.drawImage(layer, -12, -12, W + 24, H + 24);
  g.filter = "none";
  rect(g, 0, 0, W, H, "rgba(255,255,255,0.06)");
  return canvas;
}

const canvases = new Map<string, HTMLCanvasElement | null>();
const urls = new Map<string, string>();

/** The room behind this interviewer, as a canvas (for a WebGL texture). */
export function officeBackdrop(persona: string): HTMLCanvasElement | null {
  if (!canvases.has(persona)) canvases.set(persona, paint(persona));
  return canvases.get(persona) ?? null;
}

/** The room as a canvas, a photograph where there is one (a little out of
 *  focus, so the face is the sharpest thing in the tile) and the painted room
 *  otherwise. Resolves to null only where no canvas can be made. */
export function officeBackdropImage(persona: string): Promise<HTMLCanvasElement | null> {
  const url = photoFor(persona);
  if (!url || typeof document === "undefined") return Promise.resolve(officeBackdrop(persona));
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const g = canvas.getContext("2d");
      if (!g) return resolve(officeBackdrop(persona));
      // Cover-crop to the tile's 4:3, centred.
      const scale = Math.max(W / image.naturalWidth, H / image.naturalHeight);
      const w = image.naturalWidth * scale;
      const h = image.naturalHeight * scale;
      g.filter = "blur(3px)";
      g.drawImage(image, (W - w) / 2 - 6, (H - h) / 2 - 6, w + 12, h + 12);
      g.filter = "none";
      resolve(canvas);
    };
    image.onerror = () => resolve(officeBackdrop(persona));
    image.src = url;
  });
}

/** The same room as a CSS background-image value, for the photo and the tile
 *  that stand in until the 3D head is ready. Empty when it cannot be drawn. */
export function officeBackdropCss(persona: string): string {
  const photo = photoFor(persona);
  if (photo) return `url(${photo})`;
  let url = urls.get(persona);
  if (url === undefined) {
    try {
      url = officeBackdrop(persona)?.toDataURL("image/jpeg", 0.82) ?? "";
    } catch {
      url = "";
    }
    urls.set(persona, url);
  }
  return url ? `url(${url})` : "";
}
