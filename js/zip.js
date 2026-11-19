/**
 * Minimal uncompressed zip writer and JPEG APP1 (EXIF) stripper.
 * 自己寫的最小 zip，不加相依套件。JPEG 寫入前拿掉 APP1，避免帶出拍攝位置。
 * 檔名與清單一律用 UTF-8 編碼，並在每個檔頭設一般用途旗標第 11 位元（0x0800，表示檔名是 UTF-8）。
 */

const UTF8_FLAG = 0x0800;
const encoder = new TextEncoder();

function crc32(bytes) {
  let c = ~0;
  for (let i = 0; i < bytes.length; i += 1) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function u16(n) {
  return Uint8Array.of(n & 255, (n >>> 8) & 255);
}

function u32(n) {
  return Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
}

function concat(parts) {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** 檔名：只留檔名本體，去掉路徑分隔符號與 ..；空白時用預設名。 */
export function safeFileName(name, fallback = "file") {
  const s = String(name ?? "")
    .split(/[\\/]/)
    .pop()
    .replace(/\.\.+/g, ".")
    .replace(/[\u0000-\u001f]/g, "")
    .trim();
  return s || fallback;
}

function encodeName(name) {
  return encoder.encode(safeFileName(name));
}

/** 同名檔案加序號，避免壓縮檔裡兩個檔案同名互相覆蓋。 */
function uniqueNames(files) {
  const used = new Set();
  return files.map((f) => {
    let name = safeFileName(f.name);
    if (used.has(name)) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      let n = 2;
      while (used.has(`${stem}-${n}${ext}`)) n += 1;
      name = `${stem}-${n}${ext}`;
    }
    used.add(name);
    return name;
  });
}

/**
 * @param {{name:string, bytes:Uint8Array}[]} files
 * @returns {Uint8Array}
 */
export function buildUncompressedZip(files = []) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const names = uniqueNames(files);
  files.forEach((f, idx) => {
    const name = encodeName(names[idx]);
    const data = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes || []);
    const crc = crc32(data);
    const local = concat([
      Uint8Array.of(0x50, 0x4b, 0x03, 0x04),
      u16(20),
      u16(UTF8_FLAG),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data
    ]);
    const central = concat([
      Uint8Array.of(0x50, 0x4b, 0x01, 0x02),
      u16(20),
      u16(20),
      u16(UTF8_FLAG),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  });
  const centralDir = concat(centrals);
  const eocd = concat([
    Uint8Array.of(0x50, 0x4b, 0x05, 0x06),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0)
  ]);
  return concat([...locals, centralDir, eocd]);
}

/**
 * 移除 JPEG 的 APP1（EXIF、XMP）區段。回傳 { bytes, stripped, corrupt }。
 * 先算出要保留的區段清單，再一次配置輸出陣列用 set() 複製，不用展開運算子（大照片不會堆疊溢位）。
 * 區段長度小於 2 或超出檔案長度時視為損毀：原樣回傳並標記 corrupt。非 JPEG 原樣通過。
 */
export function stripJpegExif(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return { bytes, stripped: false, corrupt: false };
  }
  const keep = [[0, 2]];
  let stripped = false;
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) {
      return { bytes, stripped: false, corrupt: true };
    }
    let j = i;
    while (j < bytes.length && bytes[j] === 0xff) j += 1; // 連續的 0xFF 是填充，跳過
    if (j >= bytes.length) {
      return { bytes, stripped: false, corrupt: true };
    }
    const marker = bytes[j];
    const segStart = j - 1;
    if (marker === 0xda || marker === 0xd9) {
      keep.push([segStart, bytes.length]); // 掃描資料或結尾：之後的原樣保留
      break;
    }
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      keep.push([segStart, j + 1]); // 沒有長度欄的標記
      i = j + 1;
      continue;
    }
    if (j + 2 >= bytes.length) return { bytes, stripped: false, corrupt: true };
    const len = (bytes[j + 1] << 8) | bytes[j + 2];
    const segEnd = j + 1 + len;
    if (len < 2 || segEnd > bytes.length) return { bytes, stripped: false, corrupt: true };
    if (marker === 0xe1 || marker === 0xed || marker === 0xfe) stripped = true;
    else keep.push([segStart, segEnd]);
    i = segEnd;
  }
  const total = keep.reduce((s, [a, b]) => s + (b - a), 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const [a, b] of keep) {
    out.set(bytes.subarray(a, b), o);
    o += b - a;
  }
  return { bytes: out, stripped, corrupt: false };
}

export function jsonBytes(obj) {
  return encoder.encode(JSON.stringify(obj));
}
