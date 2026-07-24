/**
 * qr.js: self-contained QR code encoder, byte mode, ECC level L or M,
 * versions 1-10 (plenty for a ~120 character share URL). No third party
 * service, no canvas: builds an inline SVG of unit squares.
 *
 * The maths below (GF(256) arithmetic, Reed-Solomon, BCH format/version
 * info, module placement) is the public domain algorithm from ISO/IEC
 * 18004. `encodeMatrix` is exported separately from `qrSvg` so the matrix
 * itself can be unit tested without a DOM.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/* --- GF(256) Reed-Solomon, following the standard bit-serial multiply and
   LFSR-style polynomial division (no log/antilog tables needed). --------- */
function gfMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const result = new Array(degree - 1).fill(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMultiply(coef, factor); });
  }
  return result;
}

/* --- binary (GF(2)) polynomial division for the format/version BCH codes */
function bchEncode(data, generator, eccBits) {
  let value = data << eccBits;
  const genLen = 32 - Math.clz32(generator);
  let valLen = value === 0 ? 0 : 32 - Math.clz32(value);
  while (valLen >= genLen) {
    value ^= generator << (valLen - genLen);
    valLen = value === 0 ? 0 : 32 - Math.clz32(value);
  }
  return (data << eccBits) | value;
}

/* --- version capacity tables, versions 1-10 only (see file header) ------ */
const TOTAL_CODEWORDS = { 1: 26, 2: 44, 3: 70, 4: 100, 5: 134, 6: 172, 7: 196, 8: 242, 9: 292, 10: 346 };
const EC_TABLE = {
  L: {
    1: { ec: 7, g1: 1, g1d: 19 }, 2: { ec: 10, g1: 1, g1d: 34 }, 3: { ec: 15, g1: 1, g1d: 55 },
    4: { ec: 20, g1: 1, g1d: 80 }, 5: { ec: 26, g1: 1, g1d: 108 }, 6: { ec: 18, g1: 2, g1d: 68 },
    7: { ec: 20, g1: 2, g1d: 78 }, 8: { ec: 24, g1: 2, g1d: 97 }, 9: { ec: 30, g1: 2, g1d: 116 },
    10: { ec: 18, g1: 2, g1d: 68, g2: 2, g2d: 69 },
  },
  M: {
    1: { ec: 10, g1: 1, g1d: 16 }, 2: { ec: 16, g1: 1, g1d: 28 }, 3: { ec: 26, g1: 1, g1d: 44 },
    4: { ec: 18, g1: 2, g1d: 32 }, 5: { ec: 24, g1: 2, g1d: 43 }, 6: { ec: 16, g1: 4, g1d: 27 },
    7: { ec: 18, g1: 4, g1d: 31 }, 8: { ec: 22, g1: 2, g1d: 38, g2: 2, g2d: 39 },
    9: { ec: 22, g1: 3, g1d: 36, g2: 2, g2d: 37 }, 10: { ec: 26, g1: 4, g1d: 43, g2: 1, g2d: 44 },
  },
};
const ALIGNMENT_COORDS = {
  2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};
const FORMAT_LEVEL_BITS = { L: 0b01, M: 0b00 };

function chooseVersion(byteLength) {
  for (let version = 1; version <= 10; version++) {
    for (const level of ['M', 'L']) {
      const ecInfo = EC_TABLE[level][version];
      const totalDataCodewords = ecInfo.g1 * ecInfo.g1d + (ecInfo.g2 || 0) * ecInfo.g2d;
      const headerBits = 4 + (version <= 9 ? 8 : 16);
      if (headerBits + byteLength * 8 <= totalDataCodewords * 8) {
        return { version, level, ecInfo, totalDataCodewords };
      }
    }
  }
  throw new Error('qr.js: text too long for the supported version range (1-10)');
}

function buildBitStream(bytes, version, totalDataCodewords) {
  const bits = [];
  const push = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4); // byte mode indicator
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacityBits = totalDataCodewords * 8;
  const term = Math.min(4, capacityBits - bits.length);
  if (term > 0) push(0, term);
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  const pads = [0xec, 0x11];
  let p = 0;
  while (codewords.length < totalDataCodewords) codewords.push(pads[p++ % 2]);
  return codewords;
}

/** Splits into group1/group2 blocks, Reed-Solomon encodes each block, then
    interleaves data codewords and EC codewords as the spec requires. */
function buildCodewords(dataCodewords, ecInfo) {
  const { ec: ecPerBlock, g1: g1Blocks, g1d: g1Data, g2: g2Blocks = 0, g2d: g2Data = 0 } = ecInfo;
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < g1Blocks; i++) { blocks.push(dataCodewords.slice(offset, offset + g1Data)); offset += g1Data; }
  for (let i = 0; i < g2Blocks; i++) { blocks.push(dataCodewords.slice(offset, offset + g2Data)); offset += g2Data; }

  const divisor = rsDivisor(ecPerBlock);
  const ecBlocks = blocks.map((b) => rsRemainder(b, divisor));

  const interleavedData = [];
  const maxDataLen = Math.max(g1Data, g2Data);
  for (let i = 0; i < maxDataLen; i++) for (const block of blocks) if (i < block.length) interleavedData.push(block[i]);

  const interleavedEc = [];
  for (let i = 0; i < ecPerBlock; i++) for (const block of ecBlocks) interleavedEc.push(block[i]);

  return { codewords: [...interleavedData, ...interleavedEc], blocks, ecBlocks };
}

/* --- matrix module placement --------------------------------------------- */
function placeFinder(matrix, reserved, row, col) {
  const size = matrix.length;
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r, cc = col + c;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      reserved[rr][cc] = true;
      const inCore = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const dark = inCore && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      matrix[rr][cc] = dark ? 1 : 0;
    }
  }
}

function placeTiming(matrix, reserved, size) {
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0 ? 1 : 0;
    matrix[6][i] = dark; reserved[6][i] = true;
    matrix[i][6] = dark; reserved[i][6] = true;
  }
}

function placeAlignment(matrix, reserved, row, col) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
      matrix[row + r][col + c] = dark ? 1 : 0;
      reserved[row + r][col + c] = true;
    }
  }
}

/** All alignment pattern centres for a version, minus the three that would
    collide with a finder pattern (always the two ends paired with the
    first coordinate, per the spec's exclusion rule). */
function alignmentCenters(version) {
  const coords = ALIGNMENT_COORDS[version];
  if (!coords) return [];
  const first = coords[0], last = coords[coords.length - 1];
  const centers = [];
  for (const r of coords) {
    for (const c of coords) {
      if ((r === first && c === first) || (r === first && c === last) || (r === last && c === first)) continue;
      centers.push([r, c]);
    }
  }
  return centers;
}

function reserveFormatAndDark(matrix, reserved, size) {
  for (let i = 0; i <= 8; i++) { reserved[8][i] = true; reserved[i][8] = true; }
  for (let i = 0; i < 8; i++) { reserved[8][size - 1 - i] = true; reserved[size - 1 - i][8] = true; }
  matrix[size - 8][8] = 1;
  reserved[size - 8][8] = true;
}

const FORMAT_COORDS_A = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
  [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
function formatCoordsB(size) {
  return [[size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8], [size - 5, 8], [size - 6, 8], [size - 7, 8],
    [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5], [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1]];
}
function writeFormatInfo(matrix, size, formatBits) {
  const coordsB = formatCoordsB(size);
  for (let i = 0; i < 15; i++) {
    const bit = (formatBits >>> (14 - i)) & 1;
    matrix[FORMAT_COORDS_A[i][0]][FORMAT_COORDS_A[i][1]] = bit;
    matrix[coordsB[i][0]][coordsB[i][1]] = bit;
  }
}

function writeVersionInfo(matrix, size, versionBits) {
  for (let i = 0; i < 18; i++) {
    const bit = (versionBits >>> i) & 1;
    const row = Math.floor(i / 3), col = i % 3; // 6 rows x 3 cols per copy
    matrix[row][size - 11 + col] = bit;
    matrix[size - 11 + col][row] = bit;
  }
}

/** Zigzag placement: two columns at a time from the bottom-right corner,
    alternating sweep direction, skipping the vertical timing column and
    any module already claimed by a function pattern. */
function placeData(matrix, reserved, size, bits) {
  let bitIndex = 0;
  let dir = -1;
  let col = size - 1;
  while (col > 0) {
    if (col === 6) col--;
    for (let count = 0; count < size; count++) {
      const row = dir === -1 ? size - 1 - count : count;
      for (const c of [col, col - 1]) {
        if (reserved[row][c]) continue;
        const bit = bits[bitIndex] ?? 0;
        bitIndex++;
        matrix[row][c] = (row + c) % 2 === 0 ? bit ^ 1 : bit; // mask pattern 0
      }
    }
    dir = -dir;
    col -= 2;
  }
}

/** Builds the module matrix for `text` (UTF-8 byte mode). Exported
    separately from `qrSvg` so it can be unit tested without a DOM. */
export function encodeMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const { version, level, ecInfo, totalDataCodewords } = chooseVersion(bytes.length);
  const dataCodewords = buildBitStream(bytes, version, totalDataCodewords);
  const { codewords } = buildCodewords(dataCodewords, ecInfo);

  const bits = [];
  for (const byte of codewords) for (let i = 7; i >= 0; i--) bits.push((byte >>> i) & 1);

  const size = version * 4 + 17;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(0));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  placeFinder(matrix, reserved, 0, 0);
  placeFinder(matrix, reserved, size - 7, 0);
  placeFinder(matrix, reserved, 0, size - 7);
  placeTiming(matrix, reserved, size);
  for (const [r, c] of alignmentCenters(version)) placeAlignment(matrix, reserved, r, c);
  reserveFormatAndDark(matrix, reserved, size);
  if (version >= 7) {
    for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) {
      reserved[r][size - 11 + c] = true;
      reserved[size - 11 + c][r] = true;
    }
  }

  placeData(matrix, reserved, size, bits);

  const formatData = (FORMAT_LEVEL_BITS[level] << 3) | 0; // mask pattern 0
  const formatBits = bchEncode(formatData, 0x537, 10) ^ 0x5412;
  writeFormatInfo(matrix, size, formatBits);
  if (version >= 7) writeVersionInfo(matrix, size, bchEncode(version, 0x1f25, 12));

  return { size, version, level, matrix };
}

/** Returns an inline SVG element: modules filled with currentColor, a
    quiet zone baked into the viewBox (never drawn, just empty margin), no
    external request. `size` is the rendered width/height in CSS pixels;
    print styling overrides that with a physical size (see styles.css). */
export function qrSvg(text, { size = 120, quietZone = 4, className = '' } = {}) {
  const { size: modules, matrix } = encodeMatrix(text);
  const svgSize = modules + quietZone * 2;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${svgSize} ${svgSize}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR code linking to this stack');
  if (className) svg.setAttribute('class', className);

  let d = '';
  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      if (matrix[r][c]) d += `M${c + quietZone},${r + quietZone}h1v1h-1z`;
    }
  }
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

// Internals exposed only for the scratch verification harness (never
// imported by app code): lets the Reed-Solomon step be checked in Node,
// with no DOM, independently of the SVG-building path above.
export const __internals = {
  gfMultiply, rsDivisor, rsRemainder, chooseVersion, buildBitStream, buildCodewords,
  placeFinder, placeTiming, placeAlignment, alignmentCenters, reserveFormatAndDark,
  writeFormatInfo, writeVersionInfo, placeData, bchEncode,
};
