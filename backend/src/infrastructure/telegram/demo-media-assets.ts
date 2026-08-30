import { deflateSync } from "node:zlib";

/**
 * Deterministic demo media bytes. The demo workspace has no Telegram CDN to
 * download from, so received-media downloads are synthesized locally: photos
 * get a generated PNG whose color is derived from the media id, and videos
 * get a bundled one-second VP9 clip (Electron's bundled Chromium has no
 * H.264 decoder, so the clip uses a codec the runtime can actually play).
 */

// ffmpeg -f lavfi -i color=c=0x2563eb:s=96x96:d=1:r=10 -c:v libvpx-vp9 -pix_fmt yuv420p -an
const DEMO_VIDEO_WEBM_BASE64 =
  "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAALCEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsggKs7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAyV0GNTGF2ZjYyLjEyLjEwMkSJiECPQAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYigqVnTalK39ZyBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhAX14QDgkLCBYLqBYJqBAlWwhFW5gQESVMNnQIBzc6BjwIBnyJpFo4dFTkNPREVSRIeNTGF2ZjYyLjEyLjEwMnNz2mPAi2PFiKCpWdNqUrf1Z8ilRaOHRU5DT0RFUkSHmExhdmM2Mi4yOC4xMDIgbGlidnB4LXZwOWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnVA++eBAKOwgQAAgIJJg0IABfAF9gA4JBwYSgAAMGAAAHyp//9cwZ///9uSD//+rsZYMlLEaxQAo5SBAGQAhgBAkpwAUAAAAyAAAFkw4KOUgQDIAIYAQJKcAE7gAAMgAABZMOCjlIEBLACGAECSnABQAAADIAAAWTDgo5SBAZAAhgBAkpwATUAAAyAAAFkw4KOUgQH0AIYAQJKcAFAAAAMgAABZMOCjlIECWACGAECSnABO4AADIAAAWTDgo5SBArwAhgBAkpwAUAAAAyAAAFkw4KOUgQMgAIYAQJKcAEogAAMgAABZMOCjlIEDhACGAECSnABQAAADIAAAWTDgHFO7a5G7j7OBALeK94EB8YIBq/CBAw==";

const DEMO_IMAGE_WIDTH = 640;
const DEMO_IMAGE_HEIGHT = 480;

export function demoVideoWebm(): Buffer {
  return Buffer.from(DEMO_VIDEO_WEBM_BASE64, "base64");
}

/** Builds a valid RGB PNG; the gradient hue is a pure function of `seed`. */
export function demoImagePng(seed: string): Buffer {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  const base = [
    (hash & 0x7f) + 48,
    ((hash >> 8) & 0x7f) + 48,
    ((hash >> 16) & 0x7f) + 48,
  ];

  const stride = 1 + DEMO_IMAGE_WIDTH * 3;
  const raw = Buffer.alloc(stride * DEMO_IMAGE_HEIGHT);
  for (let y = 0; y < DEMO_IMAGE_HEIGHT; y += 1) {
    const offset = y * stride;
    raw[offset] = 0; // filter: none
    const shade = Math.floor((y / DEMO_IMAGE_HEIGHT) * 96);
    for (let x = 0; x < DEMO_IMAGE_WIDTH; x += 1) {
      const pixel = offset + 1 + x * 3;
      raw[pixel] = Math.min(255, base[0] + shade);
      raw[pixel + 1] = Math.min(255, base[1] + shade);
      raw[pixel + 2] = Math.min(255, base[2] + shade);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(DEMO_IMAGE_WIDTH, 0);
  header.writeUInt32BE(DEMO_IMAGE_HEIGHT, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // color type: truecolor RGB
  // compression (10), filter (11) and interlace (12) stay 0.
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
