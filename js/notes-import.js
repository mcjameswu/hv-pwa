/**
 * 從筆記匯入待看物件（第 12 輪 S1、S2、S4、S5）：純函式，不碰畫面、不寫資料庫。
 * 白話：筆記系統那邊有一張「看房物件總表」，AI 定時把它轉成這個 App 的匯入檔放到雲端硬碟；
 * 這裡負責把匯入檔裡的待看物件逐列驗證、和手機上已有的物件合併，並把「會發生什麼事」整理成一份計畫，
 * 真正寫入由控制器的 confirmImport 在同一個交易裡完成（單一寫入者）。
 */
import {
  FIELD_TABLES,
  NOTES_ROW_KEYS,
  NOTES_STATUSES,
  notesPropKey,
  normalizeValue,
  isFlagOn
} from "./fields.js";
import { FIELD_LABELS, CONDITION_KEYS } from "./defaults.js";

/** 看不懂檔案時對使用者說的話（S4 規定的原句）。 */
export const UNKNOWN_FILE_MESSAGE = "看不懂這個檔案,請選雲端硬碟『看房同步』資料夾裡的匯入檔";

/** 匯入檔裡會被當成「匯入表」的最上層欄位。 */
const TABLE_KEYS = ["settings", "finance", "profile", "areas", "scoring", "agents", "travel"];

/** 筆記帶來、手機上可能被本人改過的欄位（物件資料表的欄位名稱）；物件代號是身分，不在其中。 */
export const NOTES_CARRIED_KEYS = NOTES_ROW_KEYS.filter((k) => k !== "property_code").map(notesPropKey);

function isRow(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isBlankValue(v) {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

/** 新建物件時沒帶的欄位要有的預設值（和控制器新增物件時的預設一致，測試會比對）。 */
export function blankPropertyFields() {
  return {
    area_code: null,
    ask_total: null,
    ping_total: null,
    rooms: null,
    parking_price_ask: null,
    parking_ping: null,
    parking_included_in_ask: null,
    has_parking: null,
    hold_years: null,
    commute_min: null,
    walk_min: null,
    transit_status: null,
    walk_mode: null,
    timing_score: null,
    school_zone_claimed: null,
    school_zone_verified: null,
    school_zone_verified_date: null,
    school_zone_year: null,
    fake_alerts: 0,
    fake_price_alt: "",
    age: null,
    mgmt_fee_yuan: null,
    product_type: null,
    prev_ask_total: null,
    community_name: "",
    memory_note: "",
    baths: null
  };
}

/** 兩個值在欄位規格下是不是同一個值（1500 和 "1500" 算同一個）。 */
function sameValue(key, a, b) {
  if (a === b) return true;
  if (isBlankValue(a) && isBlankValue(b)) return true;
  if (isBlankValue(a) || isBlankValue(b)) return false;
  const na = normalizeValue("properties", key, a);
  const nb = normalizeValue("properties", key, b);
  if (na.state === "ok" && nb.state === "ok") return JSON.stringify(na.value) === JSON.stringify(nb.value);
  return String(a) === String(b);
}

const FLAG_WORDS = { 有: "是", 無: "否", true: "是", false: "否" };

/**
 * 把匯入檔的一列整理成物件資料表的欄位（只收有填的欄位）。
 * 回傳 { ok, code, value, errors, ignored }：任何一個值不合規格，整列 ok 為 false（整列待核，不會寫入任何一個欄位）。
 */
export function normalizeNotesRow(row) {
  if (!isRow(row)) {
    return { ok: false, code: "", value: {}, errors: [{ field: "property_code", message: "這一列不是有效的資料" }], ignored: [] };
  }
  const errors = [];
  const value = {};
  const ignored = Object.keys(row).filter((k) => !NOTES_ROW_KEYS.includes(k));
  const code = typeof row.property_code === "string" ? row.property_code.trim() : isBlankValue(row.property_code) ? "" : String(row.property_code);
  const idCheck = normalizeValue("properties", "id", code);
  if (idCheck.state !== "ok") {
    errors.push({ field: "property_code", message: `${FIELD_LABELS.property_code}${idCheck.error || "不可空白"}` });
  }
  for (const key of NOTES_ROW_KEYS) {
    if (key === "property_code") continue;
    let raw = row[key];
    if (isBlankValue(raw)) continue;
    if (typeof raw === "string") raw = raw.trim();
    const propKey = notesPropKey(key);
    if ((key === "has_parking" || key === "parking_included_in_ask") && Object.prototype.hasOwnProperty.call(FLAG_WORDS, String(raw))) {
      raw = FLAG_WORDS[String(raw)];
    }
    const r = key === "area_code" ? normalizeValue("areas", "area_code", raw) : normalizeValue("properties", propKey, raw);
    if (r.state === "invalid") {
      errors.push({ field: key, message: `${FIELD_LABELS[key] || key}：${r.error}` });
    } else if (r.state === "ok") {
      value[propKey] = r.value;
    }
  }
  return { ok: errors.length === 0, code, value, errors, ignored };
}

/**
 * 待看物件匯入計畫（S1）。
 * 規則：
 *  1. 用物件代號比對。新的就建立物件（from_notes 為真、狀態預設待看、不開看房紀錄）。
 *  2. 已存在的只更新筆記帶來的欄位。手機上這個欄位在上次匯入後被本人改過、而且筆記這次又給了不同的值，就不覆蓋，
 *     列成「衝突」讓本人選，預設保留手機的（choices 的鍵是「物件代號|欄位」，值是 "notes" 或 "phone"）。
 *     從來沒有匯入過的欄位，手機上已經有值就當成本人填的，同樣不覆蓋。
 *  3. 看房紀錄、清單答案、照片、錄音、分數一概不碰（這裡根本拿不到它們）。
 *  4. 任何一列有值不合規格，整列待核、整列不寫入，其他列照常；同一個代號在檔案裡出現兩次，這幾列都待核。
 * 回傳的 next 是合併後的 properties 陣列（沒有被改的物件維持原物件）。
 */
export function planNotesProperties(current = [], rows = [], { choices = {}, nowIso = null } = {}) {
  const cur = Array.isArray(current) ? current : [];
  const incoming = Array.isArray(rows) ? rows : [];
  const byId = new Map(cur.filter(isRow).map((p) => [String(p.id), p]));
  const normalized = incoming.map((row, index) => ({ index, ...normalizeNotesRow(row) }));
  const counts = new Map();
  for (const n of normalized) if (n.code) counts.set(n.code, (counts.get(n.code) || 0) + 1);

  const created = [];
  const updated = [];
  const unchanged = [];
  const conflicts = [];
  const pending = [];
  const ignoredFields = new Set();
  const replaced = new Map();
  const appended = [];
  const baseOnly = [];

  for (const n of normalized) {
    for (const k of n.ignored || []) ignoredFields.add(k);
    if (!n.ok) {
      pending.push({ index: n.index, code: n.code, errors: n.errors });
      continue;
    }
    if (counts.get(n.code) > 1) {
      pending.push({ index: n.index, code: n.code, errors: [{ field: "property_code", message: `物件代號 ${n.code} 在檔案裡出現不只一次，這幾列都先不寫入` }] });
      continue;
    }
    const existing = byId.get(n.code);
    if (!existing) {
      const base = {};
      for (const k of NOTES_CARRIED_KEYS) if (n.value[k] !== undefined) base[k] = n.value[k];
      const row = {
        ...blankPropertyFields(),
        ...n.value,
        id: n.code,
        notes_status: n.value.notes_status || "待看",
        from_notes: true,
        deal_breaker_hits: [],
        condition: Object.fromEntries(CONDITION_KEYS.map((k) => [k, null])),
        notes_base: { ...base, notes_status: n.value.notes_status || "待看" }
      };
      appended.push(row);
      created.push({ id: n.code, fields: Object.keys(n.value) });
      continue;
    }
    const nextRow = { ...existing };
    const base = isRow(existing.notes_base) ? { ...existing.notes_base } : {};
    const changedKeys = [];
    let baseChanged = false;
    for (const key of NOTES_CARRIED_KEYS) {
      if (n.value[key] === undefined) continue;
      const notesVal = n.value[key];
      const phoneVal = existing[key];
      const baseVal = base[key];
      if (sameValue(key, phoneVal, notesVal)) {
        if (!sameValue(key, baseVal, notesVal) || baseVal === undefined) {
          base[key] = notesVal;
          baseChanged = true;
        }
        continue;
      }
      // 第 14 輪 F-R14-03：手機這一欄是空的，要分兩種：從來沒有匯入過這一欄（沒有共同基準）就是還沒填，直接帶入；
      // 上次匯入過、現在是空的，就是本人清掉的，「改成空白」也算改過，筆記這次的值和上次一樣就保留空白，不一樣才列成衝突。
      const clearedByPhone = isBlankValue(phoneVal) && baseVal !== undefined && !isBlankValue(baseVal);
      if ((isBlankValue(phoneVal) && !clearedByPhone) || (baseVal !== undefined && sameValue(key, phoneVal, baseVal))) {
        nextRow[key] = notesVal;
        base[key] = notesVal;
        changedKeys.push(key);
        baseChanged = true;
        continue;
      }
      // 手機上的值被本人改過（或本來就是本人填的）：筆記的值和上次匯入的一樣就不用問，不一樣才列成衝突
      if (baseVal !== undefined && sameValue(key, notesVal, baseVal)) continue;
      const choice = choices?.[`${n.code}|${key}`] === "notes" ? "notes" : "phone";
      conflicts.push({ id: n.code, field: key, label: FIELD_LABELS[notesImportKey(key)] || FIELD_LABELS[key] || key, phone: phoneVal, notes: notesVal, choice });
      if (choice === "notes") {
        nextRow[key] = notesVal;
        changedKeys.push(key);
      }
      base[key] = notesVal;
      baseChanged = true;
    }
    if (changedKeys.length) {
      nextRow.notes_base = base;
      replaced.set(n.code, nextRow);
      updated.push({ id: n.code, fields: changedKeys });
    } else if (baseChanged) {
      nextRow.notes_base = base;
      replaced.set(n.code, nextRow);
      baseOnly.push(n.code);
      unchanged.push(n.code);
    } else {
      unchanged.push(n.code);
    }
  }

  const next = [...cur.map((p) => (isRow(p) && replaced.has(String(p.id)) ? replaced.get(String(p.id)) : p)), ...appended];
  const changed = created.length > 0 || updated.length > 0 || baseOnly.length > 0;
  return {
    next,
    created,
    updated,
    unchanged,
    conflicts,
    pending,
    ignoredFields: [...ignoredFields],
    changed,
    summary: { created: created.length, updated: updated.length, unchanged: unchanged.length, conflicts: conflicts.length, pending: pending.length, rows: incoming.length },
    nowIso
  };
}

/** 物件資料表欄位名稱換回匯入檔的欄位名稱（畫面上列衝突時查白話名稱用）。 */
function notesImportKey(propKey) {
  return NOTES_ROW_KEYS.find((k) => notesPropKey(k) === propKey) || propKey;
}

/** 這份資料有沒有匯入表的任何一張表（設定、財務、輪廓、區域、評分、仲介、通勤）。 */
export function hasThresholdTables(data) {
  if (!isRow(data)) return false;
  return TABLE_KEYS.some((k) => data[k] !== undefined && data[k] !== null);
}

/** 這份資料帶了待看物件（import_v1 的 properties）。 */
export function hasNotesProperties(data) {
  return isRow(data) && Array.isArray(data.properties);
}

/**
 * 看一份已經讀成物件的資料是哪一種檔：加密備份、方法包、匯入表，或看不懂。
 * 備份：有 dataFile 或 mediaPacks；方法包：有 checklist 陣列；匯入表：宣告 import_v1，或有任何匯入表欄位、待看物件。
 */
export function classifyImportData(obj) {
  if (!isRow(obj)) return "unknown";
  if (obj.dataFile || obj.mediaPacks) return "backup";
  if (Array.isArray(obj.checklist)) return "method_pack";
  if (obj.schema_version === "import_v1" || hasThresholdTables(obj) || Array.isArray(obj.properties)) return "import_table";
  return "unknown";
}

/** 看房前清單題目要顯示的區域資料提示（S5 的 prefill_from，例如 area.pop_net_inflow）。只提示，不替使用者作答。 */
export function prefillSource(item) {
  const m = /^area\.([a-z_]+)$/.exec(String(item?.prefill_from || ""));
  if (!m) return null;
  const key = m[1];
  if (key === "area_code" || !FIELD_TABLES.areas[key]) return null;
  return key;
}

export function prefillHint(item, property, areas) {
  const key = prefillSource(item);
  if (!key) return null;
  const label = FIELD_LABELS[key] || key;
  const area = (Array.isArray(areas) ? areas : []).find((a) => a && property && a.area_code === property.area_code);
  if (!area) return { key, value: null, label, text: `這間物件的區域還沒有資料，請先從筆記匯入區域功課（${label}）` };
  const raw = area[key];
  if (isBlankValue(raw)) return { key, value: null, label, text: `區域功課還沒有「${label}」，查到再填` };
  const asOf = key === "research_as_of" || isBlankValue(area.research_as_of) ? "" : `（查詢基準日 ${area.research_as_of}）`;
  return { key, value: String(raw), label, text: `區域資料提示：${label} ${String(raw)}${asOf}` };
}

function countChangedAreas(diff) {
  const ids = new Set();
  for (const d of diff || []) {
    if (d.table === "areas" && (d.kind === "add_row" || d.kind === "change")) ids.add(String(d.rowKey ?? d.rowIndex));
  }
  return ids.size;
}

const OTHER_TABLE_NAMES = { settings: "設定", finance: "財務門檻", profile: "理想輪廓", scoring: "評分設定", agents: "仲介名單", travel: "常用地點通勤表" };

/**
 * 確認匯入前的白話摘要（S4）。例：
 * 「會新增 3 間待看物件、更新 2 間、更新 6 個區域;不會動到你已經看過的紀錄。」
 * plan 是 planNotesProperties 的結果（沒有待看物件就傳 null），diff 是匯入預覽的變更清單。
 */
export function plainImportSummary({ plan = null, diff = [], unknownAreaCodes = [] } = {}) {
  const parts = [];
  if (plan) {
    if (plan.created.length) parts.push(`新增 ${plan.created.length} 間待看物件`);
    if (plan.updated.length) parts.push(`更新 ${plan.updated.length} 間`);
  }
  const areas = countChangedAreas(diff);
  if (areas) parts.push(`更新 ${areas} 個區域`);
  const others = [...new Set((diff || []).map((d) => d.table).filter((t) => OTHER_TABLE_NAMES[t]))].map((t) => OTHER_TABLE_NAMES[t]);
  if (others.length) parts.push(`更新${others.join("、")}`);
  const lines = [];
  if (parts.length) lines.push(`會${parts.join("、")};不會動到你已經看過的紀錄。`);
  else lines.push("這個檔案沒有任何需要寫入的新內容，不會動到你已經看過的紀錄。");
  if (plan && plan.conflicts.length) {
    lines.push(`有 ${plan.conflicts.length} 個欄位你在手機上改過，預設保留手機的值，下面可以逐項改選。`);
  }
  if (plan && plan.pending.length) {
    lines.push(`有 ${plan.pending.length} 列資料有問題，先標成待核（還不確定，之後要查），這幾列不會寫入。`);
  }
  if (unknownAreaCodes.length) {
    lines.push(`有物件的區域代號（${unknownAreaCodes.join("、")}）還沒有區域資料，要匯入區域資料之後才算得出分數。`);
  }
  if (plan && plan.ignoredFields.length) {
    lines.push(`有 ${plan.ignoredFields.length} 個欄位名稱看不懂，已略過：${plan.ignoredFields.join("、")}。`);
  }
  return lines;
}

/** 這次匯入會寫入的物件裡，區域代號在區域表（手機上加這次檔案帶來的）找不到的代號。 */
export function unknownAreaCodesOf(plan, areaRows = []) {
  if (!plan) return [];
  const known = new Set((Array.isArray(areaRows) ? areaRows : []).map((a) => String(a?.area_code ?? "")));
  const touched = new Set([...plan.created.map((c) => c.id), ...plan.updated.map((u) => u.id)]);
  const out = new Set();
  for (const p of plan.next) {
    if (!isRow(p) || !touched.has(String(p.id))) continue;
    const code = String(p.area_code ?? "").trim();
    if (code && !known.has(code)) out.add(code);
  }
  return [...out].sort();
}

/** 手機上物件的狀態排序用：待看、已約排前面。 */
export function isOpenNotesStatus(status) {
  return status === undefined || status === null || status === "" || status === "待看" || status === "已約";
}

export { NOTES_STATUSES, isFlagOn };
