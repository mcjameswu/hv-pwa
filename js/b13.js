/**
 * B13 tighten-only: loosening requires a 7-day cooling period and a written reason.
 */
import { splitList } from "./lists.js";
import { parseNumericRaw, parseNumberForKey } from "./fields.js";
import { DEFAULT_SCORING } from "./defaults.js";

const COOLING_MS = 7 * 24 * 60 * 60 * 1000;

/** Raising these is loosening. */
const RAISE_IS_LOOSE = [
  "budget_cap_total",
  "search_range_high",
  "search_ratio_max",
  "max_payment_ratio",
  "ltv_assumed",
  "common_ratio_max",
  "age_max",
  "mgmt_fee_max",
  "borrowed_down_amount"
];

/** Lowering these is loosening. */
const LOWER_IS_LOOSE = [
  "reserve_months",
  "rate_shock_pp",
  "hold_years_min",
  "base_rate_assumed",
  "about_markup",
  "rooms_min",
  "stretch_min_total",
  "stretch_min_price"
];

/** 把值轉成數字；有給欄位代號就依欄位的單位解析（萬元金額收「1500萬」，元金額收「3千」）。 */
function num(v, key) {
  const r = key ? parseNumberForKey(key, v) : parseNumericRaw(v);
  return r.state === "ok" ? r.value : null;
}

/** 是否類欄位：true／「是」→ 是；false／「否」→ 否；空 → null；其他 → 不合法。 */
export function yn(v) {
  if (v === true || v === "是") return "是";
  if (v === false || v === "否") return "否";
  return v === undefined || v === null || v === "" ? null : "不合法";
}

/** 「門檻只能調嚴」保護是否開著。沒填（缺值）預設開；明確填成否、空白或不合法就是關。 */
function protectionOn(v) {
  if (v === undefined) return true;
  return yn(v) === "是";
}

/**
 * 比較用的有效數值（F9-14）：新舊兩邊用同一個函式取值，才不會「舊的補了預設、新的沒補」而把沒動過的欄位當成被清空。
 * 欄位根本沒有（undefined）時補規格預設值，才抓得到「從預設往鬆的方向改」；
 * 明確寫成空字串或 null 才是「清空」，回 null，仍會被當成調鬆。
 */
function effNum(state, k) {
  const raw = getNested(state, k);
  if (raw === undefined) return Object.prototype.hasOwnProperty.call(DEFAULT_SCORING, k) ? num(DEFAULT_SCORING[k], k) : null;
  return num(raw, k);
}

function listOf(v) {
  if (v === undefined || v === null || v === "") return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return splitList(v);
}

const FINANCE_KEYS = new Set([
  "budget_cap_total",
  "search_range_high",
  "search_ratio_max",
  "max_payment_ratio",
  "ltv_assumed",
  "borrowed_down_amount",
  "reserve_months",
  "rate_shock_pp",
  "hold_years_min",
  "base_rate_assumed",
  "loan_years_assumed",
  "own_funds_down",
  "liquid_funds_total",
  "down_has_borrowed",
  "tighten_only"
]);
const PROFILE_KEYS = new Set([
  "common_ratio_max",
  "age_max",
  "mgmt_fee_max",
  "rooms_min",
  "deal_breaker"
]);
const SCORING_KEYS = new Set([
  "over_cap_action",
  "stretch_min_total",
  "stretch_min_price",
  "about_markup"
]);

function getNested(state, key) {
  if (!state) return undefined;
  if (FINANCE_KEYS.has(key)) return state.finance ? state.finance[key] : undefined;
  if (PROFILE_KEYS.has(key)) return state.profile ? state.profile[key] : undefined;
  if (SCORING_KEYS.has(key)) return state.scoring ? state.scoring[key] : undefined;
  return undefined;
}

function collectLoosening(prev, next, { snapshotExemptFunds = false } = {}) {
  const hits = [];
  if (!prev) return hits;

  for (const k of RAISE_IS_LOOSE) {
    const a = effNum(prev, k);
    const b = effNum(next, k);
    if (a !== null && b !== null && b > a) hits.push({ field: k, kind: "raise", from: a, to: b });
    if (a !== null && b === null) hits.push({ field: k, kind: "clear", from: a, to: null });
  }
  for (const k of LOWER_IS_LOOSE) {
    const a = effNum(prev, k);
    const b = effNum(next, k);
    if (a !== null && b !== null && b < a) hits.push({ field: k, kind: "lower", from: a, to: b });
    if (a !== null && b === null) hits.push({ field: k, kind: "clear", from: a, to: null });
  }

  const loanA = effNum(prev, "loan_years_assumed");
  const loanB = effNum(next, "loan_years_assumed");
  if (loanA !== null && loanB !== null && loanB > loanA) {
    hits.push({ field: "loan_years_assumed", kind: "lengthen", from: loanA, to: loanB });
  }
  if (loanA !== null && loanB === null) {
    hits.push({ field: "loan_years_assumed", kind: "clear", from: loanA, to: null });
  }

  const e07a = getNested(prev, "over_cap_action") || "淘汰";
  const e07b = getNested(next, "over_cap_action");
  if (e07a === "淘汰" && e07b === "觀察") {
    hits.push({ field: "over_cap_action", kind: "e07_observe" });
  }

  const prevDb = listOf(getNested(prev, "deal_breaker"));
  const nextDb = listOf(getNested(next, "deal_breaker"));
  const removed = prevDb.filter((x) => x !== "無" && !nextDb.includes(x));
  if (removed.length) {
    hits.push({
      field: "deal_breaker",
      kind: "removed",
      items: removed,
      from: prevDb,
      to: nextDb,
      fromList: prevDb,
      toList: nextDb
    });
  }

  // 頭期是否含借款：由「否」或明確的空值變成「是」是調鬆（布林值與字串同樣處理）。從來沒填過（缺鍵）的第一次設定不算。
  const borrowedPrev = getNested(prev, "down_has_borrowed");
  const borrowedWasNo = yn(borrowedPrev) === "否" || (borrowedPrev !== undefined && yn(borrowedPrev) === null);
  if (borrowedWasNo && yn(getNested(next, "down_has_borrowed")) === "是") {
    hits.push({ field: "down_has_borrowed", kind: "borrow_yes" });
  }

  // 自有頭期與流動資金：清空一律算調鬆（不適用快照豁免）；調高只有已核實且附來源的快照可以豁免
  for (const k of ["own_funds_down", "liquid_funds_total"]) {
    const a = effNum(prev, k);
    const b = effNum(next, k);
    if (a !== null && b === null) hits.push({ field: k, kind: "clear", from: a, to: null });
    else if (!snapshotExemptFunds && a !== null && b !== null && b > a) {
      hits.push({ field: k, kind: "manual_raise", from: a, to: b });
    }
  }

  // 「門檻只能調嚴」本身被關掉
  if (protectionOn(getNested(prev, "tighten_only")) && !protectionOn(getNested(next, "tighten_only"))) {
    hits.push({ field: "tighten_only", kind: "disable" });
  }

  return hits;
}

export function isLoosening(prev, next, opts) {
  return collectLoosening(prev, next, opts);
}

/**
 * @returns {{ ok: boolean, requiresCooling: boolean, hits: object[], message?: string }}
 */
export function checkB13(prev, next, opts = {}) {
  const hits = collectLoosening(prev, next, opts);
  if (!hits.length) return { ok: true, requiresCooling: false, hits: [] };
  // 上一版保護是開的，或這次修改後保護仍開，就要走冷靜期；兩邊都關才不擋
  const tighten = protectionOn(next?.finance?.tighten_only);
  const prevTighten = protectionOn(prev?.finance?.tighten_only);
  if (!tighten && !prevTighten) {
    return { ok: true, requiresCooling: false, hits, message: "B13 為否，調鬆不擋" };
  }
  let now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const lastAuditAt = opts.lastAuditAt ? new Date(opts.lastAuditAt).getTime() : null;
  const clockRollback = Number.isFinite(lastAuditAt) && now < lastAuditAt;
  if (clockRollback) now = lastAuditAt;
  const cooling = opts.cooling || null;
  const coolingUntil = opts.coolingUntil
    ? new Date(opts.coolingUntil).getTime()
    : cooling?.until
      ? new Date(cooling.until).getTime()
      : null;
  const reason = (opts.reason || cooling?.reason || "").trim();
  const inCooling =
    coolingUntil !== null && now >= coolingUntil - COOLING_MS && now < coolingUntil;
  const cooled = !clockRollback && coolingUntil !== null && now >= coolingUntil;
  if (cooled && reason && coolingMatches(cooling, hits)) {
    return { ok: true, requiresCooling: false, hits, cooled: true, consumeCooling: true };
  }
  return {
    ok: false,
    requiresCooling: true,
    hits,
    coolingMs: COOLING_MS,
    message: "門檻調鬆須等 7 天冷靜期並寫理由",
    inCooling,
    needsReason: !reason,
    mismatch: cooled && !coolingMatches(cooling, hits)
  };
}

function sameVal(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === "number" || typeof b === "number") {
    const na = parseNumericRaw(a);
    const nb = parseNumericRaw(b);
    return na.state === "ok" && nb.state === "ok" && na.value === nb.value;
  }
  return String(a) === String(b);
}

function listKey(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).sort().join("\0");
  if (v === undefined || v === null || v === "") return "";
  return listOf(v).sort().join("\0");
}

export function coolingMatches(cooling, hits) {
  if (!cooling || !hits?.length) return false;
  const rec = Array.isArray(cooling.hits) && cooling.hits.length
    ? cooling.hits
    : [{
        field: cooling.field,
        from: cooling.from,
        to: cooling.to,
        kind: cooling.kind,
        items: cooling.items,
        fromList: cooling.fromList,
        toList: cooling.toList
      }];
  if (rec.length !== hits.length) return false;
  return hits.every((h) =>
    rec.some((r) => {
      if (r.field !== h.field) return false;
      if ((r.kind || h.kind) && (r.kind || "") !== (h.kind || "")) return false;
      if (h.kind === "removed" || h.items || r.items) {
        return listKey(r.items || h.items) === listKey(h.items)
          && listKey(r.fromList || r.from) === listKey(h.fromList || h.from)
          && listKey(r.toList || r.to) === listKey(h.toList || h.to);
      }
      return sameVal(r.to, h.to) && sameVal(r.from, h.from);
    })
  );
}

export function coolingDeadline(from = Date.now()) {
  return new Date(new Date(from).getTime() + COOLING_MS).toISOString();
}

export { COOLING_MS };
