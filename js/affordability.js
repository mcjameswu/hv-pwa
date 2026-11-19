/**
 * Four affordability checks plus down-payment adequacy.
 * Errata E-1: "流動資金" in checks 1, 2, 4 is post-purchase liquid
 * (B19 − own_required − total × B20).
 */
import { parseNumericRaw, parseNumberForKey, normalizeValue, isFlagOn } from "./fields.js";
import { financeUnverified as trustUnverified } from "./finance-trust.js";

export const INSUFFICIENT = "資料不足";
export const DOWN_SHORT = "頭期或交屋現金不足";
export const DOWN_PENDING = "頭期資料不足";
export const UNVERIFIED = "資料未核實";

export function financeUnverified(finance, meta, now = Date.now()) {
  return trustUnverified(finance, meta, now);
}

const DOWN_FIELDS = {
  total: "開價總價",
  ltv_assumed: "預估貸款成數",
  own_funds_down: "可用於頭期的自有資金",
  liquid_funds_total: "購屋前可動用的流動資金",
  closing_cost_ratio: "購屋雜費比例",
  borrowed_down_amount: "頭期借款的金額",
  down_has_borrowed: "頭期資金是否含借款",
  ageYears: "屋齡"
};

/** 頭期是否含借款：true 與「是」算有借款；false 與「否」算沒借款；其他（含空白）算沒填。 */
function b06Yes(finance) {
  return isFlagOn(finance?.down_has_borrowed);
}

function b06Known(finance) {
  const v = finance?.down_has_borrowed;
  return isFlagOn(v) || v === false || v === "否";
}

function isBlank(v) {
  if (typeof v === "string") return v.trim() === "";
  return v === undefined || v === null;
}

/** 總價必須是大於 0 的有限數，否則當成「沒有」。 */
function positiveTotal(total) {
  const r = parseNumericRaw(total);
  return r.state === "ok" && r.value > 0 ? r.value : null;
}

/** 成數必須在 0 到 1 之間。 */
function ratio01(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
}

function n(v, key = null) {
  if (key) {
    const r = normalizeValue("finance", key, v);
    return r.state === "ok" ? r.value : null;
  }
  const r = parseNumericRaw(v);
  return r.state === "ok" ? r.value : null;
}

/** 萬元金額欄位：依欄位規格正規化與檢核下限（舊資料「600萬」可換算，負數拒收）。 */
function amt(v, key) {
  const r = normalizeValue("finance", key, v);
  return r.state === "ok" ? r.value : null;
}

/** Standard equal-installment mortgage. Principal and payment in 萬. */
export function monthlyPayment(principalWan, annualRatePct, years) {
  if (principalWan === null || annualRatePct === null || years === null) return null;
  if (![principalWan, annualRatePct, years].every((x) => typeof x === "number" && Number.isFinite(x))) return null;
  if (principalWan < 0 || years <= 0 || annualRatePct < 0) return null;
  const months = years * 12;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principalWan / months;
  const pow = Math.pow(1 + r, months);
  return (principalWan * r * pow) / (pow - 1);
}

function money(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return x;
  return Math.round(x * 1e6) / 1e6;
}

export function neededDown(total, ltv) {
  const t = positiveTotal(total);
  const l = ratio01(ltv);
  if (t === null || l === null) return null;
  return money(t - t * l);
}

/**
 * Own-funds portion of down payment.
 * B23 is capped at needed down.
 */
export function ownRequired(total, finance) {
  finance = finance || {};
  const ltv = n(finance.ltv_assumed);
  const nd = neededDown(total, ltv);
  if (nd === null) return { pending: true, needed: null, own: null, borrowedCapped: 0 };
  if (!b06Known(finance)) {
    return { pending: true, needed: nd, own: null, borrowedCapped: null };
  }
  const borrowed = b06Yes(finance) ? amt(finance.borrowed_down_amount, "borrowed_down_amount") : 0;
  const borrowedCapped = borrowed === null ? null : Math.min(borrowed, nd);
  if (b06Yes(finance) && borrowed === null) {
    return { pending: true, needed: nd, own: null, borrowedCapped: null };
  }
  const capB = borrowedCapped || 0;
  const own = money(Math.max(0, nd - capB));
  const warned = b06Yes(finance) && borrowed !== null && borrowed > nd;
  return { pending: false, needed: nd, own, borrowedCapped: capB, warnedB23: warned };
}

export function postPurchaseLiquid(total, finance) {
  finance = finance || {};
  const tot = positiveTotal(total);
  const b19 = amt(finance.liquid_funds_total, "liquid_funds_total");
  // 雜費比例 B20 也要走欄位範圍檢查（0 到 0.1）：負數或超過 0.1 當成待核，不能把負雜費算成多出來的現金（C-R11-02）
  const b20 = n(finance.closing_cost_ratio, "closing_cost_ratio");
  const o = ownRequired(tot, finance);
  if (tot === null || o.pending || b19 === null || b20 === null) return { pending: true, value: null };
  const value = money(b19 - o.own - tot * b20);
  return { pending: false, value, own: o.own, needed: o.needed };
}

export function holdingCostWan(mgmtFeeYuan, finance, ageYears) {
  const b21 = n(finance.holding_cost_monthly, "holding_cost_monthly");
  const mgmtParsed = parseNumberForKey("mgmt_fee_yuan", mgmtFeeYuan);
  if (mgmtFeeYuan === null || mgmtFeeYuan === undefined || mgmtParsed.state === "blank") {
    return { pending: true, value: null };
  }
  if (mgmtParsed.state !== "ok" || mgmtParsed.value < 0) return { pending: true, value: null };
  if (b21 === null) return { pending: true, value: null };
  const age = parseNumericRaw(ageYears);
  if (age.state !== "ok" || age.value < 0) {
    return { pending: true, value: null, missing: ["屋齡"] };
  }
  const mgmt = mgmtParsed.value / 10000;
  let h = money(mgmt + b21);
  const oldHouse = age.value >= 30;
  if (oldHouse) h = money(h * 1.5);
  return { pending: false, value: h, base: h, ageYears: age.value, oldHouse };
}

function stressedHolding(base, ageYears) {
  const age = parseNumericRaw(ageYears);
  if (age.state === "ok" && age.value >= 30) return money(base);
  return money(base * 1.2);
}

/**
 * Adequacy before the four checks. Any fail => all four show DOWN_SHORT.
 */
export function downAdequacy(total, finance) {
  finance = finance || {};
  total = positiveTotal(total);
  const b05 = amt(finance.own_funds_down, "own_funds_down");
  const b19 = amt(finance.liquid_funds_total, "liquid_funds_total");
  const b20 = n(finance.closing_cost_ratio, "closing_cost_ratio"); // 同上：範圍 0 到 0.1（C-R11-02）
  const ltv = n(finance.ltv_assumed);
  const missing = [];
  if (total === null) missing.push(DOWN_FIELDS.total);
  if (ltv === null) missing.push(DOWN_FIELDS.ltv_assumed);
  if (b05 === null) missing.push(DOWN_FIELDS.own_funds_down);
  if (b19 === null) missing.push(DOWN_FIELDS.liquid_funds_total);
  if (b20 === null) missing.push(DOWN_FIELDS.closing_cost_ratio);
  if (!b06Known(finance)) {
    missing.push(DOWN_FIELDS.down_has_borrowed);
  }
  if (b06Yes(finance) && amt(finance.borrowed_down_amount, "borrowed_down_amount") === null) {
    missing.push(DOWN_FIELDS.borrowed_down_amount);
  }
  if (ltv === null || total === null) {
    return { pending: true, pass: null, missing, status: DOWN_PENDING };
  }
  const nd = neededDown(total, ltv);
  const o = ownRequired(total, finance);
  if (o.pending || b05 === null || b19 === null || b20 === null) {
    return { pending: true, pass: null, needed: nd, own: o.own, missing, status: DOWN_PENDING };
  }
  const borrowed = b06Yes(finance) ? (o.borrowedCapped ?? 0) : 0;
  const fails = [];
  // 兩邊都先四捨五入到固定小數位再比，避免小數相乘的浮點尾數把剛好達標判成不足（F9-19 第 2 點）
  if (!b06Yes(finance) && money(b05) < money(nd)) fails.push("B05 < 所需頭期");
  if (b06Yes(finance) && money(b05 + borrowed) < money(nd)) fails.push("B05+B23 < 所需頭期");
  if (money(b05) < money(o.own)) fails.push("B05 < 自有部分");
  if (money(b19) < money(o.own + total * b20)) fails.push("B19 < 自有部分 + 交屋雜費");
  return {
    pending: false,
    pass: fails.length === 0,
    fails,
    needed: nd,
    own: o.own,
    borrowedCapped: o.borrowedCapped,
    closing: total * b20
  };
}

function missingAny(vals) {
  return vals.some((v) => v === null);
}

/**
 * @returns four checks plus adequacy. B01 blank => all 資料不足 (spec 6.3).
 */
export function runAffordability({ total, finance, mgmtFeeYuan = null, ageYears = null, capBlank = false, finance_meta = null }) {
  finance = finance && typeof finance === "object" ? finance : {};
  // 總價不是大於 0 的有限數時，一律當成「沒有總價」：頭期資料不足、四道資料不足
  total = positiveTotal(total);
  if (capBlank) {
    const insufficient = { status: INSUFFICIENT, pass: null };
    return {
      capBlank: true,
      adequacy: insufficient,
      checks: [insufficient, insufficient, insufficient, insufficient],
      liquid: { pending: true, value: null }
    };
  }
  if (financeUnverified(finance, finance_meta)) {
    const unverified = { status: UNVERIFIED, pass: null };
    return {
      capBlank: false,
      unverified: true,
      adequacy: unverified,
      checks: [unverified, unverified, unverified, unverified],
      liquid: { pending: true, value: null }
    };
  }
  const financeKeys = [
    "essential_monthly", "stable_monthly_income", "reserve_months", "holding_cost_monthly",
    "borrowed_down_monthly", "own_funds_down", "liquid_funds_total", "ltv_assumed",
    "max_payment_ratio", "base_rate_assumed", "loan_years_assumed", "closing_cost_ratio",
    "rate_shock_pp", "borrowed_down_amount"
  ];
  const mgmtChecked = isBlank(mgmtFeeYuan) ? null : parseNumberForKey("mgmt_fee_yuan", mgmtFeeYuan);
  const invalidInput = financeKeys.some((k) => {
    if (finance[k] === undefined || finance[k] === null || finance[k] === "") return false;
    return normalizeValue("finance", k, finance[k]).state === "invalid";
  }) || (mgmtChecked !== null && (mgmtChecked.state === "invalid" || (mgmtChecked.state === "ok" && mgmtChecked.value < 0)));
  if (invalidInput) {
    const insufficient = { status: INSUFFICIENT, pass: null };
    return {
      capBlank: false,
      adequacy: insufficient,
      checks: [insufficient, insufficient, insufficient, insufficient],
      liquid: { pending: true, value: null }
    };
  }
  const adeq = downAdequacy(total, finance);
  const liquid = postPurchaseLiquid(total, finance);
  const ltv = n(finance.ltv_assumed);
  const rate = n(finance.base_rate_assumed);
  const years = n(finance.loan_years_assumed);
  const essential = n(finance.essential_monthly, "essential_monthly");
  const b07 = n(finance.reserve_months, "reserve_months");
  const b09 = n(finance.stable_monthly_income, "stable_monthly_income");
  const b10 = n(finance.max_payment_ratio, "max_payment_ratio");
  const b11 = n(finance.rate_shock_pp);
  const b06Missing = !b06Known(finance);
  const b22 = b06Yes(finance) ? amt(finance.borrowed_down_monthly, "borrowed_down_monthly") : b06Missing ? null : 0;
  const b22Missing = b06Missing || (b06Yes(finance) && b22 === null);
  const nd = neededDown(total, ltv);
  const loan = nd === null || total === null ? null : total - nd;
  const pay = monthlyPayment(loan, rate, years);
  const hold = holdingCostWan(mgmtChecked?.state === "ok" ? mgmtChecked.value : null, finance, ageYears);

  const downShort = !adeq.pending && adeq.pass === false;
  const downPending = adeq.pending === true;
  const mkShort = () => ({
    status: DOWN_SHORT,
    pass: false
  });
  const mkDownPending = () => ({
    status: DOWN_PENDING,
    pass: null,
    missing: adeq.missing || []
  });

  const checks = [];

  // Check 1: liquid / (essential + payment + holding - 0) >= B07
  const denom1 = pay === null || essential === null || hold.pending || b22Missing
    ? null
    : money(essential + pay + hold.value + b22);
  if (downShort) checks[0] = mkShort();
  else if (downPending) checks[0] = mkDownPending();
  else if (liquid.pending || missingAny([denom1, b07]) || denom1 === 0) {
    checks[0] = { status: INSUFFICIENT, pass: null };
  } else {
    const months = money(liquid.value / denom1);
    const pass = months >= b07 || money(liquid.value - money(b07 * denom1)) >= 0;
    checks[0] = {
      status: pass ? "通過" : "未過",
      pass,
      months,
      numerator: liquid.value,
      outflow: denom1,
      display: `撐 ${round2(months)} 個月`
    };
  }

  // Check 2: stressed holding, recompute check 1
  const hold2 = hold.pending ? null : stressedHolding(hold.value, ageYears);
  const denom2 = pay === null || essential === null || hold2 === null || b22Missing
    ? null
    : money(essential + pay + hold2 + b22);
  if (downShort) checks[1] = mkShort();
  else if (downPending) checks[1] = mkDownPending();
  else if (liquid.pending || missingAny([denom2, b07]) || denom2 === 0) {
    checks[1] = { status: INSUFFICIENT, pass: null };
  } else {
    const months = money(liquid.value / denom2);
    const pass = months >= b07 || money(liquid.value - money(b07 * denom2)) >= 0;
    checks[1] = {
      status: pass ? "通過" : "未過",
      pass,
      months,
      numerator: liquid.value,
      outflow: denom2,
      holding_stressed: hold2,
      display: `撐 ${round2(months)} 個月`
    };
  }

  // Check 3: shocked payment / income <= B10
  const shockedPay = monthlyPayment(loan, rate === null || b11 === null ? null : rate + b11, years);
  if (downShort) checks[2] = mkShort();
  else if (downPending) checks[2] = mkDownPending();
  else if (missingAny([shockedPay, b09, b10]) || !(b09 > 0) || b22Missing) {
    checks[2] = { status: INSUFFICIENT, pass: null };
  } else {
    const ratio = (shockedPay + b22) / b09;
    checks[2] = {
      status: ratio <= b10 ? "通過" : "未過",
      pass: ratio <= b10,
      ratio,
      display: `比例 ${round2(ratio * 100)}%`
    };
  }

  // Check 4: liquid - B07 * outflow_shocked >= 0
  const hold4 = hold.pending ? null : hold.value;
  const outflow4 = shockedPay === null || essential === null || hold4 === null || b22Missing
    ? null
    : money(essential + shockedPay + hold4 + b22);
  if (downShort) checks[3] = mkShort();
  else if (downPending) checks[3] = mkDownPending();
  else if (liquid.pending || missingAny([outflow4, b07]) || outflow4 === 0) {
    checks[3] = { status: INSUFFICIENT, pass: null };
  } else {
    const needed = money(b07 * outflow4);
    const remain = money(liquid.value - needed);
    checks[3] = {
      status: remain >= 0 ? "通過" : "未過",
      pass: remain >= 0,
      remain,
      ratio: needed === 0 ? 0 : remain / needed,
      display: needed === 0 ? "差額比例 0" : `差額比例 ${round2((remain / needed) * 100)}%`
    };
  }

  return {
    capBlank: false,
    adequacy: adeq.pending
      ? { status: DOWN_PENDING, pass: null, missing: adeq.missing || [] }
      : {
          status: adeq.pass ? "通過" : DOWN_SHORT,
          pass: adeq.pass,
          ...adeq
        },
    checks,
    liquid,
    payment: pay,
    shocked_payment: shockedPay,
    loan,
    needed_down: nd,
    borrowed_monthly: b22,
    disclaimer: "依你的假設試算，不是銀行核貸結果"
  };
}

function round2(x) {
  return Math.round(x * 100) / 100;
}
