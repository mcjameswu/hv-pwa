/**
 * Minimal xlsx reader/writer. xlsx is a zip of XML.
 * Browser: DecompressionStream. Node: node:zlib.
 * Writer uses STORE (uncompressed) which Excel accepts.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  const u = buf instanceof Uint8Array ? buf : new TextEncoder().encode(buf);
  for (let i = 0; i < u.length; i++) c = CRC_TABLE[(c ^ u[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function te(s) {
  return new TextEncoder().encode(s);
}

function td(u) {
  return new TextDecoder("utf-8").decode(u);
}

function u16(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}
function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
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

export function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = te(f.name);
    const data = f.data instanceof Uint8Array ? f.data : te(f.data);
    const crc = crc32(data);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
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
    locals.push(local);
    const central = concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
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
    centrals.push(central);
    offset += local.length;
  }
  const centralDir = concat(centrals);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0)
  ]);
  return concat([...locals, centralDir, end]);
}

export const MAX_UNCOMPRESSED_FILE = 8 * 1024 * 1024;
export const MAX_UNCOMPRESSED_TOTAL = 32 * 1024 * 1024;

async function inflateRaw(bytes, maxOut = MAX_UNCOMPRESSED_FILE) {
  if (typeof DecompressionStream !== "undefined") {
    try {
      const ds = new DecompressionStream("deflate-raw");
      const reader = new Blob([bytes]).stream().pipeThrough(ds).getReader();
      const chunks = [];
      let n = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        n += value.length;
        if (n > maxOut) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          throw new Error("壓縮檔單檔超過上限");
        }
        chunks.push(value);
      }
      return concat(chunks);
    } catch (err) {
      if (String(err.message || err).includes("超過上限")) throw err;
      /* fall through to zlib */
    }
  }
  if (typeof process === "undefined" || !process.versions?.node) {
    throw new Error("此瀏覽器無法解壓縮 Excel，請改用 CSV");
  }
  const { inflateRawSync } = await import("node:zlib");
  try {
    return inflateRawSync(bytes, { maxOutputLength: maxOut });
  } catch (err) {
    // 只有真的是超過上限才報超過上限；其他都是檔案損毀
    if (err?.code === "ERR_BUFFER_TOO_LARGE") throw new Error("壓縮檔單檔超過上限");
    throw new Error(CORRUPT_ZIP);
  }
}

function assertUncompressed(size, totalRef) {
  if (size > MAX_UNCOMPRESSED_FILE) throw new Error("壓縮檔單檔超過上限");
  totalRef.n += size;
  if (totalRef.n > MAX_UNCOMPRESSED_TOTAL) throw new Error("壓縮檔解壓總量超過上限");
}

const CORRUPT_ZIP = "檔案損毀或格式不支援，請另存新檔再試";

export async function unzip(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  try {
    return await unzipViaCentral(u);
  } catch (err) {
    const msg = String(err?.message || err);
    // 我們自己訊息（超過上限、損毀、瀏覽器不支援）原樣交出；其餘一律當成檔案損毀，不讓英文內部訊息漏到畫面
    if (/超過上限|檔案損毀|無法解壓縮/.test(msg)) throw err;
    throw new Error(CORRUPT_ZIP);
  }
}

async function unzipViaCentral(u) {
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const total = { n: 0 };
  let end = -1;
  for (let i = u.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error(CORRUPT_ZIP);
  const count = dv.getUint16(end + 10, true);
  let c = dv.getUint32(end + 16, true);
  const files = {};
  let sizeMismatch = false;
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(c, true) !== 0x02014b50) throw new Error(CORRUPT_ZIP);
    const method = dv.getUint16(c + 10, true);
    const comp = dv.getUint32(c + 20, true);
    const uncomp = dv.getUint32(c + 24, true);
    if (uncomp > MAX_UNCOMPRESSED_FILE) throw new Error("壓縮檔單檔超過上限");
    if (method !== 0 && method !== 8) throw new Error(CORRUPT_ZIP);
    const nlen = dv.getUint16(c + 28, true);
    const elen = dv.getUint16(c + 30, true);
    const clen = dv.getUint16(c + 32, true);
    const localOff = dv.getUint32(c + 42, true);
    const name = td(u.subarray(c + 46, c + 46 + nlen));
    if (localOff + 30 > u.length) throw new Error(CORRUPT_ZIP);
    const lnlen = dv.getUint16(localOff + 26, true);
    const lelen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lnlen + lelen;
    if (dataStart + comp > u.length) throw new Error(CORRUPT_ZIP);
    let data = u.subarray(dataStart, dataStart + comp);
    if (method === 8) data = await inflateRaw(data);
    // 先套用實際大小的上限（偽造標頭的壓縮炸彈要報超過上限），上限內才檢查長度是否與目錄記載相符
    assertUncompressed(data.length, total);
    if (data.length !== uncomp) sizeMismatch = true;
    files[name] = data;
    c += 46 + nlen + elen + clen;
  }
  if (sizeMismatch) throw new Error(CORRUPT_ZIP);
  return files;
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colName(i) {
  let n = i;
  let s = "";
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function decodeXml(s) {
  return String(s || "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number.parseInt(n, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function parseAttrs(s) {
  const out = {};
  const re = /([:\w]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = m[2];
  return out;
}

function innerTextOfT(xml) {
  let text = "";
  const re = /<t\b([^>]*)(?:\/>|>([\s\S]*?)<\/t>)/g;
  let m;
  while ((m = re.exec(xml))) text += decodeXml(m[2] || "");
  return text;
}

export function parseSharedStrings(xml) {
  const out = [];
  const re = /<si\b([^>/]*)(?:\/>|>([\s\S]*?)<\/si>)/g;
  let m;
  while ((m = re.exec(xml))) out.push(innerTextOfT(m[2] || ""));
  return out;
}

function excelSerialToIso(n) {
  const epoch = Date.UTC(1899, 11, 30);
  const d = new Date(epoch + n * 86400000);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function cellValue(body, attrs, shared, styles) {
  const t = attrs.t || "";
  const v = /<v>([\s\S]*?)<\/v>/.exec(body);
  const inline = innerTextOfT(body);
  if (t === "s" && v) return shared[parseNumericRawIndex(v[1])] ?? "";
  if (t === "inlineStr") return inline;
  if (v) {
    const raw = decodeXml(v[1]);
    const styleId = attrs.s;
    if (/^-?\d+(\.\d+)?$/.test(raw)) {
      const serial = Number(raw);
      // 只有樣式確定是日期才轉換，不再用「看起來像日期序號」猜
      if (isDateStyle(styleId, styles)) {
        return excelSerialToIso(serial);
      }
    }
    return raw;
  }
  if (inline) return inline;
  return "";
}

function isDateStyle(styleId, styles) {
  if (styleId == null || !styles) return false;
  const fmt = styles[String(styleId)];
  return typeof fmt === "string" && fmt !== "General" && isDateFormatString(fmt);
}

function parseNumericRawIndex(s) {
  const n = Number.parseInt(String(s).trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

function tokenizeCells(body) {
  const cells = [];
  const re = /<c\b([^>]*?)(\/>|>)/g;
  let m;
  while ((m = re.exec(body))) {
    const attrsRaw = m[1] || "";
    const selfClose = m[2] === "/>";
    let inner = "";
    if (!selfClose) {
      const end = body.indexOf("</c>", m.index);
      if (end >= 0) {
        inner = body.slice(m.index + m[0].length, end);
        re.lastIndex = end + 4;
      }
    }
    cells.push({ attrs: parseAttrs(attrsRaw), body: inner });
  }
  return cells;
}

export function parseSheet(xml, shared, styles) {
  const byIndex = new Map();
  const rowRe = /<row\b([^>]*?)(\/>|>)/g;
  let rm;
  let last = 0;
  while ((rm = rowRe.exec(xml))) {
    const attrs = parseAttrs(rm[1] || "");
    let body = "";
    if (rm[2] === ">") {
      // 非自閉合的列才有內容；自閉合的空白列（<row r="3"/>）不可吞掉下一列
      const end = xml.indexOf("</row>", rm.index + rm[0].length);
      const stop = end >= 0 ? end : xml.length;
      body = xml.slice(rm.index + rm[0].length, stop);
      rowRe.lastIndex = end >= 0 ? end + 6 : xml.length;
    }
    const map = {};
    let nextCol = 0;
    for (const cell of tokenizeCells(body)) {
      const ref = cell.attrs.r || "";
      // 座標以 r 屬性為準；缺 r 的儲存格依出現順序遞補，不丟棄
      const col = /^([A-Z]+)/.exec(ref)?.[1] || colName(nextCol);
      map[col] = cellValue(cell.body, cell.attrs, shared, styles);
      nextCol = colToIndex(col) + 1;
    }
    const given = attrs.r ? Number.parseInt(attrs.r, 10) : NaN;
    const idx = Number.isFinite(given) && given >= 1 ? given : last + 1;
    last = idx;
    byIndex.set(idx, map);
  }
  const maxRow = byIndex.size ? Math.max(...byIndex.keys()) : 0;
  const rows = [];
  for (let i = 1; i <= maxRow; i++) {
    const map = byIndex.get(i) || {};
    const cols = Object.keys(map).sort((a, b) => colToIndex(a) - colToIndex(b));
    const max = cols.length ? colToIndex(cols[cols.length - 1]) : -1;
    const cells = [];
    for (let c = 0; c <= max; c++) cells.push(map[colName(c)] ?? "");
    rows.push(cells);
  }
  return rows;
}

function colToIndex(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 內建的日期格式代號（Excel 規範）。 */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function isDateFormatString(fmt) {
  // 去掉引號、方括號與跳脫字元裡的文字，再看有沒有年或日的記號；只有時間（h、s）或純數字的格式不是日期
  const s = String(fmt)
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[\\_*]./g, "");
  return /[yd]/i.test(s) || /年|月|日/.test(s);
}

/**
 * 讀 xl/styles.xml：回傳「樣式索引 → 格式字串」。日期樣式會是看得出日期的格式字串，
 * 其他樣式是 "General"。樣式索引依 cellXfs 內每個 xf 的出現順序。
 */
export function parseStyles(xml) {
  const out = {};
  if (!xml) return out;
  const custom = {};
  for (const m of xml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const a = parseAttrs(m[1]);
    if (a.numFmtId !== undefined) custom[a.numFmtId] = decodeXml(a.formatCode || "");
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] || "";
  let i = 0;
  for (const m of xfs.matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)) {
    const id = parseAttrs(m[1]).numFmtId;
    const n = id === undefined ? 0 : parseNumericRawIndex(id);
    if (custom[id] !== undefined) out[String(i)] = isDateFormatString(custom[id]) ? custom[id] : "General";
    else out[String(i)] = BUILTIN_DATE_FORMATS.has(n) ? "yyyy-mm-dd" : "General";
    i += 1;
  }
  return out;
}

export async function readXlsx(buf) {
  const files = await unzip(buf);
  const ssXml = files["xl/sharedStrings.xml"] ? td(files["xl/sharedStrings.xml"]) : "";
  const shared = ssXml ? parseSharedStrings(ssXml) : [];
  const wb = td(files["xl/workbook.xml"] || te(""));
  const names = [...wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)];
  const rels = td(files["xl/_rels/workbook.xml.rels"] || te(""));
  const relMap = {};
  for (const m of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    relMap[m[1]] = m[2].replace(/^\/?xl\//, "").replace(/^\.\//, "");
  }
  const styleMap = parseStyles(files["xl/styles.xml"] ? td(files["xl/styles.xml"]) : "");
  const sheets = {};
  for (const m of names) {
    const target = relMap[m[2]] || `worksheets/sheet${Object.keys(sheets).length + 1}.xml`;
    const path = target.startsWith("xl/") ? target : `xl/${target}`;
    const xml = files[path] ? td(files[path]) : "";
    sheets[decodeXml(m[1])] = parseSheet(xml, shared, styleMap);
  }
  return { sheets };
}

function sheetXml(rows) {
  let s = '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
  rows.forEach((row, ri) => {
    s += `<row r="${ri + 1}">`;
    row.forEach((cell, ci) => {
      const ref = `${colName(ci)}${ri + 1}`;
      const text = cell === undefined || cell === null ? "" : String(cell);
      s += `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(text)}</t></is></c>`;
    });
    s += "</row>";
  });
  s += "</sheetData></worksheet>";
  return s;
}

export function writeXlsx(sheetMap) {
  const names = Object.keys(sheetMap);
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    names
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join("") +
    `</Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;
  const wbRels =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    names
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
      )
      .join("") +
    `</Relationships>`;
  const workbook =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>` +
    names
      .map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("") +
    `</sheets></workbook>`;
  const files = [
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rels },
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: wbRels }
  ];
  names.forEach((n, i) => {
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sheetMap[n]) });
  });
  return zipStore(files);
}
