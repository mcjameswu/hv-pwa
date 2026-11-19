import { MONEY_WORD_PATTERN, amountWritings, intToChinese, extractNormalizedAmounts, sameWan, sameRatio, ratioWritings, extractNormalizedRatios } from "./chinese-num.js";
import { splitList } from "./lists.js";
import { parseNumericRaw, parseAmountWan, parseNumberForKey } from "./fields.js";
import { toHalfwidth } from "./pii.js";

/**
 * 私密金額欄位清單（B01 可承受上限加財務區的各個金額欄位）。
 * 掃描器拿它比對文字裡的金額；問價紀錄的金額也用同一份清單比對（第 15 輪 F-R15-03），欄位增加時兩邊自動一起涵蓋。
 * 比例、年限、月數這類不是金額的欄位不在清單裡：它們是小整數或小數（例如預備金 6 個月），
 * 拿來比對問價金額會誤擋很多正常的紀錄，所以只在文字裡「緊鄰預備金、利率這類詞」時才由別的規則掃描。
 */
const MONEY_FIELDS = [
  "budget_cap_total",
  "own_funds_down",
  "essential_monthly",
  "stable_monthly_income",
  "staged_offer_steps",
  "liquid_funds_total",
  "holding_cost_monthly",
  "borrowed_down_monthly",
  "borrowed_down_amount"
];

export const PRIVATE_MONEY_FIELDS = MONEY_FIELDS;

const MONEY_UNITS = "萬|元|千|万";
const MONEY_WORDS = MONEY_WORD_PATTERN;

const RATIO_MAP = {
  search_ratio_max: "比例|搜尋上緣",
  reserve_months: "預備金",
  max_payment_ratio: "月付上限|成數",
  rate_shock_pp: "升息|利率",
  hold_years_min: "持有|年限",
  ltv_assumed: "成數",
  base_rate_assumed: "利率",
  loan_years_assumed: "年限",
  closing_cost_ratio: "雜費|契稅",
  commute: "通勤|車程|騎車"
};

const RATIO_WORDS = "預備金|成數|利率|年限|通勤|車程|騎車";
const UNIT_RATIO_WORDS = "比例|搜尋上緣|上緣|月付|成數|收入|上限|貸款|雜費|契稅";
const UNIT_RATIO_FIELDS = [
  ["search_ratio_max", "比例|搜尋上緣|上緣"],
  ["max_payment_ratio", "月付|成數|收入|上限"],
  ["ltv_assumed", "成數|貸款"],
  ["closing_cost_ratio", "雜費|契稅|比例"]
];

function valuesOf(finance, key) {
  const v = finance?.[key];
  if (v === undefined || v === null || v === "") return [];
  if (key === "staged_offer_steps") {
    return splitList(v)
      .map((x) => parseAmountWan(x))
      .filter((x) => x.state === "ok")
      .map((x) => x.value);
  }
  const n = parseNumberForKey(key, v);
  return n.state === "ok" ? [n.value] : [];
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWriting(text, writing) {
  if (!writing) return false;
  const n = escapeRe(writing);
  const re = new RegExp(`(?<![\\d.,])${n}(?![\\d.,])`);
  return re.test(text);
}

function adjacentTo(text, numberStr, wordRe, { moneyUnits = false } = {}) {
  const n = escapeRe(numberStr);
  const unitPart = moneyUnits ? `|${MONEY_UNITS}` : "";
  const re = new RegExp(
    `(?:${wordRe})[^。，,\\n]{0,6}(?<![\\d.,])${n}(?![\\d.,])|(?<![\\d.,])${n}(?![\\d.,])[^。，,\\n]{0,6}(?:${wordRe}${unitPart})`
  );
  return re.test(text);
}

// 全形轉半形只留 pii.js 的一份（F9-16）
function normalizeScanText(text) {
  return toHalfwidth(String(text || ""));
}

/**
 * Scan draft text by recipient.
 * recipient: agent | partner | share | upload
 */
export function scanDraft(text, ctx = {}) {
  const {
    finance = {},
    areas = [],
    travel = [],
    recipient = "share",
    stretchMentioned = false,
    stretchPrices = []
  } = ctx;
  const hits = [];
  const t = normalizeScanText(text);

  const partnerBlocks = new Set(["budget_cap_total", "staged_offer_steps", "liquid_funds_total"]);
  const extracted = extractNormalizedAmounts(t);

  for (const key of MONEY_FIELDS) {
    if (recipient === "partner" && !partnerBlocks.has(key)) continue;
    const vals = valuesOf(finance, key);
    for (const val of vals) {
      const ge100 = val >= 100;
      for (const a of extracted) {
        if (!sameWan(a.wan, val)) continue;
        if (ge100) {
          hits.push({ level: "block", field: key, writing: a.raw, rule: "money_ge_100" });
        } else if (a.adjacentMoney) {
          hits.push({ level: "block", field: key, writing: a.raw, rule: "money_lt_100_adjacent" });
        }
      }
      const writings = amountWritings(val);
      for (const w of writings) {
        if (!containsWriting(t, w)) continue;
        if (ge100) {
          hits.push({ level: "block", field: key, writing: w, rule: "money_ge_100" });
        } else if (adjacentTo(t, w, `${MONEY_UNITS}|${MONEY_WORDS}`, { moneyUnits: true })) {
          hits.push({ level: "block", field: key, writing: w, rule: "money_lt_100_adjacent" });
        }
      }
    }
  }

  const ratioValues = [
    ["reserve_months", finance.reserve_months, "預備金"],
    ["rate_shock_pp", finance.rate_shock_pp, "升息|利率"],
    ["hold_years_min", finance.hold_years_min, "持有|年限"],
    ["base_rate_assumed", finance.base_rate_assumed, "利率"],
    ["loan_years_assumed", finance.loan_years_assumed, "年限"]
  ];
  for (const [field, val, words] of ratioValues) {
    if (val === undefined || val === null || val === "") continue;
    const parsed = parseNumericRaw(val);
    if (parsed.state !== "ok") continue;
    const display = parsed.value;
    const raw = String(display);
    const cn = Number.isInteger(display) ? intToChinese(display) : "";
    for (const w of [raw, cn].filter(Boolean)) {
      if (!containsWriting(t, w)) continue;
      if (recipient === "partner") continue;
      if (adjacentTo(t, w, words) || adjacentTo(t, w, RATIO_WORDS)) {
        hits.push({ level: "block", field, writing: w, rule: "ratio_adjacent" });
      }
    }
  }

  if (recipient !== "partner") {
    const extractedRatios = extractNormalizedRatios(t);
    for (const [field, words] of UNIT_RATIO_FIELDS) {
      const val = finance[field];
      if (val === undefined || val === null || val === "") continue;
      const parsedR = parseNumericRaw(val);
      if (parsedR.state !== "ok") continue;
      const display = parsedR.value;
      for (const w of ratioWritings(display)) {
        if (!containsWriting(t, w) && !t.includes(w)) continue;
        if (adjacentTo(t, w, words) || adjacentTo(t, w, RATIO_WORDS) || adjacentTo(t, w, UNIT_RATIO_WORDS)) {
          hits.push({ level: "block", field, writing: w, rule: "ratio_adjacent" });
        }
      }
      for (const ex of extractedRatios) {
        if (!sameRatio(ex.value, display)) continue;
        if (adjacentTo(t, ex.raw, words) || adjacentTo(t, ex.raw, RATIO_WORDS) || adjacentTo(t, ex.raw, UNIT_RATIO_WORDS)) {
          hits.push({ level: "block", field, writing: ex.raw, rule: "ratio_adjacent" });
        }
      }
    }
  }

  if (recipient !== "partner" && Array.isArray(travel)) {
    for (const row of travel) {
      for (const col of ["minutes_to_area", "minutes_back"]) {
        if (!row[col]) continue;
        const parts = splitList(row[col]);
        for (const p of parts) {
          const m = p.match(/:(\d+)/);
          if (!m) continue;
          if (adjacentTo(t, m[1], "通勤|車程|騎車")) {
            hits.push({ level: "block", field: col, writing: m[1], rule: "travel_adjacent" });
          }
        }
      }
    }
  }

  const privateText = [];
  for (const a of areas) {
    if (a.area_label) privateText.push({ field: "area_label", value: a.area_label, code: "D02" });
    if (a.anchor) privateText.push({ field: "anchor", value: a.anchor, code: "D11" });
  }
  for (const row of travel) {
    if (row.place_alias) privateText.push({ field: "place_alias", value: row.place_alias, code: "G01" });
  }
  const allowAreaLabel = recipient === "agent";
  if (recipient === "share" || recipient === "upload" || recipient === "agent" || recipient === "partner") {
    for (const p of privateText) {
      if (allowAreaLabel && p.code === "D02") continue;
      const needle = normalizeScanText(p.value);
      if (recipient === "agent" && p.code !== "D02" && needle && t.includes(needle)) {
        hits.push({ level: "block", field: p.field, writing: p.value, rule: "private_text" });
      }
      if ((recipient === "share" || recipient === "upload") && needle && t.includes(needle)) {
        hits.push({ level: "block", field: p.field, writing: p.value, rule: "private_text" });
      }
    }
  }

  if (recipient !== "partner") {
    for (const pr of stretchPrices) {
      if (pr == null) continue;
      for (const a of extracted) {
        if (sameWan(a.wan, pr)) {
          hits.push({ level: "block", field: "stretch", writing: a.raw, rule: "no_stretch_price" });
        }
      }
    }
    if (stretchMentioned || /延伸帶|超出搜尋|再高一點|範圍可以再高/.test(t)) {
      hits.push({ level: "block", field: "stretch", rule: "no_stretch_mention" });
    }
  }

  if (recipient === "upload") {
    const banned = ["評分", "錄音", "逐字稿"];
    for (const b of banned) {
      if (t.includes(b)) hits.push({ level: "block", field: "upload", writing: b, rule: "upload_whitelist" });
    }
  }

  const blocked = hits.length > 0;
  return { ok: !blocked, hits };
}

const UPLOAD_KEYS = [
  "property_code",
  "community_name",
  "viewing_date",
  "viewing_sheet_photo",
  "onsite_photo_selected",
  "land_registry_screenshot"
];

export function whitelistUploadPack(item) {
  const allowed = new Set(UPLOAD_KEYS);
  const out = {};
  for (const k of Object.keys(item || {})) {
    if (allowed.has(k)) out[k] = item[k];
  }
  return out;
}

export function buildShareSummary(property = {}, viewing = {}) {
  return {
    property_code: property.id || property.property_code || "",
    community_name: property.community_name || "",
    viewing_date: viewing.start || viewing.viewing_date || "",
    viewing_sheet_photo: viewing.sheet_photo || "",
    onsite_photo_selected: viewing.onsite_photo_selected || "",
    land_registry_screenshot: property.land_registry_screenshot || ""
  };
}

export const UPLOAD_WHITELIST = [
  "物件代號",
  "社區名稱",
  "看房日期",
  "帶看單照片",
  "使用者勾選的現場照片",
  "使用者自備的地政查詢截圖"
];

export { MONEY_FIELDS, RATIO_MAP };
