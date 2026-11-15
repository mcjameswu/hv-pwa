/**
 * Block personally identifiable or login-like content in import text fields.
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const MOBILE_RE = /(?<!\d)(?:\+886[-\s]?9\d{2}[-\s]?\d{3}[-\s]?\d{3}|09\d{2}[-\s]?\d{3}[-\s]?\d{3})(?!\d)/;

/**
 * 市話區碼（F9-16，以台灣現行區碼為準）：四碼 0826、0836，三碼 037、049、082、089，兩碼 02 到 08。
 * 0800 與 0809 開頭是公開客服號碼，不擋（08 後面不接 00 或 09）。
 */
const AREA = "(?:0826|0836|037|049|082|089|02|03|04|05|06|07|08(?!00|09))";

/**
 * 四種寫法都擋：
 *  1. 有括號：(02) 1234-5678、（037）123456（全形括號先轉成半形），號碼本體可再分段
 *  2. 有連字號：02-1234-5678、037-123456，連字號後可再分段
 *  3. 區碼、空白、再接「號碼-號碼」：02 2345-6789
 *  4. 沒有括號也沒有連字號：區碼後面緊接 6 到 8 位連續數字（區碼後可隔一個空白）
 * 第 4 種不允許中間再分段，才不會把「03 1200 1300」這種用空白分隔的價格誤判成市話。
 * 第 3 種和日期、價格區間長得很像，所以多三道防線（F-R11-06）：
 *  - 區碼前面是「數字加斜線、點、冒號或連字號」是日期或時間（11/04 1200-1300 看房），不是區碼
 *  - 前面緊貼價格字詞（預算 03 1200-1500）不是市話
 *  - 後面接萬、元、坪等單位（04 1200-1300萬）是價格區間
 * 真正的市話前面通常是「電話」「聯絡」這類字，仍然擋。
 */
const PRICE_WORDS = "預算|價格|總價|開價|售價|價位|報價|成交價|價錢|房價";
const SPACED_LANDLINE = String.raw`(?<!\d[/.:\-])(?<!(?:${PRICE_WORDS})[:\s]{0,2})${AREA}\s\d{3,4}-\d{3,4}(?!\s?[萬万元坪千億])`;
const LANDLINE_RE = new RegExp(
  String.raw`(?<!\d)(?:\(\s*${AREA}\s*\)[-\s]?\d{3,4}[-\s]?\d{3,4}|${AREA}-\d{3,4}[-\s]?\d{3,4}|${SPACED_LANDLINE}|${AREA}\s?\d{6,8})(?!\d)`
);
const TWELVE_DIGITS_RE = /\d{12,}/;
const TWID_RE = /[A-Z][1289]\d{8}/i;
const ADDRESS_RE = /(路|街|大道)[^，。,\n]{0,16}(?:\d+|[\d一二三四五六七八九十百千]+)(?:\s*之\s*\d+)?\s*號/;
const CREDENTIAL_RE = /(密碼|口令|password|passwd|api[_-]?key|secret|token|登入憑證)/i;

export const PII_MESSAGE = "這格不能放可識別個人或登入的資料";

/**
 * 全形轉半形（掃描個資與金額共用的唯一一份，F9-16）：
 * 全形字元 U+FF01 到 U+FF5E 一律減 0xFEE0（涵蓋數字、英文字母、＠、．、－、（、）、＋ 等），
 * 全形空白轉半形空白，各種破折與連字符號（U+2010 到 U+2015、U+2212）轉成半形連字號。
 */
export function toHalfwidth(s) {
  return String(s)
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ")
    .replace(/[‐-―−]/g, "-");
}

/** 一段文字是不是完整門牌樣式（路街大道加數字加號），自由文字欄位擋地址用（F-R16B-03）。 */
export function hasAddressPattern(text) {
  return ADDRESS_RE.test(toHalfwidth(String(text ?? "")));
}

export function findPii(text) {
  if (text === undefined || text === null) return null;
  const s = toHalfwidth(String(text));
  if (!s.trim()) return null;
  if (EMAIL_RE.test(s)) return "電子郵件";
  if (MOBILE_RE.test(s)) return "手機號碼";
  if (LANDLINE_RE.test(s)) return "市話號碼";
  if (TWELVE_DIGITS_RE.test(s)) return "12 位以上連續數字";
  if (TWID_RE.test(s)) return "證件號碼樣式";
  if (ADDRESS_RE.test(s)) return "完整門牌樣式";
  if (CREDENTIAL_RE.test(s)) return "登入憑證字樣";
  return null;
}

export function assertNoPii(text, fieldLabel) {
  const hit = findPii(text);
  if (hit) {
    return { ok: false, field: fieldLabel, reason: PII_MESSAGE, detail: hit };
  }
  return { ok: true };
}

/** Text fields on each import sheet that must be scanned. */
export const TEXT_FIELDS = {
  settings: ["call_name", "partner_label", "device_note"],
  finance: ["staged_offer_steps"],
  profile: [
    "price_band",
    "target_areas",
    "commute_target",
    "walk_to_transit",
    "unit_price_range",
    "area_range",
    "layout_note",
    "parking",
    "floor_pref",
    "product_type",
    "amenities",
    "must_have",
    "deal_breaker"
  ],
  area: ["area_label", "anchor", "pop_net_inflow", "avg_income", "cre_report"],
  property: ["property_code", "community_name", "floor_note", "product_type", "agent_company", "branch_label", "agent_alias", "source_note", "memory_note"],
  agent: ["brand", "branch_label", "agent_alias"],
  travel: ["place_alias", "minutes_to_area", "minutes_back"]
};

export function scanImportForPii(data) {
  const errors = [];
  const check = (value, label) => {
    const r = assertNoPii(value, label);
    if (!r.ok) errors.push({ level: "error", field: label, message: PII_MESSAGE, detail: r.detail });
  };
  if (data.settings) {
    for (const k of TEXT_FIELDS.settings) check(data.settings[k], k);
  }
  if (data.finance) {
    for (const k of TEXT_FIELDS.finance) check(data.finance[k], k);
  }
  if (data.profile) {
    for (const k of TEXT_FIELDS.profile) check(data.profile[k], k);
  }
  if (Array.isArray(data.areas)) {
    data.areas.forEach((a, i) => {
      for (const k of TEXT_FIELDS.area) check(a[k], `areas[${i}].${k}`);
    });
  }
  if (Array.isArray(data.agents)) {
    data.agents.forEach((a, i) => {
      for (const k of TEXT_FIELDS.agent) check(a[k], `agents[${i}].${k}`);
    });
  }
  if (Array.isArray(data.properties)) {
    data.properties.forEach((a, i) => {
      if (!a || typeof a !== "object") return;
      for (const k of TEXT_FIELDS.property) check(a[k], `properties[${i}].${k}`);
    });
  }
  if (Array.isArray(data.travel)) {
    data.travel.forEach((a, i) => {
      for (const k of TEXT_FIELDS.travel) check(a[k], `travel[${i}].${k}`);
    });
  }
  return errors;
}
