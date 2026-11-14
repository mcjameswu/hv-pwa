/**
 * 不變條件：主鍵唯一、外鍵存在、欄位值都是正規化結果、備份可還原。
 * 每筆違規是結構化項目 { code, kind, table, rowId, field, message }：
 *  - kind "key"：主鍵重複或缺漏、資料列損毀
 *  - kind "link"：關聯斷掉
 *  - kind "value"：欄位值不合規格
 * code 由「表名|列主鍵|欄位|錯誤類型」組成，穩定可比，用來分辨「舊資料本來就有」與「這次新造成」。
 */
import { FIELD_TABLES, normalizeValue, META_FINANCE_KEYS } from "./fields.js";
import { FIELD_LABELS } from "./defaults.js";
import { PERSISTED_KEYS, PROPERTY_REF_TABLES, isArrayPersisted } from "./persisted.js";
import { validateBackupPayload, BACKUP_VERSION } from "./backup.js";

const TABLE_LABELS = {
  properties: "物件",
  viewings: "看房紀錄",
  visits: "門市訪視",
  scores: "評分",
  media: "媒體",
  listings: "屋單",
  agents: "仲介",
  importBatches: "匯入批次",
  areas: "區域",
  slots: "格位",
  travel: "通勤表",
  audioChunks: "錄音分片",
  transcripts: "逐字稿",
  drafts: "草稿",
  vetoReleases: "否決解除紀錄",
  priceLog: "問價紀錄",
  settings: "設定",
  finance: "財務",
  profile: "輪廓",
  scoring: "評分設定"
};

/** 關聯檢查訊息裡各資料表的稱呼（沿用既有說法）。 */
const PROPERTY_LINK_LABELS = { viewings: "看房", scores: "評分", vetoReleases: "否決解除紀錄", media: "媒體", audioChunks: "錄音分片", transcripts: "逐字稿", drafts: "草稿", priceLog: "問價紀錄" };

const LOCAL_FIELD_LABELS = {
  areas: {
    area_code: "區域代號",
    area_label: "區域名稱",
    comps_median_unit: "區域中位單價",
    comps_q1_unit: "區域單價第一四分位",
    comps_q3_unit: "區域單價第三四分位",
    comps_sample_n: "可比成交筆數",
    nego_rate: "議價率",
    commute_min: "本區到強勢辦公區分鐘",
    walk_min: "區域步行分鐘",
    data_as_of: "行情基準日"
  },
  properties: {
    id: "物件代號",
    ask_total: "開價",
    ping_total: "總坪數",
    rooms: "房數",
    commute_min: "到強勢辦公區分鐘",
    walk_min: "步行分鐘",
    age: "屋齡",
    fake_alerts: "假價格警訊數"
  },
  visits: {
    id: "門市訪視代號",
    n_listings: "屋單數",
    start: "開始時間",
    end: "結束時間"
  }
};

function labelOf(table, key) {
  return LOCAL_FIELD_LABELS[table]?.[key] || FIELD_LABELS[key] || key;
}

function entry({ table, rowId = "", field = "", type, kind, message }) {
  const code = `${table}|${rowId}|${field}|${type}`;
  const e = { code, kind, table, rowId: String(rowId), field, message };
  // 舊程式與測試會直接把違規項目當成字串比對，所以讓它轉成字串時就是白話訊息
  Object.defineProperty(e, "toString", { value: () => message, enumerable: false });
  return e;
}

function isRow(r) {
  return r !== null && typeof r === "object" && !Array.isArray(r);
}

function checkTableFields(table, obj, errors, rowId = "") {
  if (obj == null) return;
  const tLabel = TABLE_LABELS[table] || table;
  if (!isRow(obj)) {
    errors.push(entry({ table, rowId, type: "shape", kind: "value", message: `${tLabel}的內容必須是物件` }));
    return;
  }
  const spec = FIELD_TABLES[table];
  if (!spec) return;
  for (const [k, v] of Object.entries(obj)) {
    if (table === "finance" && META_FINANCE_KEYS.has(k)) {
      errors.push(entry({ table, rowId, field: k, type: "meta", kind: "value", message: `${labelOf(table, k)} 應放在財務來源資訊` }));
      continue;
    }
    if (!spec[k]) {
      if (table === "finance" || table === "settings") {
        errors.push(entry({ table, rowId, field: k, type: "unknown", kind: "value", message: `${tLabel}欄位 ${labelOf(table, k)} 未登錄` }));
      }
      continue;
    }
    const r = normalizeValue(table, k, v);
    if (r.state === "invalid") {
      errors.push(entry({ table, rowId, field: k, type: "invalid", kind: "value", message: `${labelOf(table, k)} ${r.error}` }));
    }
  }
  for (const [k, def] of Object.entries(spec)) {
    if (def.nullable === false && (obj[k] === undefined || obj[k] === null || obj[k] === "")) {
      errors.push(entry({ table, rowId, field: k, type: "missing", kind: "value", message: `${labelOf(table, k)} 不可缺` }));
    }
  }
}

/** 把表當成「列的清單」讀：非陣列記一筆 key 錯誤；非物件的元素記「資料列損毀」並略過。 */
function rowsOf(state, table, errors) {
  const rows = state?.[table];
  if (rows == null) return [];
  const label = TABLE_LABELS[table] || table;
  if (!Array.isArray(rows)) {
    errors.push(entry({ table, type: "notlist", kind: "key", message: `${label}必須是清單` }));
    return [];
  }
  const good = [];
  rows.forEach((r, i) => {
    if (!isRow(r)) {
      errors.push(entry({ table, rowId: `#${i + 1}`, type: "corrupt", kind: "key", message: `${label}第 ${i + 1} 筆資料列損毀` }));
    } else good.push(r);
  });
  return good;
}

function hasId(r, key = "id") {
  const v = r?.[key];
  return !(v === undefined || v === null || String(v).trim() === "");
}

export function collectInvariantErrors(state = {}) {
  const errors = [];
  const src = state && typeof state === "object" ? state : {};
  const keyTables = [
    "properties",
    "viewings",
    "visits",
    "scores",
    "media",
    "listings",
    "agents",
    "importBatches",
    "slots",
    "travel",
    "audioChunks",
    "transcripts",
    "drafts",
    "vetoReleases",
    "priceLog"
  ];
  const rows = {};
  for (const t of keyTables) {
    rows[t] = rowsOf(src, t, errors);
    const label = TABLE_LABELS[t] || t;
    const ids = [];
    let missing = false;
    for (const r of rows[t]) {
      if (!hasId(r)) missing = true;
      else ids.push(r.id);
    }
    if (missing) errors.push(entry({ table: t, type: "noid", kind: "key", message: `${label}有資料列缺少主鍵` }));
    if (new Set(ids).size !== ids.length) {
      errors.push(entry({ table: t, type: "dupid", kind: "key", message: `${label}的主鍵不唯一` }));
    }
  }
  // 區域表主鍵是 area_code，不用 id（P10-02）
  rows.areas = rowsOf(src, "areas", errors);
  if (rows.areas.length) {
    const codes = [];
    let missingArea = false;
    for (const a of rows.areas) {
      if (!hasId(a, "area_code")) missingArea = true;
      else codes.push(String(a.area_code).trim());
    }
    if (missingArea) {
      errors.push(entry({ table: "areas", field: "area_code", type: "noid", kind: "key", message: "區域有資料列缺少主鍵" }));
    }
    if (new Set(codes).size !== codes.length) {
      errors.push(entry({ table: "areas", field: "area_code", type: "dupcode", kind: "key", message: "區域代號不唯一" }));
    }
  }
  const propIds = new Set(rows.properties.map((p) => p.id).filter(Boolean));
  const viewingIds = new Set(rows.viewings.map((v) => v.id).filter(Boolean));
  const visitIds = new Set(rows.visits.map((v) => v.id).filter(Boolean));
  const link = (table, rowId, type, message) => errors.push(entry({ table, rowId, type, kind: "link", message }));
  // 帶物件代號的資料表由 PROPERTY_REF_TABLES 驅動（F9-12）：新增資料表只要登記一次，檢查與改代號都會跟上
  for (const t of PROPERTY_REF_TABLES) {
    for (const r of rows[t] || []) {
      if (r.property_id && !propIds.has(r.property_id)) {
        link(t, r.id, "property", `${PROPERTY_LINK_LABELS[t] || TABLE_LABELS[t] || t} ${r.id || ""} 關聯物件不存在`);
      }
    }
  }
  for (const m of rows.media) {
    if (m.viewing_id && !viewingIds.has(m.viewing_id)) link("media", m.id, "viewing", `媒體 ${m.id || ""} 關聯看房不存在`);
    if (m.visit_id && !visitIds.has(m.visit_id)) link("media", m.id, "visit", `媒體 ${m.id || ""} 關聯訪視不存在`);
  }
  for (const c of rows.audioChunks) {
    if (!c.viewing_id || !viewingIds.has(c.viewing_id)) {
      link("audioChunks", c.id, "viewing", `錄音分片 ${c.id || ""} 外鍵關聯看房不存在`);
    }
  }
  for (const t of rows.transcripts) {
    if (t.viewing_id && !viewingIds.has(t.viewing_id)) {
      link("transcripts", t.id, "viewing", `逐字稿 ${t.id || ""} 外鍵關聯看房不存在`);
    }
  }
  for (const table of ["finance", "settings", "profile", "scoring"]) {
    checkTableFields(table, src[table], errors);
  }
  for (const table of ["properties", "areas", "agents", "travel", "visits"]) {
    for (const r of rows[table]) {
      checkTableFields(table, r, errors, r.id ?? r.area_code ?? "");
    }
  }
  return errors;
}

/**
 * backup：是否同時檢查「能不能寫成備份」（封閉性）。每次提交不再跑，只在匯出與還原時跑。
 */
export function assertStateInvariants(state, { backup = true } = {}) {
  const errors = collectInvariantErrors(state);
  const messages = errors.map((e) => e.message);
  if (backup) {
    const payload = { version: BACKUP_VERSION };
    for (const k of PERSISTED_KEYS) {
      if (state?.[k] !== undefined) payload[k] = state[k];
    }
    const v = validateBackupPayload(payload);
    if (!v.ok) messages.push(`封閉性失敗：${v.error}`);
  }
  if (messages.length) {
    const err = new Error(`不變條件失敗：${messages.join("；")}`);
    err.errors = errors;
    throw err;
  }
  return true;
}

export { isArrayPersisted };
