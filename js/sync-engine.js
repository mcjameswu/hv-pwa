/**
 * 雲端同步的決策與電腦內容驗證(S1 同步,F-S1-03)。全部是純函式:沒有網路、沒有資料庫、沒有畫面。
 * 白話:這裡回答幾個問題。內容有沒有變、要不要上傳?雲端哪幾格有新版要下載?失敗後隔多久再試?
 * 電腦傳來的內容合不合規格(只准待看物件與區域功課)?下載來的內容可以自動套用,還是要先問你?
 */
import { NOTES_ROW_KEYS } from "./fields.js";

export const DESK_SCHEMA = "desk_sync_v1";
export const DESK_TOP_KEYS = ["schema", "generated_at", "properties", "areas"];
/** 區域列只准這 8 個欄位:區域代號加 7 個研究欄位。 */
export const DESK_AREA_KEYS = ["area_code", "comps_median_unit", "comps_sample_n", "data_as_of", "pop_net_inflow", "avg_income", "cre_report", "research_as_of"];
/** 區域行情欄位:這幾欄有變,套用後分數會標待重評,所以要按一次確認。 */
export const DESK_MARKET_KEYS = ["comps_median_unit", "comps_sample_n", "data_as_of"];
export const DESK_MAX_BYTES = 200 * 1024;

const RETRY_MS = [60000, 120000, 300000, 900000, 900000, 900000];

/** 第 attempt 次失敗(從 1 算)後多久再試:1、2、5、15 分鐘;第 7 次起不再自動重試(回 null)。 */
export function nextRetryMs(attempt) {
  const n = attempt;
  if (!Number.isInteger(n) || n < 1 || n > RETRY_MS.length) return null;
  return RETRY_MS[n - 1];
}

// ---------------------------------------------------------------------------
// 內容雜湊(同步決定「有沒有變」用,不含 exported_at)
// ---------------------------------------------------------------------------

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

/** 純 JavaScript 的 SHA-256(十六進位字串),讓「有沒有變」可以同步算出來。 */
export function sha256HexSync(text) {
  const bytes = new TextEncoder().encode(String(text));
  const bitLen = bytes.length * 8;
  const total = (((bytes.length + 9 + 63) >> 6) << 6);
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(total - 4, bitLen >>> 0, false);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return [...h].map((x) => x.toString(16).padStart(8, "0")).join("");
}

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v === undefined ? null : v);
}

/** 內容雜湊:鍵排序、拿掉最上層的 exported_at(每次匯出都不同,不算內容有變)。payload 可以是物件或 JSON 文字。 */
export function payloadHash(payload) {
  let obj = payload;
  if (typeof payload === "string") {
    try {
      obj = JSON.parse(payload);
    } catch {
      return sha256HexSync(payload);
    }
  }
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const { exported_at: _skip, ...rest } = obj;
    obj = rest;
  }
  return sha256HexSync(stable(obj));
}

/** 要不要上傳:內容雜湊和上次上傳的一樣就不用。回傳 { upload, hash }。 */
export function needUpload(payload, lastHash) {
  const hash = payloadHash(payload);
  return { upload: !lastHash || lastHash !== hash, hash };
}

// ---------------------------------------------------------------------------
// 下載計畫
// ---------------------------------------------------------------------------

/**
 * 雲端各格的版本號對照這支裝置看過的最大版本號,決定要抓哪幾格。
 * remoteSlots: [{ slot_id, kind, seq }];seenSeq: { 格子代號: 看過的最大 seq };mySlotId 是自己那一格(不用下載)。
 * 回傳 { fetch: [有新版的格子], rollback: [遠端比看過的小(雲端資料比上次看到的還舊)], same: [版本沒變的格子代號] }。
 */
export function planDownload(remoteSlots, seenSeq = {}, mySlotId = null) {
  const fetch = [];
  const rollback = [];
  const same = [];
  for (const s of Array.isArray(remoteSlots) ? remoteSlots : []) {
    if (!s || typeof s.slot_id !== "string" || !Number.isInteger(s.seq)) continue;
    if (s.slot_id === mySlotId) continue;
    const seen = Number.isInteger(seenSeq?.[s.slot_id]) ? seenSeq[s.slot_id] : 0;
    if (s.seq > seen) fetch.push({ slot_id: s.slot_id, kind: s.kind, seq: s.seq });
    else if (s.seq < seen) rollback.push({ slot_id: s.slot_id, seen, remote: s.seq });
    else same.push(s.slot_id);
  }
  return { fetch, rollback, same };
}

// ---------------------------------------------------------------------------
// 電腦內容驗證
// ---------------------------------------------------------------------------

function isPlain(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

const PRIMITIVE = (v) => v === null || ["string", "number", "boolean"].includes(typeof v);

/**
 * 驗證電腦那一格的內容。只准 schema: "desk_sync_v1"、generated_at、properties、areas 四個最上層欄位;
 * properties 每列的鍵必須在 NOTES_ROW_KEYS 內;areas 每列的鍵只准區域代號加 7 個研究欄位;
 * 設定、財務、輪廓、評分、仲介、通勤這幾張表(或任何不在白名單的欄位)出現,或大小超過 200 KB,整份拒絕。
 * 錯誤訊息不回顯內容,只說哪一類、第幾列。
 */
export function validateDeskPayload(obj) {
  const errors = [];
  const bad = (m) => ({ ok: false, errors: [...errors, m] });
  if (!isPlain(obj)) return bad("電腦內容不是有效的物件");
  let size = 0;
  try {
    size = new TextEncoder().encode(JSON.stringify(obj)).length;
  } catch {
    return bad("電腦內容無法讀取");
  }
  if (size > DESK_MAX_BYTES) return bad("電腦內容太大(超過 200 KB)");
  for (const k of Object.keys(obj)) {
    // 白名單:只准這四個最上層欄位。設定表、財務表、輪廓、評分、仲介、通勤表,以及任何看不懂的欄位,出現一個就整份拒絕
    if (!DESK_TOP_KEYS.includes(k)) return bad("電腦內容含有不該出現的欄位或表(只准待看物件與區域功課),整份不收");
  }
  if (obj.schema !== DESK_SCHEMA) return bad("電腦內容的格式標記不對");
  if (typeof obj.generated_at !== "string" || !obj.generated_at) return bad("電腦內容缺少產生時間");
  const props = obj.properties === undefined ? [] : obj.properties;
  const areas = obj.areas === undefined ? [] : obj.areas;
  if (!Array.isArray(props) || !Array.isArray(areas)) return bad("待看物件與區域必須是清單");
  for (let i = 0; i < props.length; i += 1) {
    const row = props[i];
    if (!isPlain(row)) return bad(`待看物件第 ${i + 1} 列不是有效的資料`);
    for (const [k, v] of Object.entries(row)) {
      if (!NOTES_ROW_KEYS.includes(k)) return bad(`待看物件第 ${i + 1} 列有看不懂的欄位,整份不收`);
      if (!PRIMITIVE(v)) return bad(`待看物件第 ${i + 1} 列的值不是單一數字或文字`);
    }
    if (typeof row.property_code !== "string" || !row.property_code.trim()) return bad(`待看物件第 ${i + 1} 列缺少物件代號`);
  }
  for (let i = 0; i < areas.length; i += 1) {
    const row = areas[i];
    if (!isPlain(row)) return bad(`區域第 ${i + 1} 列不是有效的資料`);
    for (const [k, v] of Object.entries(row)) {
      if (!DESK_AREA_KEYS.includes(k)) return bad(`區域第 ${i + 1} 列有看不懂的欄位,整份不收`);
      if (!PRIMITIVE(v)) return bad(`區域第 ${i + 1} 列的值不是單一數字或文字`);
    }
    if (typeof row.area_code !== "string" || !row.area_code.trim()) return bad(`區域第 ${i + 1} 列缺少區域代號`);
  }
  return { ok: true, errors: [], size, properties: props.length, areas: areas.length };
}

/**
 * 只留白名單內的內容(電腦端工具 push 之前裁剪用):properties 的鍵限 NOTES_ROW_KEYS,areas 的鍵限 DESK_AREA_KEYS,
 * 其他表、其他欄位一律丟掉。回傳新物件,不改輸入。
 */
export function trimToDeskPayload(source, { generatedAt } = {}) {
  const pick = (row, keys) => Object.fromEntries(keys.filter((k) => row && Object.prototype.hasOwnProperty.call(row, k) && PRIMITIVE(row[k])).map((k) => [k, row[k]]));
  const props = Array.isArray(source?.properties) ? source.properties.filter(isPlain).map((r) => pick(r, NOTES_ROW_KEYS)) : [];
  const areas = Array.isArray(source?.areas) ? source.areas.filter(isPlain).map((r) => pick(r, DESK_AREA_KEYS)) : [];
  return { schema: DESK_SCHEMA, generated_at: generatedAt || new Date().toISOString(), properties: props, areas };
}

// ---------------------------------------------------------------------------
// 自動套用的決定(設計文件 5.2)
// ---------------------------------------------------------------------------

/**
 * 看電腦內容的匯入預覽(controller.previewImport 的結果),決定怎麼處理:
 *  - reject:預覽有錯、要手打上限、會觸發冷靜期、或動到區域以外的表,整份拒絕,不寫任何東西;
 *  - confirm:區域行情欄位(可比成交中位單價、樣本數、資料基準日)有變,要使用者按一次確認才寫入;
 *  - apply:只有新增物件、更新沒被手機改過的欄位、更新區域研究文字,自動套用。
 * needsDecision 是有衝突(手機改過、筆記也改了)的欄位數,預設保留手機的;pendingRows 是待核列數,其他列照常。
 */
export function autoApplyDecision(preview) {
  const reasons = [];
  const result = (action) => ({
    action,
    reasons,
    needsDecision: Array.isArray(preview?.notesImport?.conflicts) ? preview.notesImport.conflicts.length : 0,
    pendingRows: Array.isArray(preview?.notesImport?.pending) ? preview.notesImport.pending.length : 0
  });
  if (!preview || typeof preview !== "object") {
    reasons.push("no_preview");
    return result("reject");
  }
  if (preview.ok === false || (Array.isArray(preview.errors) && preview.errors.length)) reasons.push("preview_failed");
  if (preview.b01RequiresManual === true || preview.b01Differs === true) reasons.push("needs_manual_cap");
  if (preview.canStartCooling === true) reasons.push("would_start_cooling");
  const diff = Array.isArray(preview.diff) ? preview.diff : [];
  if (diff.some((d) => d && d.table !== "areas")) reasons.push("non_area_tables_changed");
  if (reasons.length) return result("reject");
  const market = diff.some((d) => d && d.table === "areas" && (d.kind === "add_row" || d.kind === "remove_row" || (d.kind === "change" && DESK_MARKET_KEYS.includes(d.key))));
  if (market) {
    reasons.push("area_market_changed");
    return result("confirm");
  }
  return result("apply");
}

// ---------------------------------------------------------------------------
// 對方手機的結果(只讀清單)
// ---------------------------------------------------------------------------

export const ROLE_TITLES = { owner: "屋主記錄", partner: "共同決策人記錄", desk: "電腦記錄" };

function conditionSummary(cond) {
  if (!isPlain(cond)) return "";
  const count = (v) => Object.values(cond).filter((x) => x === v).length;
  const parts = [];
  if (count("嚴重")) parts.push(`嚴重 ${count("嚴重")} 項`);
  if (count("輕微")) parts.push(`輕微 ${count("輕微")} 項`);
  if (count("無問題")) parts.push(`無問題 ${count("無問題")} 項`);
  if (count("看不出來")) parts.push(`看不出來 ${count("看不出來")} 項`);
  return parts.join("、");
}

/** 把對方手機那一格的內容(給筆記的內容)整理成只讀清單,只取畫面要顯示的欄位。 */
export function peerResultRows(payload) {
  const rows = Array.isArray(payload?.properties) ? payload.properties : [];
  return rows.filter(isPlain).map((p) => ({
    code: String(p.property_code ?? ""),
    status: String(p.status ?? ""),
    total: typeof p.score_total === "number" ? p.score_total : null,
    scoreNote: String(p.score_note ?? ""),
    vetoes: Array.isArray(p.veto_hits) ? p.veto_hits.map((x) => String(x)) : [],
    condition: conditionSummary(p.condition),
    review: String(p.review_text ?? ""),
    priceLog: Array.isArray(p.price_log) ? p.price_log.map((r) => `${r?.date ?? ""} ${r?.kind ?? ""}${r?.amount != null ? ` ${r.amount}` : ""}${r?.who ? `(${r.who})` : ""}${r?.note ? ` ${r.note}` : ""}`.trim()) : []
  }));
}
