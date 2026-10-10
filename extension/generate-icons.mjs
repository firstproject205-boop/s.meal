import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

function createPng(width, height) {
  // RGBA buffer: fill with a gentle warm circle
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const cx = width / 2;
  const cy = height / 2;
  const r = width * 0.42;

  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= r) {
        // Warm peach / coral tone (#d9776b)
        raw[offset++] = 217; // R
        raw[offset++] = 119; // G
        raw[offset++] = 107; // B
        raw[offset++] = 255; // A
      } else if (dist <= r + 1) {
        // Anti-aliased edge
        const alpha = Math.max(0, Math.min(255, Math.round((r + 1 - dist) * 255)));
        raw[offset++] = 217;
        raw[offset++] = 119;
        raw[offset++] = 107;
        raw[offset++] = alpha;
      } else {
        raw[offset++] = 0;
        raw[offset++] = 0;
        raw[offset++] = 0;
        raw[offset++] = 0;
      }
    }
  }

  const compressed = zlib.deflateSync(raw);

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) {
        c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
      }
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const crc = crc32(Buffer.concat([typeBuf, data]));
    crcBuf.writeUInt32BE(crc, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type 6: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const outDir = path.resolve('extension/icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const buf = createPng(size, size);
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), buf);
  console.log(`Generated icon-${size}.png (${buf.length} bytes)`);
}
