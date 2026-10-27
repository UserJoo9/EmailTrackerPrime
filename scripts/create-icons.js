const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 table
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ (-1)) >>> 0;
}

function createChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);

  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body), 0);

  return Buffer.concat([len, body, crcBuf]);
}

function generateIcon(size) {
  const width = size;
  const height = size;

  // Raw image RGBA buffer
  // Format: filter byte (0) followed by width * 4 bytes per row
  const rowBytes = 1 + width * 4;
  const rawData = Buffer.alloc(height * rowBytes);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowBytes;
    rawData[rowOffset] = 0; // Filter: None

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;

      // Draw rounded blue badge with double checkmark
      const cx = width / 2;
      const cy = height / 2;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Background gradient circle
      if (dist <= size * 0.45) {
        // Gradient from bright blue to cyan
        const factor = (x + y) / (width * 2);
        rawData[pxOffset] = Math.round(37 + factor * 20);      // R
        rawData[pxOffset + 1] = Math.round(99 + factor * 50);  // G
        rawData[pxOffset + 2] = Math.round(235);               // B
        rawData[pxOffset + 3] = 255;                          // A

        // Draw double check mark shape inside
        const nx = x / size;
        const ny = y / size;

        // First checkmark (left)
        const isCheck1 = 
          (nx >= 0.25 && nx <= 0.45 && Math.abs(ny - (0.35 + (nx - 0.25) * 1.0)) < 0.08) ||
          (nx >= 0.45 && nx <= 0.70 && Math.abs(ny - (0.55 - (nx - 0.45) * 1.2)) < 0.08);

        // Second checkmark (right/offset)
        const isCheck2 = 
          (nx >= 0.40 && nx <= 0.55 && Math.abs(ny - (0.35 + (nx - 0.40) * 1.0)) < 0.08) ||
          (nx >= 0.55 && nx <= 0.80 && Math.abs(ny - (0.50 - (nx - 0.55) * 1.2)) < 0.08);

        if (isCheck1 || isCheck2) {
          rawData[pxOffset] = 255;
          rawData[pxOffset + 1] = 255;
          rawData[pxOffset + 2] = 255;
          rawData[pxOffset + 3] = 255;
        }
      } else {
        // Transparent
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
      }
    }
  }

  const compressed = zlib.deflateSync(rawData);

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bits per channel
  ihdrData[9] = 6; // Color type 6 (RGBA)
  ihdrData[10] = 0; // Compression (deflate)
  ihdrData[11] = 0; // Filter method
  ihdrData[12] = 0; // Interlace (none)

  const ihdrChunk = createChunk('IHDR', ihdrData);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const iconsDir = path.join(__dirname, '../extension/icons');
[16, 48, 128].forEach(size => {
  const iconBuffer = generateIcon(size);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), iconBuffer);
  console.log(`Generated icon${size}.png (${iconBuffer.length} bytes)`);
});
