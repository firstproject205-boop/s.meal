import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

function createPng(width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const rad = Math.max(2, Math.round(width * 0.22));

  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const qx = Math.max(rad, Math.min(width - 1 - rad, x));
      const qy = Math.max(rad, Math.min(height - 1 - rad, y));
      const dx = Math.abs(x - qx);
      const dy = Math.abs(y - qy);
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= rad) {
        // Solid coral #d97766
        raw[offset++] = 217; // R (0xd9)
        raw[offset++] = 119; // G (0x77)
        raw[offset++] = 102; // B (0x66)
        raw[offset++] = 255; // A
      } else if (dist <= rad + 1) {
        const alpha = Math.max(0, Math.min(255, Math.round((rad + 1 - dist) * 255)));
        raw[offset++] = 217;
        raw[offset++] = 119;
        raw[offset++] = 102;
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

const targetDirs = [
  path.resolve('src/icons'),
  path.resolve('icons'),
];

for (const dir of targetDirs) {
  fs.mkdirSync(dir, { recursive: true });
}

for (const size of [16, 32, 48, 128]) {
  const buf = createPng(size, size);
  for (const dir of targetDirs) {
    fs.writeFileSync(path.join(dir, `icon${size}.png`), buf);
    fs.writeFileSync(path.join(dir, `icon-${size}.png`), buf);
  }
  console.log(`Generated icon${size}.png (${buf.length} bytes)`);
}
