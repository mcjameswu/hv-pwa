/**
 * 匯出到筆記（第 12 輪 S3）：把看房結果整理成 notes_sync_v1 檔案的內容。純函式，不寫資料、不外送。
 * 白話：筆記系統那邊有「看房物件總表」，這裡把手機上每間物件的結果（狀態、分數、屋況、功課完成度、複盤文字）
 * 用「白名單」一個一個欄位挑出來放進去，沒被挑到的欄位（可承受上限、財務數字、錄音與逐字稿全文、照片本身、
 * 共同決策人同意紀錄）根本不會進到這份資料。挑好之後還要再過 egress.js 的出口閘門做私密金額與個資掃描，才准交出去。
 */
import { assessPropertyFromState, orderedViewings, mergedEvidenceFor, isStretchProperty, round1 } from "./scoring.js";
import { countViewing, uniqueCounted, responseValue } from "./counting.js";
import { itemsForViewing } from "./items-for-viewing.js";
import { APP_VERSION, CONDITION_KEYS } from "./defaults.js";
import { NOTES_STATUSES, isFlagOn, toFiniteNumber } from "./fields.js";
import { stagesInfo, normalizeCoach, stageProgress } from "./coach.js";
import { priceLogFor } from "./price-log.js";

/**
 * 第 13 輪起版本欄是 notes_sync_v1.1（向下相容：第 12 輪的欄位一個都沒變，只新增 coach、stage_notes、每間物件的 price_log 與 rooms、baths）。
 */
export const NOTES_SYNC_SCHEMA = "notes_sync_v1.1";

/** 只做記錄、不是私密內容的系統欄位：出口閘門掃描私密金額與個資時要略過（長得像數字的代號不該害匯出被擋）。 */
export const NOTES_SCAN_SKIP_KEYS = ["schema", "app_version", "exported_at", "notes_ref", "viewing_date", "research_as_of", "at", "date", "step_id", "stage_id", "id", "property_code"];
/** 開價與管理費只在每間物件的 basic 裡略過（F-R16B-06）；其他位置同名的鍵照常掃描。property_code 是代號不是私密數字（F-R16B-18）。 */
export const NOTES_SCAN_BASIC_SKIP_KEYS = ["ask_total", "mgmt_fee"];
// 第 16 輪 F-R16-06：ask_total（開價）與 mgmt_fee（管理費）是刊登出來的公開數字，不是私密數字，
// 不放進私密數字掃描（否則剛好和某個財務數字同值就把整份匯出擋掉）；B01 與財務值寫在文字欄位（備註、記憶備註、問價備註）裡仍然照擋。

/** 給筆記的檔名：看房同步_YYYYMMDD_HHMM.json（用手機的本地時間）。 */
export function notesFileName(nowMs) {
  const d = new Date(nowMs);
  const pad = (n) => String(n).padStart(2, "0");
  return `看房同步_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

function localDate(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 一間物件現在的狀態（待看、已約、已看、淘汰、觀察），給匯出與物件清單共用。
 * 順序：評分判定淘汰就是淘汰；判定觀察就是觀察；有存檔過的看房就是已看；否則沿用筆記裡的狀態；都沒有就是待看。
 */
export function propertyStatus(state, property, live = null) {
  const sc = live || assessPropertyFromState(state, property.id);
  if (sc?.ok && (sc.action === "淘汰" || sc.decision === "淘汰")) return "淘汰";
  if (sc?.ok && (sc.watch_only === true || sc.action === "觀察" || sc.decision === "觀察")) return "觀察";
  if (orderedViewings(state, property.id).some((v) => isFlagOn(v.post_saved))) return "已看";
  if (NOTES_STATUSES.includes(property.notes_status)) return property.notes_status;
  return "待看";
}

/** 一票否決命中的字樣：和上限比出來的結果不外流（會讓筆記那邊推得出上限的位置），改寫成中性的說法。 */
export function exportVetoLabel(hit) {
  const t = String(hit ?? "");
  if (/超過上限/.test(t)) return "價格條件不符";
  return t;
}

function reviewTextOf(state, viewing) {
  if (!viewing) return "";
  const parts = [];
  for (const item of itemsForViewing(state, viewing)) {
    if (item.phase !== "看房後" || item.input_type !== "text" || (Array.isArray(item.options) && item.options.length)) continue;
    const rec = viewing.responses?.[item.id];
    const v = rec?.value;
    if (typeof v === "string" && v.trim() && v.trim() !== "待核") parts.push(v.trim());
  }
  return parts.join("；");
}

function prepOf(state, viewing) {
  if (!viewing) return { prep_done: 0, prep_total: 0, prep_missing: 0, prep_pending: [] };
  const items = itemsForViewing(state, viewing).filter((i) => i.phase === "看房前" && i.core === true);
  let done = 0;
  let missing = 0;
  const pending = [];
  for (const item of items) {
    const rv = responseValue(viewing.responses?.[item.id]);
    if (!rv.filled) missing += 1;
    else if (rv.pending) pending.push({ id: item.id, text: item.text });
    else done += 1;
  }
  return { prep_done: done, prep_total: items.length, prep_missing: missing, prep_pending: pending };
}

/** 手機新建物件要帶給筆記的基本欄位（欄位名稱同匯入檔，筆記那邊的一列）。 */
function basicFieldsOf(p) {
  const pick = (v) => (v === undefined || v === null ? "" : v);
  return {
    community_name: pick(p.community_name),
    area_code: pick(p.area_code),
    ask_total: pick(p.ask_total),
    ping_total: pick(p.ping_total),
    rooms: pick(p.rooms),
    baths: pick(p.baths),
    age: pick(p.age),
    floor_note: pick(p.floor_note),
    product_type: pick(p.product_type),
    mgmt_fee: pick(p.mgmt_fee_yuan),
    agent_company: pick(p.agent_company),
    branch_label: pick(p.branch_label),
    agent_alias: pick(p.agent_alias),
    source_note: pick(p.source_note)
  };
}

function propertyRow(state, property, counted) {
  const live = assessPropertyFromState(state, property.id);
  const views = orderedViewings(state, property.id);
  const primary = views.find((v) => v.kind !== "複看") || views.at(-1) || null;
  const countedView = views.find((v) => counted.ids.has(v.id)) || null;
  let counts = false;
  let reason = "還沒有看房紀錄";
  if (countedView) {
    counts = true;
    reason = "已符合計入一間的條件";
  } else if (primary) {
    reason = countViewing(primary, property, state.methodPack).reason || "還沒有符合計入一間的條件";
  }
  const scoreOk = live?.ok === true && live.any_pending !== true && live.stale !== true && typeof live.total === "number" && Number.isFinite(live.total);
  const cond = mergedEvidenceFor(state, property.id).condition || {};
  return {
    property_code: property.id,
    notes_ref: property.notes_ref || "",
    status: propertyStatus(state, property, live),
    viewing_date: primary ? localDate(primary.start || primary.recorded_at) : "",
    counts,
    count_reason: reason,
    score_total: scoreOk ? round1(live.total) : null,
    score_parts: scoreOk ? { screen: round1(live.screen.score), condition: round1(live.condition.score), price: round1(live.price.score) } : null,
    score_note: scoreOk ? "" : live?.stale ? "待重評" : "資料不足",
    veto_hits: (live?.veto_hits || []).map(exportVetoLabel),
    condition: Object.fromEntries(CONDITION_KEYS.map((k) => [k, cond[k] ?? null])),
    ...prepOf(state, primary),
    review_text: reviewTextOf(state, views.at(-1) || null),
    photo_count: views.reduce((n, v) => n + (Array.isArray(v.photos) ? v.photos.length : 0), 0),
    // 第 13 輪新增：房數、衛浴數與這間物件的問價紀錄（最新的在前面；只有日期、類型、金額、誰說的、備註）
    rooms: property.rooms ?? null,
    baths: property.baths ?? null,
    // 第 16 輪：記憶備註寫回本人的筆記系統（個資與私密數字掃描照舊套用）
    memory_note: typeof property.memory_note === "string" ? property.memory_note : "",
    // 第 16 輪 F-R16-06：手機新建的物件（沒有筆記頁代號）多帶基本欄位，讓電腦端在筆記新建一列；有筆記頁代號的物件不帶，避免蓋掉筆記那邊的內容
    ...(property.notes_ref ? {} : { basic: basicFieldsOf(property) }),
    // 第 16 輪 F-R16-55：錄音段落標記（只有站名與錄音第幾秒，不帶音檔）
    rec_marks: views.flatMap((v) => (Array.isArray(v.rec_marks) ? v.rec_marks : []).map((m) => ({ station: String(m.name ?? ""), sec: toFiniteNumber(m.sec) ?? 0 }))),
    price_log: priceLogFor(state.priceLog, property.id).map((r) => ({ date: r.date, kind: r.kind, amount: r.amount ?? null, who: r.who || "", note: r.note || "" }))
  };
}

/**
 * 口袋教練的部分（C6）：目前階段、各階段完成步數、各步驟完成日期，以及「以後每間都問」的自訂題目。
 * 只挑白名單欄位；方法包換掉之後找不到的步驟代號不匯出（資料還留在手機裡）。
 */
function coachSection(state) {
  const info = stagesInfo(state?.methodPack);
  const coach = normalizeCoach(state?.coach);
  const stages = info.enabled ? info.stages : [];
  const known = new Set(stages.flatMap((s) => s.steps.map((st) => st.id)));
  const cur = stages.find((s) => s.id === coach.current_stage) || null;
  return {
    current_stage: cur ? { id: cur.id, order: cur.order, title: cur.title } : null,
    stages: stages.map((s) => {
      const p = stageProgress(s, coach);
      return { id: s.id, order: s.order, title: s.title, steps_done: p.done, steps_total: p.total, required_done: p.allRequiredDone };
    }),
    steps_done: Object.entries(coach.steps_done)
      .filter(([id]) => known.has(id))
      .map(([step_id, date]) => ({ step_id, date }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.step_id.localeCompare(b.step_id)),
    custom_items: coach.custom_items.map((c) => ({ text: c.text, options: [...c.options], step_id: c.step_id || null }))
  };
}

function areaRow(area) {
  const out = { area_code: String(area?.area_code ?? "") };
  let any = false;
  for (const k of ["pop_net_inflow", "avg_income", "cre_report", "research_as_of"]) {
    const v = area?.[k];
    out[k] = v === undefined || v === null ? "" : String(v);
    if (out[k] !== "") any = true;
  }
  return any ? out : null;
}

/**
 * 組出 notes_sync_v1 的內容（還沒有過出口閘門）。
 * 延伸帶物件（開價在對外搜尋上緣與上限之間）不匯出：延伸帶只留在手機，這是出口閘門一貫的規矩。
 * 回傳 { payload, skippedStretch }。
 */
export function buildNotesPayload(state, { nowMs = Date.now() } = {}) {
  const all = Array.isArray(state?.properties) ? state.properties.filter((p) => p && typeof p === "object") : [];
  const exportable = all.filter((p) => !isStretchProperty(p, state.finance));
  const counted = uniqueCounted(state.viewings, state.properties, state.methodPack);
  const payload = {
    schema: NOTES_SYNC_SCHEMA,
    app_version: APP_VERSION,
    exported_at: new Date(nowMs).toISOString(),
    counted_total: counted.count,
    properties: exportable.map((p) => propertyRow(state, p, counted)),
    areas: (state.areas || []).map(areaRow).filter(Boolean),
    coach: coachSection(state),
    stage_notes: []
  };
  // 階段筆記全文（延伸帶物件的筆記只留在手機，和延伸帶物件本身一樣不匯出）
  const stretchCodes = new Set(all.filter((p) => isStretchProperty(p, state.finance)).map((p) => p.id));
  const notes = normalizeCoach(state?.coach).stage_notes.filter((n) => !(n.property_code && stretchCodes.has(n.property_code)));
  payload.stage_notes = notes.map((n) => ({ stage_id: n.stage_id, property_code: n.property_code || "", at: n.at, text: n.text }));
  return { payload, skippedStretch: all.length - exportable.length, skippedNotes: normalizeCoach(state?.coach).stage_notes.length - notes.length };
}

/** 出口閘門掃描用的文字：把系統產生的代號與時間欄位去掉，只留會被人讀到的內容。 */
export function notesScanText(payload) {
  // mode：undefined 一般；"rows" 是 properties 陣列；"row" 是一間物件的那一列；"basic" 是那一列裡的 basic（只有這裡略過開價與管理費）
  const strip = (v, mode) => {
    if (Array.isArray(v)) return v.map((x) => strip(x, mode === "rows" ? "row" : undefined));
    if (v && typeof v === "object") {
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        if (NOTES_SCAN_SKIP_KEYS.includes(k)) continue;
        if (mode === "basic" && NOTES_SCAN_BASIC_SKIP_KEYS.includes(k)) continue;
        out[k] = strip(x, mode === undefined && k === "properties" ? "rows" : mode === "row" && k === "basic" ? "basic" : undefined);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(strip(payload));
}
