import { validateSchema, getImportSchemaCached } from "./schema.js";
import { scanImportForPii } from "./pii.js";
import { parseNumericRaw, parseNumberForKey, parseAmountWan, isFlagOn, stripFinanceMeta, FIELD_TABLES } from "./fields.js";
import {
  DEFAULT_SCORING,
  OPTIONAL_WITH_SUGGESTION,
  REQUIRED_NO_SUGGESTION,
  WEIGHT_SUM_TOLERANCE
} from "./defaults.js";
import { checkB13 } from "./b13.js";
import { applyThresholdChange, parseThresholdNumber } from "./thresholds.js";
import { FIELD_LABELS } from "./defaults.js";
import { isRealIsoDate } from "./schema.js";
import { neededDown } from "./affordability.js";
import { housingSnapshotExempt, nextFinanceMeta } from "./finance-trust.js";
import { splitList } from "./lists.js";
import { mergeDataset, TABLE_IDS, upsertRows } from "./merge.js";

function isBlank(v) {
  return v === undefined || v === null || v === "";
}

/** 匯入交叉檢查用的數字：有給欄位代號就依欄位的單位解析（萬元金額收「1500萬」），沒給就只收純數字。 */
function num(v, key) {
  if (isBlank(v)) return null;
  const parsed = key ? parseNumberForKey(key, v) : parseNumericRaw(v);
  if (parsed.state !== "ok" || !Number.isFinite(parsed.value)) return NaN;
  return parsed.value;
}

export { housingSnapshotExempt };

function parseRange(s) {
  if (isBlank(s)) return null;
  const m = String(s).match(/^\s*(\d+(?:\.\d+)?)\s*[-~～到至]\s*(\d+(?:\.\d+)?)\s*$/);
  if (!m) return { error: "區間格式錯誤，請用下限-上限" };
  return { low: parseNumericRaw(m[1]).value, high: parseNumericRaw(m[2]).value };
}

function parseList(s) {
  return splitList(s);
}

function parseAreaMinutes(s) {
  if (isBlank(s)) return {};
  const out = {};
  for (const part of splitList(s)) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/^([A-Z]{2}\d{2})\s*[:：]\s*(\d+)$/);
    if (!m) return { error: `通勤分鐘格式錯誤：${t}` };
    out[m[1]] = parseNumericRaw(m[2]).value;
  }
  return out;
}

function warnAmount(field, value, warnings) {
  if (value === null || Number.isNaN(value)) return;
  if (value > 100000 || (value < 1 && value > 0 && field !== "search_ratio_max" && field !== "max_payment_ratio" && field !== "ltv_assumed" && field !== "closing_cost_ratio" && field !== "nego_rate" && field !== "about_markup")) {
    if (["budget_cap_total", "search_range_low", "search_range_high", "own_funds_down", "liquid_funds_total", "staged_offer_steps"].includes(field) || field.startsWith("B")) {
      warnings.push({ field, message: "是否多打或少打了零" });
    }
  }
}

function parseStaged(s) {
  if (isBlank(s)) return [];
  return splitList(s).map((part) => {
    const r = parseAmountWan(part);
    return r.state === "ok" ? r.value : NaN;
  });
}

/**
 * Cross-field rules that JSON Schema cannot express.
 * @returns {{ errors: object[], warnings: object[], notes: object[], pending: object[] }}
 */
export function crossFieldCheck(data, opts = {}) {
  const errors = [];
  const warnings = [];
  const notes = [];
  const pending = [];
  const f = data.finance || {};
  const p = data.profile || {};
  const s = data.settings || {};
  const scoring = { ...DEFAULT_SCORING, ...(data.scoring || {}) };
  const areas = Array.isArray(data.areas) ? data.areas : [];
  const areaCodes = new Set();
  for (const a of areas) {
    if (a.area_code) {
      if (areaCodes.has(a.area_code)) {
        errors.push({ field: "area_code", message: `區域代號 ${a.area_code} 重複` });
      }
      areaCodes.add(a.area_code);
    }
  }

  const b01 = num(f.budget_cap_total, "budget_cap_total");
  const b02 = num(f.search_range_low, "search_range_low");
  const b03 = num(f.search_range_high, "search_range_high");
  const b04 = isBlank(f.search_ratio_max) ? null : num(f.search_ratio_max, "search_ratio_max");
  const capBlank = isBlank(f.budget_cap_total);

  if (!isBlank(f.search_range_low) && Number.isNaN(b02)) {
    errors.push({ field: "search_range_low", message: "格式錯誤" });
  }
  if (!isBlank(f.search_range_high) && Number.isNaN(b03)) {
    errors.push({ field: "search_range_high", message: "格式錯誤" });
  }

  if (b02 !== null && !Number.isNaN(b02) && b03 !== null && !Number.isNaN(b03) && b02 >= b03) {
    errors.push({ field: "search_range_low", message: "下緣必須小於上緣" });
  }

  if (!capBlank && b01 !== null && !Number.isNaN(b01) && b03 !== null && !Number.isNaN(b03)) {
    if (b03 >= b01) {
      errors.push({ field: "search_range_high", message: "對外說的上緣必須小於可承受上限" });
    }
    if (b04 === null) {
      pending.push({
        field: "search_ratio_max",
        suggested: 0.9,
        message: "搜尋比例待核，無法判定上緣是否合理"
      });
    } else {
      const limit = b01 * b04;
      if (b03 > limit + 1e-9) {
        warnings.push({
          field: "search_range_high",
          message: "對外說的數字太貼近上限，仲介推案會落在上限附近"
        });
      } else {
        notes.push({ field: "search_range_high", message: "合理" });
      }
    }
  } else if (capBlank) {
    notes.push({ field: "search_range_high", message: "上限待填，無法檢查" });
  }

  const steps = isBlank(f.staged_offer_steps) ? [] : parseStaged(f.staged_offer_steps);
  if (steps.some((n) => !Number.isFinite(n) || n <= 0)) {
    errors.push({ field: "staged_offer_steps", message: "分段出價必須是大於 0 的數字" });
  } else if (steps.length) {
    for (let i = 1; i < steps.length; i++) {
      if (steps[i] <= steps[i - 1]) {
        errors.push({ field: "staged_offer_steps", message: "分段出價必須嚴格遞增" });
        break;
      }
    }
    const mx = Math.max(...steps);
    if (!capBlank && b01 !== null && mx > b01) {
      errors.push({ field: "staged_offer_steps", message: "分段出價最大值不得超過上限" });
    }
    if (capBlank) {
      warnings.push({ field: "staged_offer_steps", message: "上限待填，無法檢查" });
    }
  }

  const pf02 = parseRange(p.price_band);
  if (p.price_band && pf02?.error) errors.push({ field: "price_band", message: pf02.error });
  if (pf02 && !pf02.error) {
    if (pf02.low > pf02.high) errors.push({ field: "price_band", message: "區間下緣必須小於等於上緣" });
    if (!capBlank && b01 !== null && pf02.high > b01) {
      errors.push({ field: "price_band", message: "合理總價帶上緣必須小於等於上限" });
    }
    if (capBlank) warnings.push({ field: "price_band", message: "上限待填，無法檢查" });
  }

  for (const key of ["unit_price_range", "area_range"]) {
    const r = parseRange(p[key]);
    if (p[key] && r?.error) errors.push({ field: key, message: r.error });
    if (r && !r.error && r.low > r.high) {
      errors.push({ field: key, message: "區間下緣必須小於等於上緣" });
    }
  }
  if (p.floor_pref) {
    const r = parseRange(p.floor_pref);
    if (r && !r.error && r.low > r.high) {
      errors.push({ field: "floor_pref", message: "區間下緣必須小於等於上緣" });
    }
  }

  if (!isBlank(p.rooms_min) && !isBlank(p.rooms_preferred)) {
    if (num(p.rooms_preferred) < num(p.rooms_min)) {
      errors.push({ field: "rooms_preferred", message: "偏好房數不可小於最少房數" });
    }
  }

  if (isFlagOn(f.down_has_borrowed)) {
    if (isBlank(f.borrowed_down_monthly)) {
      errors.push({ field: "borrowed_down_monthly", message: "頭期含借款時必須填月付" });
    }
    if (isBlank(f.borrowed_down_amount)) {
      errors.push({ field: "borrowed_down_amount", message: "頭期含借款時必須填金額" });
    }
  }

  const b05 = num(f.own_funds_down, "own_funds_down");
  const b19 = num(f.liquid_funds_total, "liquid_funds_total");
  if (b05 !== null && b19 !== null && !Number.isNaN(b05) && !Number.isNaN(b19) && b05 > b19) {
    errors.push({ field: "own_funds_down", message: "自有頭期不可大於可動用流動資金" });
  }

  for (const a of areas) {
    const d03 = num(a.comps_median_unit);
    const d03a = num(a.comps_q1_unit);
    const d03b = num(a.comps_q3_unit);
    if (d03a !== null && d03 !== null && d03a > d03) {
      errors.push({ field: "comps_q1_unit", message: "第 25 百分位不可高於中位" });
    }
    if (d03 !== null && d03b !== null && d03 > d03b) {
      errors.push({ field: "comps_q3_unit", message: "中位不可高於第 75 百分位" });
    }
  }

  const targets = parseList(p.target_areas);
  if (targets.length < 1 || targets.length > 4) {
    errors.push({ field: "target_areas", message: "目標區域須 1 到 4 個代號" });
  }
  for (const code of targets) {
    if (!areaCodes.has(code)) {
      errors.push({ field: "target_areas", message: `目標區域 ${code} 不存在於區域分頁` });
    }
  }

  if (Array.isArray(data.travel)) {
    for (const row of data.travel) {
      for (const col of ["minutes_to_area", "minutes_back"]) {
        const parsed = parseAreaMinutes(row[col]);
        if (parsed.error) errors.push({ field: col, message: parsed.error.replace(/^通勤分鐘格式錯誤：/, "通勤分鐘格式錯誤：") });
        else {
          for (const code of Object.keys(parsed)) {
            if (!areaCodes.has(code)) {
              errors.push({ field: col, message: `通勤表區域代號 ${code} 不存在於區域分頁` });
            }
          }
        }
      }
    }
  }

  const wsumParts = ["w_screen", "w_condition", "w_price"].map((k) => parseNumericRaw(scoring[k]));
  const wsum = wsumParts.every((p) => p.state === "ok") ? wsumParts[0].value + wsumParts[1].value + wsumParts[2].value : NaN;
  if (!Number.isNaN(wsum) && Math.abs(wsum - 1) > WEIGHT_SUM_TOLERANCE) {
    errors.push({ field: "w_screen", message: "三組權重加總必須等於 1（容許 0.001 誤差）" });
  }
  for (const wk of ["w_screen", "w_condition", "w_price"]) {
    const wv = parseNumericRaw(scoring[wk]);
    if (scoring[wk] !== undefined && scoring[wk] !== null && scoring[wk] !== "" && (wv.state !== "ok" || wv.value < 0)) {
      errors.push({ field: wk, message: "權重不得為負且須為有限數字" });
    }
  }

  if (!isBlank(s.goal_stretch) && num(s.goal_stretch) < num(s.goal_commit)) {
    errors.push({ field: "goal_stretch", message: "加碼目標必須大於等於承諾間數" });
  }
  if (!isBlank(s.checkpoint_week) && num(s.checkpoint_week) > num(s.program_weeks)) {
    errors.push({ field: "checkpoint_week", message: "判定週次不可大於計畫週數" });
  }

  if (opts.aboutPhrase === "上下" && !capBlank && b01 !== null && b03 !== null) {
    const e11 = scoring.about_markup ?? 1.15;
    if (b04 === null) {
      pending.push({ field: "search_ratio_max", message: "搜尋比例待核，無法檢查上下句型" });
    }
    const ratio = b04;
    if (ratio !== null && b03 * e11 > b01 * ratio + 1e-9) {
      warnings.push({
        field: "search_range_high",
        message: "選「上下」句型時，預估仲介推案可能超過建議搜尋比例"
      });
    }
  }

  for (const field of [
    "budget_cap_total",
    "search_range_low",
    "search_range_high",
    "own_funds_down",
    "liquid_funds_total",
    "essential_monthly",
    "stable_monthly_income",
    "borrowed_down_amount",
    "borrowed_down_monthly"
  ]) {
    const v = num(f[field], field);
    if (v !== null && !Number.isNaN(v) && (v > 100000 || (v > 0 && v < 1))) {
      warnings.push({ field, message: "是否多打或少打了零" });
    }
  }
  for (const field of ["max_payment_ratio", "search_ratio_max", "ltv_assumed", "closing_cost_ratio"]) {
    const v = num(f[field], field);
    if (v !== null && !Number.isNaN(v) && v > 1 && v <= 100) {
      warnings.push({ field, message: "是否要填小數比例（例如 35 寫成 0.35）" });
    }
  }

  const ltv = num(f.ltv_assumed, "ltv_assumed");
  const b23 = num(f.borrowed_down_amount, "borrowed_down_amount");
  const totalForDown = !capBlank ? b01 : null;
  if (totalForDown !== null && ltv !== null && !Number.isNaN(totalForDown) && !Number.isNaN(ltv) && b23 !== null) {
    const nd = neededDown(totalForDown, ltv);
    if (nd !== null && b23 > nd) {
      warnings.push({ field: "borrowed_down_amount", message: "頭期借款金額大於所需頭期" });
    }
  }

  for (const [field, val] of [
    ["finance_as_of", f.finance_as_of],
    ...areas.map((a) => ["data_as_of", a.data_as_of]),
    ...areas.map((a) => ["research_as_of", a.research_as_of])
  ]) {
    if (!val) continue;
    if (!isRealIsoDate(val)) {
      errors.push({ field, message: "日期不存在" });
    }
  }
  if (f.finance_as_of && isRealIsoDate(f.finance_as_of)) {
    const d = new Date(f.finance_as_of + "T00:00:00");
    const now = opts.now ? new Date(opts.now) : new Date();
    const days = (now.getTime() - d.getTime()) / 86400000;
    if (days > 35) warnings.push({ field: "finance_as_of", message: "財務數字已超過 35 天，請更新" });
  }

  for (const [key, suggested] of Object.entries(OPTIONAL_WITH_SUGGESTION)) {
    const container = key === "checkpoint_week" ? s : f;
    if (isBlank(container[key])) {
      pending.push({
        field: key,
        suggested,
        message: `將套用建議值 ${suggested}，請勾選確認為本人採用`
      });
    }
  }
  // 必填欄留空：不提供建議值，只列待核並提醒本人填寫（空白本身會被必填檢查擋下）
  for (const key of REQUIRED_NO_SUGGESTION) {
    if (isBlank(f[key])) {
      pending.push({ field: key, required: true, message: "必填欄，匯入檔留空，不提供建議值，請本人填寫" });
    }
  }

  // 待看物件（第 12 輪）：代號不可重複、預計看房日要是真的日期（整份檔案的嚴格檢查；匯入畫面是逐列待核，見 notes-import.js）
  if (Array.isArray(data.properties)) {
    const seenCodes = new Set();
    for (const row of data.properties) {
      if (!row || typeof row !== "object") continue;
      const code = String(row.property_code ?? "").trim();
      if (code) {
        if (seenCodes.has(code)) errors.push({ field: "property_code", message: `物件代號 ${code} 重複` });
        seenCodes.add(code);
      }
      if (row.planned_date && !isRealIsoDate(row.planned_date)) errors.push({ field: "planned_date", message: "日期不存在" });
    }
  }

  if (Array.isArray(data.agents)) {
    const mainAgents = data.agents.filter((a) => a && a.status === "列為主要合作");
    if (mainAgents.length > 3) errors.push({ field: "status", message: "主要合作最多 3 位" });
    if (mainAgents.some((a) => String(a.slot_id || "").trim().toUpperCase().startsWith("G1"))) {
      errors.push({ field: "status", message: "第一組列主要合作須在 App 內確認並寫原因" });
    }
  }
  const uniqueSlots = new Set();
  if (Array.isArray(data.agents)) {
    for (const a of data.agents) {
      if (a.slot_id) {
        if (uniqueSlots.has(a.slot_id)) {
          errors.push({ field: "slot_id", message: "格位不可重複" });
        }
        uniqueSlots.add(a.slot_id);
      }
    }
  }

  return { errors, warnings, notes, pending, capBlank };
}

function errorKey(e) {
  return `${e.field || ""}|${e.message || ""}`;
}

/**
 * Same complete cross-field check, but only new errors vs previous state block.
 * Settings-only edits therefore will not fail on already-missing區域.
 */
export function validateMergedThresholds(prev, next, opts = {}) {
  const cross = crossFieldCheck(next, opts);
  const before = new Set(crossFieldCheck(prev || {}, opts).errors.map(errorKey));
  const newErrors = cross.errors.filter((e) => !before.has(errorKey(e)));
  return { ...cross, errors: newErrors, allErrors: cross.errors };
}

export function applyGatedThresholdChange(current, patch = {}, opts = {}) {
  const gated = applyThresholdChange(current, patch, opts);
  if (!gated.ok) return gated;
  const merged = gated.state;
  let cross = { errors: [], warnings: [], notes: [], pending: [] };
  if (!opts.skipCross) {
    cross = opts.fullCross
      ? crossFieldCheck(merged, opts)
      : validateMergedThresholds(current, merged, opts);
    if (cross.errors.length) {
      return {
        ok: false,
        error: cross.errors.map((e) => e.message).join("；"),
        message: cross.errors[0].message,
        cross,
        preview: gated.audit || []
      };
    }
  }
  const prevScore = current?.scoring || {};
  const nextScore = merged.scoring || {};
  if (
    parseNumericRaw(prevScore.w_screen).value !== parseNumericRaw(nextScore.w_screen).value
    || parseNumericRaw(prevScore.w_condition).value !== parseNumericRaw(nextScore.w_condition).value
    || parseNumericRaw(prevScore.w_price).value !== parseNumericRaw(nextScore.w_price).value
  ) {
    merged.scoring = { ...nextScore, version: `w-${new Date(opts.now || Date.now()).toISOString()}` };
    gated.audit = [
      ...(gated.audit || []),
      { type: "scoring_version", version: merged.scoring.version, at: new Date(opts.now || Date.now()).toISOString() }
    ];
  }
  return { ...gated, state: merged, cross, preview: gated.audit || [] };
}

export function areaConflictHints(areas, { commuteGap = 20, walkGap = 10 } = {}) {
  const hints = [];
  const byPri = new Map();
  for (const a of areas || []) {
    const p = a.priority || 0;
    if (!byPri.has(p)) byPri.set(p, []);
    byPri.get(p).push(a);
  }
  for (const [pri, list] of byPri) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const c1 = num(list[i].commute_min);
        const c2 = num(list[j].commute_min);
        const w1 = num(list[i].walk_min);
        const w2 = num(list[j].walk_min);
        if (c1 !== null && c2 !== null && Math.abs(c1 - c2) >= commuteGap) {
          hints.push({
            type: "area_conflict",
            message: `同一優先順序 ${pri} 的 ${list[i].area_code} 與 ${list[j].area_code} 通勤差 ${Math.abs(c1 - c2)} 分，請排優先順序`
          });
        }
        if (w1 !== null && w2 !== null && Math.abs(w1 - w2) >= walkGap) {
          hints.push({
            type: "area_conflict",
            message: `同一優先順序 ${pri} 的 ${list[i].area_code} 與 ${list[j].area_code} 步行差 ${Math.abs(w1 - w2)} 分，請排優先順序`
          });
        }
      }
    }
  }
  return hints;
}

/** 日期欄位清單：欄位規格表裡 type 是 date 的欄位，對應匯入檔的表名。 */
function excelSerialDateHints(data) {
  const out = [];
  for (const [table, fields] of Object.entries(FIELD_TABLES)) {
    const node = data?.[table];
    const rows = Array.isArray(node) ? node : node && typeof node === "object" ? [node] : [];
    rows.forEach((row, i) => {
      if (!row || typeof row !== "object") return;
      for (const [key, def] of Object.entries(fields)) {
        if (def.type !== "date") continue;
        const v = row[key];
        let n = null;
        if (typeof v === "number") n = v;
        else if (typeof v === "string" && /^\s*\d{5}\s*$/.test(v)) n = parseNumericRaw(v).value;
        if (n !== null && Number.isInteger(n) && n >= 20000 && n <= 80000) {
          out.push({ key, path: Array.isArray(node) ? `$/${table}/${i}/${key}` : `$/${table}/${key}` });
        }
      }
    });
  }
  return out;
}

/**
 * Full import validation. B01 is never auto-written.
 */
export function validateImport(data, schema, opts = {}) {
  const schemaResult = validateSchema(data, schema);
  const pii = scanImportForPii(data);
  const cross = crossFieldCheck(data, opts);
  // R8（F8-26）：日期欄裡出現 20000 到 80000 的純整數，多半是 Excel 日期序號被當成一般數字。
  // 不自動轉，改成明確提示，並取代同一格的泛用「格式不符」。
  const serialHints = excelSerialDateHints(data);
  if (serialHints.length) {
    const hinted = new Set(serialHints.map((h) => h.path));
    const hintedKeys = new Set(serialHints.map((h) => h.key));
    schemaResult.errors = schemaResult.errors.filter((e) => !hinted.has(e.path));
    cross.errors = cross.errors.filter((e) => !(hintedKeys.has(e.field) && /日期不存在/.test(e.message || "")));
    for (const h of serialHints) {
      cross.errors.push({
        field: h.key,
        message: "這格像是 Excel 日期序號，請把儲存格格式改成文字 yyyy-mm-dd 再匯入"
      });
    }
  }
  // 匯入用途：區域名稱必填（狀態用途維持可空，舊資料不鎖死）
  if (Array.isArray(data.areas)) {
    for (const a of data.areas) {
      if (a && (a.area_label === undefined || a.area_label === null || String(a.area_label).trim() === "")) {
        cross.errors.push({ field: "area_label", message: `區域 ${a.area_code || ""} 的區域名稱不可空白` });
      }
    }
  }
  const withLabel = (e) => ({
    ...e,
    fieldLabel: FIELD_LABELS[e.field] || FIELD_LABELS[String(e.field || "").split(".").pop()] || e.field
  });
  const errors = [
    ...schemaResult.errors.map((e) => withLabel({ level: "error", field: e.path, message: e.message })),
    ...pii.map(withLabel),
    ...cross.errors.map((e) => withLabel({ level: "error", ...e }))
  ];
  const warnings = cross.warnings.map((e) => ({ level: "warning", ...e }));
  const notes = cross.notes;
  const pending = cross.pending;

  let b13 = { ok: true, requiresCooling: false, hits: [] };
  if (opts.previous) {
    b13 = checkB13(opts.previous, data, {
      now: opts.now,
      reason: opts.reason,
      coolingUntil: opts.coolingUntil,
      cooling: opts.cooling,
      snapshotExemptFunds: opts.snapshotExemptFunds ?? housingSnapshotExempt(data)
    });
    if (!b13.ok) {
      errors.push({
        level: "error",
        field: "tighten_only",
        fieldLabel: FIELD_LABELS.tighten_only,
        message: b13.message,
        hits: b13.hits,
        coolingRequired: true
      });
    }
  }

  const hasNonCoolingErrors = schemaResult.errors.length > 0 || pii.length > 0 || cross.errors.length > 0;
  const importedKeys = data._importedKeys;
  const financeFromFile = !importedKeys || importedKeys.includes("finance");
  const b01FromFile = financeFromFile && data.finance && !isBlank(data.finance.budget_cap_total);
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    notes,
    pending,
    b13,
    canStartCooling: !!(b13 && b13.requiresCooling) && !hasNonCoolingErrors,
    capBlank: cross.capBlank,
    b01RequiresManual: b01FromFile,
    b01PreviewValue: b01FromFile ? data.finance.budget_cap_total : undefined,
    areaHints: areaConflictHints(data.areas)
  };
}

/**
 * Apply a validated import. B01 is held until typedB01 matches the file value
 * (or user types a new value with no file value). Suggested optionals apply
 * only if listed in confirmedSuggestions.
 */
function pickObject(importedKeys, key, currentVal, incomingVal) {
  if (!importedKeys || importedKeys.includes(key)) {
    return { ...(currentVal || {}), ...(incomingVal || {}) };
  }
  return { ...(currentVal || {}) };
}

function pickArray(importedKeys, key, currentVal, incomingVal) {
  if (!importedKeys) {
    return incomingVal != null ? incomingVal : currentVal || [];
  }
  if (importedKeys.includes(key)) return upsertRows(currentVal, incomingVal, TABLE_IDS[key]);
  if (Array.isArray(currentVal) && currentVal.length) return currentVal;
  return incomingVal || currentVal || [];
}

/** 檔案裡的上限和目前的上限是不是同一個數字（兩邊都要是有效的數字）。 */
function b01SameAsCurrent(current, fileRaw) {
  const file = parseThresholdNumber(fileRaw);
  const cur = parseThresholdNumber(current?.finance?.budget_cap_total);
  return !file.blank && !cur.blank && file.value === cur.value;
}

/**
 * Build the snapshot that preview, validation, and write all share.
 * preview:true keeps current B01 and skips the typed-B01 gate.
 */
export function prepareImportApply(current, incoming, opts = {}) {
  const next = structuredClone
    ? structuredClone(incoming)
    : JSON.parse(JSON.stringify(incoming));
  delete next._importedKeys;
  const changes = [];
  const finance = { ...(current?.finance || {}), ...(next.finance || {}) };
  const importedKeys = incoming._importedKeys;
  const financeFromFile = !importedKeys || importedKeys.includes("finance");

  if (financeFromFile && incoming.finance && !isBlank(incoming.finance.budget_cap_total)) {
    if (opts.preview) {
      if (current?.finance && "budget_cap_total" in (current.finance || {})) {
        finance.budget_cap_total = current.finance.budget_cap_total;
      }
    } else if (b01SameAsCurrent(current, incoming.finance.budget_cap_total)) {
      // 檔案的上限和目前一樣：不會改變任何東西，不用本人再手打一次（F9-15）
      finance.budget_cap_total = current.finance.budget_cap_total;
    } else {
      const typed = parseThresholdNumber(opts.typedB01);
      const fileVal = parseThresholdNumber(incoming.finance.budget_cap_total);
      if (typed.blank || typed.value !== fileVal.value) {
        return {
          ok: false,
          errors: ["請手動輸入一致的 B01 總價硬上限後再套用"],
          message: "請手動輸入一致的 B01 總價硬上限後再套用",
          state: current,
          snapshot: {
            settings: { ...(current?.settings || {}) },
            finance: { ...(current?.finance || {}) },
            profile: { ...(current?.profile || {}) },
            areas: current?.areas || [],
            scoring: current?.scoring || {},
            agents: current?.agents || [],
            travel: current?.travel || []
          },
          changes
        };
      }
      finance.budget_cap_total = typed.value;
      changes.push({
        field: "budget_cap_total",
        fieldLabel: FIELD_LABELS.budget_cap_total,
        from: current?.finance?.budget_cap_total,
        to: typed.value
      });
    }
  }

  const confirmed = new Set(opts.confirmedSuggestions || []);
  // 必填欄留空與選填欄留空處理相同（保留目前的值並列待核），差別是必填欄沒有建議值可以套用
  const blankEntries = [...Object.entries(OPTIONAL_WITH_SUGGESTION), ...REQUIRED_NO_SUGGESTION.map((k) => [k, undefined])];
  for (const [key, suggested] of blankEntries) {
    const containerKey = key === "checkpoint_week" ? "settings" : "finance";
    const src = containerKey === "settings" ? next.settings : next.finance;
    if (src && isBlank(src[key])) {
      if (confirmed.has(key) && suggested !== undefined) {
        if (containerKey === "settings") {
          next.settings = { ...next.settings, [key]: suggested };
        } else finance[key] = suggested;
        changes.push({ field: key, to: suggested, appliedSuggested: true });
      } else {
        pendingUnknown(changes, key);
        if (containerKey === "finance") {
          const cur = current?.finance?.[key];
          if (!isBlank(cur)) finance[key] = cur;
          else delete finance[key];
        }
        if (containerKey === "settings") {
          const cur = current?.settings?.[key];
          if (!isBlank(cur)) next.settings = { ...next.settings, [key]: cur };
          else if (next.settings) delete next.settings[key];
        }
      }
    }
  }

  next.finance = stripFinanceMeta(finance);
  const financeMeta = nextFinanceMeta(current?.finance_meta, {
    financeSheetSupplied: financeFromFile,
    incomingMeta: {
      origin: incoming?.origin || incoming?.source_type,
      source: incoming?.source,
      as_of: incoming?.as_of || incoming?.finance_as_of || next.finance?.finance_as_of,
      verified: incoming?.verified,
      source_type: incoming?.source_type
    },
    nextFinance: next.finance
  });
  next.scoring = { ...DEFAULT_SCORING, ...(current?.scoring || {}), ...(next.scoring || {}) };

  const snapshot = {
    settings: pickObject(importedKeys, "settings", current?.settings, next.settings),
    finance: next.finance,
    finance_meta: financeMeta,
    profile: pickObject(importedKeys, "profile", current?.profile, next.profile),
    areas: pickArray(importedKeys, "areas", current?.areas, next.areas),
    scoring: next.scoring,
    agents: pickArray(importedKeys, "agents", current?.agents, next.agents),
    travel: pickArray(importedKeys, "travel", current?.travel, next.travel)
  };
  return { ok: true, snapshot, changes, incoming };
}

export function thresholdFingerprint(obj = {}) {
  return JSON.stringify({
    settings: obj.settings || {},
    finance: stripFinanceMeta(obj.finance || {}),
    profile: obj.profile || {},
    scoring: obj.scoring || {},
    areas: obj.areas || [],
    agents: obj.agents || [],
    travel: obj.travel || []
  });
}

/**
 * Preview and confirm share this plan. Validates the snapshot that would be written.
 */
export function planImport(current, incoming, opts = {}) {
  const prepared = prepareImportApply(current, incoming, { ...opts, preview: opts.preview !== false });
  if (!prepared.ok) {
    return {
      ok: false,
      snapshot: prepared.snapshot,
      report: prepared,
      baseFingerprint: thresholdFingerprint(current),
      prepared
    };
  }
  const snapshot = prepared.snapshot;
  const schema = opts.schema || getImportSchemaCached();
  // 預覽與套用必須對同一份輸入得到同樣的「是否免冷靜期」結論：核實、基準日、來源都要帶進去
  const exempt = housingSnapshotExempt(incoming);
  const toValidate = {
    schema_version: incoming.schema_version || "import_v1",
    source_type: incoming.source_type,
    origin: incoming.origin,
    verified: incoming.verified,
    as_of: incoming.as_of,
    source: incoming.source,
    finance_as_of: incoming.finance_as_of,
    settings: snapshot.settings,
    finance: snapshot.finance,
    profile: snapshot.profile,
    areas: snapshot.areas,
    scoring: snapshot.scoring,
    agents: snapshot.agents,
    travel: snapshot.travel,
    _importedKeys: incoming._importedKeys
  };
  const report = validateImport(toValidate, schema, {
    previous: current,
    reason: opts.reason,
    cooling: opts.cooling,
    coolingUntil: opts.coolingUntil,
    now: opts.now,
    snapshotExemptFunds: exempt
  });
  // 上限（B01）永遠不會自動寫入，預覽也不帶數值（F9-15）：
  // 檔案帶了上限而且和目前不同（目前是空的也算不同）才要本人手打一次；相同就不用，也不算有變更
  const importedKeys = incoming._importedKeys;
  const financeFromFile = !importedKeys || importedKeys.includes("finance");
  const fileCapRaw = incoming?.finance?.budget_cap_total;
  const b01Differs = financeFromFile && !isBlank(fileCapRaw) && !b01SameAsCurrent(current, fileCapRaw);
  report.b01RequiresManual = b01Differs;
  report.b01Differs = b01Differs;
  if (b01Differs) {
    report.b01Change = { pending: true };
    // 預覽時上限保留現值，所以另外用檔案的上限再算一次冷靜期：調高上限是調鬆
    const fileCap = parseThresholdNumber(fileCapRaw);
    if (!fileCap.blank && opts.preview !== false) {
      const withFileCap = { ...snapshot, finance: { ...snapshot.finance, budget_cap_total: fileCap.value } };
      const extra = checkB13(current, withFileCap, {
        now: opts.now,
        reason: opts.reason,
        coolingUntil: opts.coolingUntil,
        cooling: opts.cooling,
        snapshotExemptFunds: exempt
      });
      if (!extra.ok && extra.requiresCooling) {
        report.canStartCooling = true;
        report.ok = false;
        report.errors.push({
          level: "error",
          field: "budget_cap_total",
          fieldLabel: FIELD_LABELS.budget_cap_total,
          message: "可承受總價上限調高屬於調鬆，須等 7 天冷靜期並寫理由",
          coolingRequired: true
        });
      }
    }
  }
  return {
    ok: report.ok,
    snapshot,
    report,
    prepared,
    baseFingerprint: thresholdFingerprint(current),
    incomingFingerprint: thresholdFingerprint(incoming)
  };
}

export function applyImport(current, incoming, opts = {}) {
  // 一律自己重算計畫，不接受呼叫者傳進來的預覽計畫（否則可以略過「上限必須本人手打」）
  const plan = planImport(current, incoming, { ...opts, preview: false });
  if (!plan.prepared?.ok && plan.prepared && plan.prepared.ok === false) return plan.prepared;
  const prepared = plan.prepared || prepareImportApply(current, incoming, opts);
  if (!prepared.ok) return prepared;
  const { snapshot, changes } = prepared;

  const sameState = thresholdFingerprint(current) === thresholdFingerprint(snapshot);
  const unchanged = sameState;

  if (unchanged) {
    return {
      state: current,
      changes: [],
      audit: [],
      unchanged: true,
      ok: true,
      message: "沒有變更"
    };
  }

  if (plan.report && plan.report.ok === false) {
    const nonCoolingErrors = (plan.report.errors || []).filter((e) => !e.coolingRequired);
    if (nonCoolingErrors.length > 0 || !plan.report.canStartCooling) {
      const reportErrors = nonCoolingErrors.length > 0 ? nonCoolingErrors : (plan.report.errors || []);
      return {
        state: current,
        changes,
        audit: [],
        unchanged: false,
        ok: false,
        canStartCooling: false,
        errors: plan.report.errors,
        message: reportErrors.map((e) => e.message).join("；") || "匯入驗證失敗"
      };
    }
  }

  const gated = applyGatedThresholdChange(current || {}, snapshot, {
    now: opts.now,
    reason: opts.reason,
    coolingUntil: opts.coolingUntil,
    cooling: opts.cooling,
    snapshotExemptFunds: housingSnapshotExempt(incoming),
    lastAuditAt: opts.lastAuditAt,
    b01Source: "import-gated"
  });
  const audit = [...(gated.audit || [])];
  if (!gated.ok) {
    return {
      state: current,
      changes,
      audit,
      unchanged: false,
      ok: false,
      message: gated.message,
      b13: gated.b13,
      cooling: gated.cooling,
      canStartCooling: Boolean(gated.requiresCooling)
    };
  }
  const nextState = { ...gated.state, finance_meta: snapshot.finance_meta || current?.finance_meta };
  return {
    state: nextState,
    changes: [...changes, ...audit],
    audit,
    unchanged: false,
    ok: true,
    cooling: gated.cooling,
    message: undefined
  };
}

function pendingUnknown(changes, key) {
  changes.push({ field: key, pending: true, message: "未確認建議值，記為待核" });
}

export function restoreBatch(current, previous, opts = {}) {
  const replaced = mergeDataset(current, previous, { mode: "replace" });
  delete replaced._importedKeys;
  delete replaced._mode;
  const gated = applyGatedThresholdChange(current, replaced, {
    now: opts.now,
    reason: opts.reason,
    coolingUntil: opts.coolingUntil,
    cooling: opts.cooling,
    lastAuditAt: opts.lastAuditAt,
    b01Source: "backup",
    fullReplace: true,
    fullCross: !opts.allowIncomplete,
    skipCross: !!opts.allowIncomplete
  });
  if (!gated.ok) {
    return {
      ok: false,
      b13: gated.b13,
      message: gated.message,
      cooling: gated.cooling,
      requiresCooling: gated.requiresCooling
    };
  }
  const audit = [
    ...(gated.audit || []),
    {
      type: "restore_batch",
      at: new Date(opts.now || Date.now()).toISOString(),
      reason: opts.reason || ""
    }
  ];
  return {
    ok: true,
    state: gated.state,
    b13: gated.b13,
    cooling: gated.cooling,
    audit
  };
}

export { parseRange, parseList, parseAreaMinutes, parseStaged };
