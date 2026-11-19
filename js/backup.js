/**
 * Encrypted backup: data file + per-batch media packs.
 * Web Crypto AES-GCM + PBKDF2. Wrong passphrase cannot decrypt.
 */

import { validateTable, META_FINANCE_KEYS, normalizeValue, parseNumericRaw } from "./fields.js";
import { BACKUP_TABLES } from "./persisted.js";
import { validateMergedThresholds } from "./validate.js";
import { DEFAULT_SCORING } from "./defaults.js";
import { normalizeCoach } from "./coach.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const PBKDF2_ITERATIONS = 600000;
export const BACKUP_VERSION = "backup_v1";

export const DATA_TABLES = BACKUP_TABLES;

export async function deriveKey(passphrase, salt, iterations = PBKDF2_ITERATIONS) {
  const cryptoObj = globalThis.crypto;
  const base = await cryptoObj.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return cryptoObj.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export function passphraseStrength(passphrase) {
  const p = String(passphrase || "");
  if (p.length < 8) {
    return { ok: false, level: "太短", message: "通關詞至少 8 字" };
  }
  let score = 0;
  if (p.length >= 12) score += 1;
  if (/[A-Za-z]/.test(p) && /\d/.test(p)) score += 1;
  if (/[^A-Za-z0-9]/.test(p)) score += 1;
  const level = score >= 3 ? "強" : score >= 1 ? "中" : "弱";
  return { ok: true, level, message: `通關詞強度：${level}` };
}

export async function encryptJson(obj, passphrase, iterations = PBKDF2_ITERATIONS) {
  const cryptoObj = globalThis.crypto;
  const salt = cryptoObj.getRandomValues(new Uint8Array(16));
  const iv = cryptoObj.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const plain = encoder.encode(JSON.stringify(obj));
  const cipher = new Uint8Array(await cryptoObj.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  return {
    salt: b64(salt),
    iv: b64(iv),
    cipher: b64(cipher),
    alg: "AES-GCM-PBKDF2",
    iterations
  };
}

/** 備份檔可以指定的金鑰衍生次數範圍；超出就拒絕，避免有人用超大次數讓手機卡死。 */
export const MIN_ITERATIONS = 100000;
export const MAX_ITERATIONS = 2000000;

export async function decryptJson(pack, passphrase) {
  try {
    if (!pack || typeof pack !== "object") return { ok: false, error: "備份檔損毀或通關詞錯誤" };
    const iterations = pack.iterations === undefined ? PBKDF2_ITERATIONS : parseNumericRaw(pack.iterations).value;
    if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
      return { ok: false, error: "備份檔格式不合法" };
    }
    const cryptoObj = globalThis.crypto;
    const salt = fromB64(pack.salt);
    const iv = fromB64(pack.iv);
    const cipher = fromB64(pack.cipher);
    const key = await deriveKey(passphrase, salt, iterations);
    const plain = await cryptoObj.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
    return { ok: true, data: JSON.parse(decoder.decode(plain)) };
  } catch {
    return { ok: false, error: "備份檔損毀或通關詞錯誤" };
  }
}

export function splitBackup(state) {
  const data = { version: BACKUP_VERSION, tables: {} };
  for (const k of DATA_TABLES) {
    data[k] = state[k];
  }
  const mediaByBatch = {};
  const push = (item, kind) => {
    const batch = item.viewing_id || item.batch_id || "unbatched";
    if (!mediaByBatch[batch]) mediaByBatch[batch] = { media: [], audioChunks: [] };
    mediaByBatch[batch][kind].push(item);
  };
  for (const m of state.media || []) push(m, "media");
  for (const c of state.audioChunks || []) push(c, "audioChunks");
  return { data, mediaByBatch };
}

export function backupCounts(state) {
  const media = state.media || [];
  const chunks = state.audioChunks || [];
  const photos = media.filter((m) => m.type === "photo" || m.kind === "photo").length;
  const tables = {};
  for (const k of DATA_TABLES) {
    const v = state[k];
    tables[k] = Array.isArray(v) ? v.length : v ? 1 : 0;
  }
  tables.media = media.length;
  tables.audioChunks = chunks.length;
  return {
    objects: (state.properties || []).length,
    photos,
    audioChunks: chunks.length,
    tables
  };
}

export function validateBackupEnvelope(file) {
  if (!file || typeof file !== "object") return { ok: false, error: "備份檔無效" };
  if (file.version && file.version !== BACKUP_VERSION) {
    return { ok: false, error: `外層備份版本不符：${file.version}` };
  }
  if (!file.dataFile && !file.mediaPacks) {
    return { ok: false, error: "不是資料檔也不是媒體包" };
  }
  return { ok: true };
}

function formatFieldErrors(errors) {
  return (errors || []).map((e) => {
    const field = e.field || e.path || "";
    return `${field} ${e.message}`.trim();
  });
}

export function looksLikeImportThresholds(data) {
  const ver = data?.version || data?.backup_version;
  if (ver === BACKUP_VERSION) return false;
  const profile = data?.profile && typeof data.profile === "object" && !Array.isArray(data.profile) ? data.profile : {};
  const areas = Array.isArray(data?.areas) ? data.areas : [];
  return Object.keys(profile).length > 0 || areas.length > 0;
}

export function validateBackupPayload(data, opts = {}) {
  if (!data || typeof data !== "object") return { ok: false, error: "備份結構無效" };
  const ver = data.version || data.backup_version;
  if (!ver) return { ok: false, error: "缺少備份版本" };
  if (ver !== BACKUP_VERSION) return { ok: false, error: `版本不符：${ver}` };
  const tables = data.tables && typeof data.tables === "object" ? data.tables : data;
  for (const k of DATA_TABLES) {
    const v = data[k] !== undefined ? data[k] : tables[k];
    if (v === undefined || v === null) continue;
    const primitive = ["selectedSlotText", "currentVisitId", "currentViewingId", "offered"].includes(k);
    const scalar = ["settings", "finance", "finance_meta", "profile", "scoring", "methodPack", "cooling", "selectedSlot", "coach"].includes(k);
    if (primitive) continue;
    if (scalar) {
      if (typeof v !== "object" || Array.isArray(v)) {
        return { ok: false, error: `資料表 ${k} 型態不對` };
      }
    } else if (!Array.isArray(v)) {
      return { ok: false, error: `資料表 ${k} 必須是清單` };
    }
  }
  for (const k of DATA_TABLES) {
    const v = data[k] !== undefined ? data[k] : tables[k];
    if (!Array.isArray(v)) continue;
    const bad = v.findIndex((r) => r === null || typeof r !== "object" || Array.isArray(r));
    if (bad >= 0) return { ok: false, error: `備份內容損毀：資料表 ${k} 的第 ${bad + 1} 筆不是有效的資料列` };
  }
  const finance = data.finance && typeof data.finance === "object" ? data.finance : null;
  if (finance) {
    for (const k of Object.keys(finance)) {
      if (META_FINANCE_KEYS.has(k)) {
        return { ok: false, error: `財務欄 ${k} 應在 finance_meta` };
      }
      const r = normalizeValue("finance", k, finance[k]);
      if (r.state === "invalid") return { ok: false, error: `財務欄 ${k} 值域不合法` };
    }
  }
  const scoring = data.scoring && typeof data.scoring === "object" ? data.scoring : null;
  if (scoring) {
    const scored = validateTable("scoring", scoring, { purpose: "backup" });
    if (!scored.ok) {
      return { ok: false, error: `評分權重 ${scored.errors[0]?.field || ""} 值域不合法` };
    }
  }
  for (const table of ["settings", "finance", "profile"]) {
    const v = data[table];
    if (!v) continue;
    const checked = validateTable(table, v, { purpose: "backup" });
    if (!checked.ok) {
      return {
        ok: false,
        error: formatFieldErrors(checked.errors).join("；"),
        errors: checked.errors,
        field: checked.errors[0]?.field
      };
    }
  }
  if (opts.previous) {
    const cross = validateMergedThresholds(opts.previous, {
      finance: data.finance || {},
      profile: data.profile || {},
      settings: data.settings || {},
      scoring: data.scoring || {},
      areas: Array.isArray(data.areas) ? data.areas : [],
      agents: data.agents,
      travel: data.travel
    });
    if (cross.errors.length) {
      return {
        ok: false,
        error: cross.errors.map((e) => `${e.field || ""} ${e.message}`.trim()).join("；"),
        errors: cross.errors,
        field: cross.errors[0]?.field
      };
    }
  }
  const props = Array.isArray(data.properties) ? data.properties : [];
  for (const p of props) {
    const checked = validateTable("properties", p, { purpose: "backup" });
    if (!checked.ok) {
      return { ok: false, error: `欄位值域不合法：${checked.errors[0]?.message || "總價"}` };
    }
  }
  const propIdList = props.map((p) => p.id).filter(Boolean);
  if (new Set(propIdList).size !== propIdList.length) {
    return { ok: false, error: "物件代號重複" };
  }
  const viewingIdList = (data.viewings || []).map((v) => v.id).filter(Boolean);
  if (new Set(viewingIdList).size !== viewingIdList.length) {
    return { ok: false, error: "看房紀錄主鍵重複" };
  }
  for (const table of ["properties", "viewings", "scores", "media", "agents", "visits", "listings", "importBatches", "transcripts", "audioChunks", "areas", "slots", "travel", "drafts", "vetoReleases", "priceLog"]) {
    const rows = Array.isArray(data[table]) ? data[table] : [];
    const ids = rows.map((r) => r.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) {
      return { ok: false, error: `${table} 主鍵重複` };
    }
  }
  const propIds = new Set(propIdList);
  for (const v of data.viewings || []) {
    if (v.property_id && !propIds.has(v.property_id)) {
      return { ok: false, error: `看房 ${v.id || ""} 關聯物件不存在` };
    }
  }
  for (const s of data.scores || []) {
    if (s.property_id && !propIds.has(s.property_id)) {
      return { ok: false, error: `評分 ${s.id || ""} 關聯物件不存在` };
    }
  }
  for (const r of Array.isArray(data.vetoReleases) ? data.vetoReleases : []) {
    if (r.property_id && !propIds.has(r.property_id)) {
      return { ok: false, error: `否決解除紀錄 ${r.id || ""} 關聯物件不存在` };
    }
  }
  for (const r of Array.isArray(data.priceLog) ? data.priceLog : []) {
    if (r.property_id && !propIds.has(r.property_id)) {
      return { ok: false, error: `問價紀錄 ${r.id || ""} 關聯物件不存在` };
    }
  }
  // 照片與錄音必須對得到看房或門市訪視（F9-04）：對不到的備份拿去還原會被擋，所以匯出與還原都先檢查
  if (findOrphanMedia(data).length) return { ok: false, error: ORPHAN_MEDIA_MESSAGE };
  return { ok: true };
}

export const ORPHAN_MEDIA_MESSAGE = "備份內容不完整：有照片或錄音對不到看房紀錄";

/**
 * 找出對不到看房或門市訪視的照片與錄音分片。
 * 照片有填看房代號就必須對得到看房，有填門市代號就必須對得到訪視；錄音分片一定要對得到看房。
 * 回傳 [{ kind: "media" | "audioChunks", row }]。
 */
export function findOrphanMedia(data) {
  const viewingIds = new Set((Array.isArray(data?.viewings) ? data.viewings : []).map((v) => v?.id).filter(Boolean));
  const visitIds = new Set((Array.isArray(data?.visits) ? data.visits : []).map((v) => v?.id).filter(Boolean));
  const out = [];
  for (const m of Array.isArray(data?.media) ? data.media : []) {
    if (!m || typeof m !== "object") continue;
    if ((m.viewing_id && !viewingIds.has(m.viewing_id)) || (m.visit_id && !visitIds.has(m.visit_id))) out.push({ kind: "media", row: m });
  }
  for (const c of Array.isArray(data?.audioChunks) ? data.audioChunks : []) {
    if (!c || typeof c !== "object") continue;
    if (!c.viewing_id || !viewingIds.has(c.viewing_id)) out.push({ kind: "audioChunks", row: c });
  }
  return out;
}

export async function toUint8(blob) {
  if (blob == null) return null;
  if (blob instanceof Uint8Array) return blob;
  if (blob instanceof ArrayBuffer) return new Uint8Array(blob);
  if (typeof Blob !== "undefined" && blob instanceof Blob) {
    return new Uint8Array(await blob.arrayBuffer());
  }
  if (typeof blob === "string") return encoder.encode(blob);
  if (blob.bytes instanceof Uint8Array) return blob.bytes;
  if (blob.bytesB64) return fromB64(blob.bytesB64);
  throw new Error("無法讀取媒體位元組");
}

/**
 * 把一筆照片或錄音分片編成可以放進備份檔的樣子：中繼資料加上「一份」文字編碼（bytesB64），
 * 位元組陣列（bytes）與二進位物件（blob）一律刪掉。
 * 白話：以前同一張照片在備份檔裡存了兩份，第二份是把每個位元組寫成「"0":255,"1":216」的巨大物件，
 * 檔案因此膨脹約 13 倍（F9-01）。現在只留一份。
 */
export async function encodeMediaItem(item) {
  const out = { ...item };
  const blob = item.blob;
  delete out.blob;
  delete out.bytes;
  if (item.bytesB64) return out;
  if (blob == null && item.bytes == null) return out;
  const bytes = await toUint8(blob != null ? blob : item.bytes);
  if (!bytes) return out;
  out.bytesB64 = b64(bytes);
  out.size = bytes.length;
  return out;
}

/** 這筆媒體是不是還帶著位元組陣列或二進位物件（備份檔裡不允許，加密前的最後防線用）。 */
export function mediaItemHasRawContent(item) {
  return !!item && typeof item === "object" && (item.bytes !== undefined || item.blob !== undefined);
}

export function restoreMediaItem(item) {
  if (!item) return item;
  const out = { ...item };
  if (out.bytesB64) {
    const bytes = fromB64(out.bytesB64);
    out.bytes = bytes;
    out.blob = typeof Blob !== "undefined" ? new Blob([bytes]) : bytes;
  }
  return out;
}

function newBackupId() {
  const u = new Uint8Array(8);
  globalThis.crypto.getRandomValues(u);
  return `bak-${Date.now()}-${[...u].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function mergeKeepLocalById(local, incoming) {
  if (!incoming) return [...(local || [])];
  const map = new Map();
  const incomingNoId = [];
  for (const item of incoming) {
    if (item && item.id != null && item.id !== "") map.set(String(item.id), item);
    else if (item) incomingNoId.push(item);
  }
  for (const item of local || []) {
    if (item && item.id != null && item.id !== "" && !map.has(String(item.id))) {
      map.set(String(item.id), item);
    }
  }
  return [...map.values(), ...incomingNoId];
}

/** 合併備份：主鍵聯集，主鍵相同時以本機為準。 */
export function mergeBackupKeepLocal(local, incoming) {
  const map = new Map();
  const noId = [];
  for (const item of incoming || []) {
    if (item && item.id != null && item.id !== "") map.set(String(item.id), item);
    else if (item) noId.push(item);
  }
  for (const item of local || []) {
    if (item && item.id != null && item.id !== "") map.set(String(item.id), item);
    else if (item) noId.push(item);
  }
  return [...map.values(), ...noId];
}

/** 估算一個 JSON 物件寫成檔案後的字元數：只加總字串長度與固定開銷，不真的轉成字串（避免多佔一份記憶體）。 */
function approxJsonChars(v) {
  if (typeof v === "string") return v.length + 2;
  if (v === null || typeof v !== "object") return String(v).length;
  if (Array.isArray(v)) return v.reduce((n, x) => n + approxJsonChars(x) + 1, 2);
  return Object.entries(v).reduce((n, [k, x]) => n + k.length + 4 + approxJsonChars(x), 2);
}

/** 鍵排序後轉成字串，兩個內容相同的物件一定得到同一個字串（比內容用）。 */
function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

/** 一般列要比內容的表（媒體與錄音分片只比中繼資料，內容位元組不比）。 */
const DIFF_ROW_TABLES = ["properties", "viewings", "scores", "visits", "listings", "transcripts", "drafts", "media", "audioChunks", "vetoReleases", "priceLog"];
/** 單筆型資料：設定、財務、輪廓、評分設定。 */
const DIFF_SINGLE_TABLES = ["settings", "finance", "profile", "scoring", "coach"];
/** 清單型門檻資料與各自的業務鍵（系統補上的內部代號不比）。 */
const DIFF_LIST_TABLES = { areas: "area_code", agents: "slot_id", travel: "place_alias", slots: "slot_id" };

function stripContentFields(row) {
  const out = { ...row };
  delete out.bytes;
  delete out.blob;
  delete out.bytesB64;
  return out;
}

function normalizeSingle(table, obj) {
  const o = obj && typeof obj === "object" && !Array.isArray(obj) ? { ...obj } : {};
  if (table === "settings") delete o.has_offer; // 匯出時由「已出價」另外補上，不是使用者填的設定
  if (table === "finance") for (const k of META_FINANCE_KEYS) delete o[k];
  if (table === "scoring") return { ...DEFAULT_SCORING, ...o }; // 舊資料缺的欄位補上出貨預設，兩邊用同一個規則
  if (table === "coach") return normalizeCoach(obj); // 第 13 輪：舊備份沒有教練狀態，和空的教練狀態視為相同
  return o;
}

function normalizeList(table, rows) {
  const key = DIFF_LIST_TABLES[table];
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && typeof r === "object" && !Array.isArray(r))
    .map((r) => {
      const o = { ...r };
      delete o.id;
      return o;
    })
    .sort((a, b) => String(a[key] ?? "").localeCompare(String(b[key] ?? "")) || stableJson(a).localeCompare(stableJson(b)));
}

/**
 * 比對「這台手機的資料」與「備份裡的資料」有哪裡不同（還原前先問使用者用，F9-03）。
 * 白話：以前只看「這台有、備份沒有」的代號，同一間物件後來改過內容就被當成沒有差異，直接被舊備份蓋回去。
 * 現在比內容：
 *  - rows：每張表分三類計數 localOnly（只在本機）、incomingOnly（只在備份）、changed（兩邊都有但內容不同）
 *  - singles：內容不同的單筆型資料（設定、財務、輪廓、評分設定）
 *  - lists：內容不同的清單型資料（區域、仲介、通勤表、格位表）
 *  - total：以上所有不同的總數
 * 稽核紀錄、匯入批次、冷靜期、目前選定的看房等工作階段資料不列入比較。
 */
export function backupDiff(local = {}, incoming = {}) {
  const rows = {};
  let total = 0;
  for (const table of DIFF_ROW_TABLES) {
    const mapOf = (list) => {
      const m = new Map();
      for (const r of Array.isArray(list) ? list : []) {
        if (!r || typeof r !== "object" || Array.isArray(r)) continue;
        const body = stableJson(stripContentFields(r));
        m.set(r.id !== undefined && r.id !== null && r.id !== "" ? `id:${r.id}` : `json:${body}`, body);
      }
      return m;
    };
    const a = mapOf(local[table]);
    const b = mapOf(incoming[table]);
    let localOnly = 0;
    let incomingOnly = 0;
    let changed = 0;
    for (const [k, body] of a) {
      if (!b.has(k)) localOnly += 1;
      else if (b.get(k) !== body) changed += 1;
    }
    for (const k of b.keys()) if (!a.has(k)) incomingOnly += 1;
    rows[table] = { localOnly, incomingOnly, changed };
    total += localOnly + incomingOnly + changed;
  }
  const singles = DIFF_SINGLE_TABLES.filter(
    (t) => stableJson(normalizeSingle(t, local[t])) !== stableJson(normalizeSingle(t, incoming[t]))
  );
  const lists = Object.keys(DIFF_LIST_TABLES).filter(
    (t) => stableJson(normalizeList(t, local[t])) !== stableJson(normalizeList(t, incoming[t]))
  );
  total += singles.length + lists.length;
  return { rows, singles, lists, total };
}

/** 全新裝置：沒有任何物件、看房、訪視、媒體，而且設定與財務都是空的。第一次還原不需要問使用者。 */
export function isFreshState(state = {}) {
  const empty = (v) => v === undefined || v === null || (Array.isArray(v) ? v.length === 0 : typeof v === "object" ? Object.keys(v).length === 0 : false);
  const c = normalizeCoach(state.coach);
  const coachEmpty = !Object.keys(c.steps_done).length && !c.stage_notes.length && !c.custom_items.length && !c.hidden_items.length;
  return ["properties", "viewings", "visits", "media", "audioChunks", "settings", "finance", "priceLog"].every((k) => empty(state[k])) && coachEmpty;
}

/**
 * 加密備份。資料檔放一般表；照片與錄音依看房分批（splitBackup 的分組），一批一批編碼、加密、放進結果，
 * 同一時間只有一批的文字編碼在記憶體裡（F9-01：以前是全部媒體同時編碼）。
 * 回傳的 stats 是 { mediaCount, rawBytes, fileBytes }：照片與錄音共幾個、原始大小、備份檔約多大（字元數）。
 */
export async function encryptBackup(state, passphrase) {
  const strength = passphraseStrength(passphrase);
  if (!strength.ok) return { ok: false, error: strength.message };
  const { data, mediaByBatch } = splitBackup(state);
  const backup_id = newBackupId();
  const created_at = new Date().toISOString();
  data.backup_id = backup_id;
  data.created_at = created_at;
  data.mediaBatches = Object.keys(mediaByBatch);
  data.mediaPackManifest = {};
  for (const [batch, items] of Object.entries(mediaByBatch)) {
    data.mediaPackManifest[batch] = {
      backup_id,
      created_at,
      mediaCount: (items.media || []).length,
      audioCount: (items.audioChunks || []).length
    };
  }
  // 對不到看房的照片與錄音（資料本身有孤兒）只留清單，不放進媒體包，還原時不會寫入
  if (Array.isArray(state.orphanMedia) && state.orphanMedia.length) data.orphanMedia = state.orphanMedia;
  const dataFile = await encryptJson(data, passphrase);
  const mediaPacks = {};
  const stats = { mediaCount: 0, rawBytes: 0, fileBytes: approxJsonChars(dataFile) };
  for (const [batch, items] of Object.entries(mediaByBatch)) {
    const media = [];
    for (const m of items.media || []) media.push(await encodeMediaItem(m));
    const audioChunks = [];
    for (const c of items.audioChunks || []) audioChunks.push(await encodeMediaItem(c));
    if ([...media, ...audioChunks].some(mediaItemHasRawContent)) {
      return { ok: false, error: "備份內容格式錯誤" };
    }
    mediaPacks[batch] = await encryptJson({ batch, backup_id, created_at, media, audioChunks }, passphrase);
    stats.mediaCount += media.length + audioChunks.length;
    for (const it of [...media, ...audioChunks]) stats.rawBytes += Number.isFinite(it.size) ? it.size : 0;
    stats.fileBytes += approxJsonChars(mediaPacks[batch]);
  }
  return {
    ok: true,
    version: BACKUP_VERSION,
    backup_id,
    created_at,
    warning: "忘了通關詞就無法解開。備份分成資料檔與依看房批次分包的媒體檔。",
    dataFile,
    mediaPacks,
    mediaBatches: data.mediaBatches,
    iterations: PBKDF2_ITERATIONS,
    stats,
    downloads: [
      {
        filename: "house-backup-data.json",
        json: {
          version: BACKUP_VERSION,
          warning: "資料檔",
          dataFile,
          iterations: PBKDF2_ITERATIONS,
          mediaBatches: data.mediaBatches,
          backup_id,
          created_at
        }
      },
      ...Object.entries(mediaPacks).map(([batch, file]) => ({
        filename: `house-backup-media-${batch}.json`,
        json: {
          version: BACKUP_VERSION,
          mediaPacks: { [batch]: file },
          iterations: PBKDF2_ITERATIONS,
          batch,
          backup_id,
          created_at
        }
      }))
    ]
  };
}

export function classifyBackupFile(obj) {
  if (!obj || typeof obj !== "object") return "unknown";
  if (obj.dataFile) return "data";
  if (obj.mediaPacks) return "media";
  return "unknown";
}

export async function decryptBackup(pack, passphrase) {
  if (!pack?.dataFile) return { ok: false, error: "缺少資料檔" };
  const data = await decryptJson(pack.dataFile, passphrase);
  if (!data.ok) return data;
  const payload = data.data;
  const v = validateBackupPayload(payload);
  if (!v.ok) return v;
  const expected = payload.mediaBatches || Object.keys(pack.mediaPacks || {});
  const provided = Object.keys(pack.mediaPacks || {});
  const missing = expected.filter((b) => !provided.includes(b));
  if (missing.length) {
    return { ok: false, error: `缺媒體包：${missing.join("、")}`, missing };
  }
  const media = [];
  const audioChunks = [...(payload.audioChunks || [])];
  const manifest = payload.mediaPackManifest && typeof payload.mediaPackManifest === "object" ? payload.mediaPackManifest : {};
  for (const [batch, p] of Object.entries(pack.mediaPacks || {})) {
    const r = await decryptJson(p, passphrase);
    if (!r.ok) return { ok: false, error: `媒體包 ${batch} 無法解開` };
    if (payload.backup_id) {
      if (r.data.backup_id !== payload.backup_id) {
        return { ok: false, error: "媒體包與資料檔不是同一次備份" };
      }
      if (payload.created_at && r.data.created_at && r.data.created_at !== payload.created_at) {
        return { ok: false, error: "媒體包與資料檔不是同一次備份" };
      }
    }
    const expectedPack = manifest[batch];
    const mediaN = Array.isArray(r.data.media) ? r.data.media.length : 0;
    const audioN = Array.isArray(r.data.audioChunks) ? r.data.audioChunks.length : 0;
    if (expectedPack && expectedPack.mediaCount != null && mediaN !== expectedPack.mediaCount) {
      return { ok: false, error: `媒體包 ${batch} 與資料檔不是同一次備份` };
    }
    if (expectedPack && expectedPack.audioCount != null && audioN !== expectedPack.audioCount) {
      return { ok: false, error: `媒體包 ${batch} 與資料檔不是同一次備份` };
    }
    if (Array.isArray(r.data.media)) media.push(...r.data.media.map(restoreMediaItem));
    if (Array.isArray(r.data.audioChunks)) audioChunks.push(...r.data.audioChunks.map(restoreMediaItem));
    if (!r.data.media && Array.isArray(r.data.items)) {
      for (const it of r.data.items) {
        const restored = restoreMediaItem(it);
        if (restored.type === "audio") audioChunks.push(restored);
        else media.push(restored);
      }
    }
  }
  return { ok: true, data: { ...payload, media, audioChunks } };
}

export async function decryptDownloadedFiles(files, passphrase) {
  const list = Array.isArray(files) ? files : [files];
  let dataFile = null;
  let version = null;
  let dataBackupId = null;
  const mediaPacks = {};
  for (const f of list) {
    const env = validateBackupEnvelope(f);
    if (!env.ok) return env;
    version = f.version || version;
    if (f.dataFile) {
      dataFile = f.dataFile;
      dataBackupId = f.backup_id || dataBackupId;
    }
    if (f.mediaPacks) Object.assign(mediaPacks, f.mediaPacks);
  }
  if (!dataFile) return { ok: false, error: "缺少資料檔" };
  if (dataBackupId) {
    for (const f of list) {
      if (!f.mediaPacks) continue;
      if (f.backup_id !== dataBackupId) {
        return { ok: false, error: "媒體包與資料檔不是同一次備份" };
      }
    }
  }
  return decryptBackup({ dataFile, mediaPacks, version }, passphrase);
}

export function roundTripCounts(before, after) {
  const a = backupCounts(before);
  const b = backupCounts(after);
  const mismatches = [];
  for (const k of Object.keys(a.tables)) {
    if ((a.tables[k] || 0) !== (b.tables[k] || 0)) mismatches.push(k);
  }
  if (a.objects !== b.objects) mismatches.push("properties");
  if (a.photos !== b.photos) mismatches.push("media");
  if (a.audioChunks !== b.audioChunks) mismatches.push("audioChunks");
  return { ok: mismatches.length === 0, mismatches, before: a, after: b };
}

export async function sha256hex(bytes) {
  const cryptoObj = globalThis.crypto;
  const buf = typeof bytes === "string" ? encoder.encode(bytes) : bytes;
  const dig = await cryptoObj.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64(u8) {
  if (typeof Buffer !== "undefined") return Buffer.from(u8).toString("base64");
  // 瀏覽器：每 32768 位元組一段轉成字元，避免逐字元串接出超長字串、反覆複製而卡住手機
  const parts = [];
  for (let i = 0; i < u8.length; i += 32768) {
    parts.push(String.fromCharCode.apply(null, u8.subarray(i, i + 32768)));
  }
  return btoa(parts.join(""));
}

function fromB64(s) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
