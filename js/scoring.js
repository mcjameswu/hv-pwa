import { DEFAULT_SCORING, SCREEN_KEYS, CONDITION_KEYS, SCREEN_LABELS } from "./defaults.js";
import { splitList } from "./lists.js";
import { parseNumericRaw, capIsBlank as financeCapIsBlank, normalizeCondition, normalizeValue, resolveScreenInputs, isFlagOn, PROPERTY_EDIT_KEYS } from "./fields.js";
import { itemsForViewing, itemsAssumed } from "./items-for-viewing.js";
import { rankEligible, agentListEligible } from "./rank-eligible.js";

export const PENDING = "待核";
export const INSUFFICIENT = "資料不足";
export const ELIMINATE = "淘汰";
export const WATCH = "觀察";
export const STRETCH = "超出搜尋區間";
export const CAP_BLANK_MARK = "上限待填，不進候選";

/** 一票否決的三種「看房紀錄證據」，累積計算，不因後來的空白看房而消失。 */
export const VETO_KINDS = ["嚴重漏水", "現金流撐不住", "看後決定淘汰"];

function isBlank(v) {
  return v === undefined || v === null || v === "" || v === PENDING;
}

function n(v) {
  const r = parseNumericRaw(v);
  if (r.state === "ok") return r.value;
  return null;
}

/** 大於 0 的數字才算有開價；0 或負數視同沒填。 */
function positiveOrNull(v) {
  return v !== null && v > 0 ? v : null;
}

export function round1(x) {
  return Math.round(x * 10) / 10;
}

/**
 * Split parking out of asking unit price.
 * 有無車位、車位是否含在開價都沒填時，不能當成沒有車位算出確定單價。
 * @returns {{ unit: number|null, pending: boolean, reason?: string }}
 */
export function unitPriceAfterParking(property) {
  const ask = n(property.ask_total);
  const ping = n(property.ping_total);
  const parkAsk = n(property.parking_price_ask);
  const parkPing = n(property.parking_ping);
  if (ask !== null && ask <= 0) {
    // 開價 0 不是「不知道」的寫法，而且會讓單價變 0、價格滿分（F9-06）
    return { unit: null, pending: true, reason: "開價須大於 0" };
  }
  if (ask === null || ping === null || ping <= 0) {
    return { unit: null, pending: true, reason: "開價或坪數不明" };
  }
  if ((parkAsk !== null && parkAsk < 0) || (parkPing !== null && parkPing < 0)) {
    return { unit: null, pending: true, reason: "車位開價或車位坪不正確" };
  }
  const inc = property.parking_included_in_ask;
  const incYes = inc === true || inc === "是" || inc === "含在開價";
  const incNo = inc === false || inc === "否" || inc === "不含在開價";
  const hp = property.has_parking;
  const hasYes = hp === true || hp === "是" || hp === "有" || parkAsk !== null || parkPing !== null;
  const hasNo = hp === false || hp === "否" || hp === "無";
  if (!hasYes && !hasNo) return { unit: null, pending: true, reason: "車位資料未填" };
  if (hasNo) return { unit: ask / ping, pending: false };
  if (!incYes && !incNo) return { unit: null, pending: true, reason: "有車位但未填是否含在開價" };
  if (incNo) return { unit: ask / ping, pending: false };
  // 以下是「含在開價」的拆算與三個待核情形
  if (parkAsk === null || parkPing === null) {
    return { unit: null, pending: true, reason: "車位含在開價但車位開價或車位坪不明" };
  }
  if (parkAsk > ask || ask - parkAsk <= 0) {
    return { unit: null, pending: true, reason: "車位開價大於或等於總開價" };
  }
  const denom = ping - parkPing;
  if (denom <= 0) return { unit: null, pending: true, reason: "車位坪不正確" };
  return { unit: (ask - parkAsk) / denom, pending: false };
}

export function scoreCommute(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0) {
    return { score: null, pending: true };
  }
  if (minutes <= 30) return { score: 2, pending: false };
  if (minutes <= 40) return { score: 1, pending: false };
  return { score: 0, pending: false };
}

function scoreWalk(minutes, transitStatus, mode) {
  if (isBlank(mode) || isBlank(transitStatus)) {
    return { score: null, pending: true };
  }
  if (mode !== "步行") {
    return { score: null, pending: false, skip: true, note: "騎車或開車另列不計分" };
  }
  if (transitStatus !== "已通車" && transitStatus !== "已通車營運") {
    return {
      score: null,
      pending: false,
      skip: true,
      note: "規劃利多(未計分)",
      future: true
    };
  }
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0) {
    return { score: null, pending: true };
  }
  if (minutes <= 10) return { score: 2, pending: false };
  if (minutes <= 15) return { score: 1, pending: false };
  return { score: 0, pending: false };
}

function scoreUnitPrice(unit, area) {
  const alerts = [];
  if (unit === null) return { score: null, pending: true };
  const nSample = n(area?.comps_sample_n);
  const median = n(area?.comps_median_unit);
  if (nSample === null || nSample < 5 || median === null || median <= 0) {
    return { score: null, pending: true, reason: "可比成交不足或中位未填" };
  }
  const q1 = n(area?.comps_q1_unit);
  const q3 = n(area?.comps_q3_unit);
  if ((q1 !== null && q1 <= 0) || (q3 !== null && q3 <= 0) || (q1 !== null && q3 !== null && q3 < q1)) {
    return { score: null, pending: true, reason: "區域四分位單價不正確" };
  }
  if (q1 !== null && q3 !== null) {
    const iqr = q3 - q1;
    if (unit < q1 - iqr) alerts.push("明顯低於行情，請查核屋況或特殊瑕疵");
    if (unit <= q3) return { score: 2, pending: false, alerts };
    if (unit <= q3 + iqr) return { score: 1, pending: false, alerts };
    return { score: 0, pending: false, alerts };
  }
  if (unit < median * 0.8) alerts.push("明顯低於行情，請查核屋況或特殊瑕疵");
  if (unit <= median * 1.1) return { score: 2, pending: false, alerts };
  if (unit <= median * 1.2) return { score: 1, pending: false, alerts };
  return { score: 0, pending: false, alerts };
}

function scorePriceBand(total, pf02) {
  if (total === null || total === undefined || total <= 0) {
    return { score: null, pending: true };
  }
  if (
    !pf02
    || pf02.high === undefined
    || pf02.high === null
    || pf02.high <= 0
    || (pf02.low !== undefined && pf02.low !== null && (pf02.low <= 0 || pf02.low > pf02.high))
  ) {
    return { score: null, pending: true };
  }
  const alerts = [];
  if (pf02.low !== undefined && pf02.low !== null && total < pf02.low) {
    alerts.push("低於合理總價帶下緣，請查核屋況或流通性");
  }
  if (total <= pf02.high) return { score: 2, pending: false, alerts };
  const overPct = (total - pf02.high) / pf02.high;
  if (overPct < 0.1) return { score: 1, pending: false, alerts };
  return { score: 0, pending: false, alerts };
}

function scoreProduct(property, profile) {
  const rooms = n(property.rooms);
  const min = n(profile?.rooms_min);
  const pref = n(profile?.rooms_preferred);
  if (rooms === null || rooms < 0) return { score: null, pending: true };
  if (min !== null && rooms < min) return { score: 0, pending: false, vetoRooms: true };
  const types = splitList(profile?.product_type || "");
  const ptype = property.product_type;
  if (types.length && isBlank(ptype)) return { score: null, pending: true };
  const typeOk = !types.length || types.includes(ptype);
  if (!typeOk) return { score: 0, pending: false };
  if (pref !== null && rooms >= pref) return { score: 2, pending: false };
  if (min !== null && rooms >= min) return { score: 1, pending: false };
  return { score: 1, pending: false };
}

function scoreCashflow(holdYears, minYears) {
  if (holdYears === null || minYears === null) return { score: null, pending: true };
  if (holdYears < minYears) return { score: 0, pending: false, vetoCash: true };
  return { score: 2, pending: false };
}

export function isCurrentSchoolYearDate(isoDate, now = new Date()) {
  if (isBlank(isoDate) || !/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate))) return false;
  const [y, m, d] = String(isoDate).split("-").map((x) => parseNumericRaw(x).value);
  if (y == null || m == null || d == null) return false;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return false;
  const ref = now instanceof Date ? now : new Date(now);
  const refIso = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}-${String(ref.getDate()).padStart(2, "0")}`;
  if (String(isoDate) > refIso) return false;
  const academicStart = ref.getMonth() + 1 >= 8 ? ref.getFullYear() : ref.getFullYear() - 1;
  const year = n(isoDate.slice(0, 4));
  return year === academicStart || year === academicStart + 1;
}

/** Accept 西元 2026 or 民國 115. */
export function parseSchoolYear(raw, now = new Date()) {
  if (isBlank(raw)) return { ok: true, blank: true, western: null };
  const s = String(raw).trim().replace(/學年.*$/, "");
  const nYear = parseNumericRaw(s.replace(/[民國西元]/g, "")).state === "ok"
    ? parseNumericRaw(s.replace(/[民國西元]/g, "")).value
    : NaN;
  if (!Number.isFinite(nYear) || nYear <= 0) return { ok: false, blank: false, western: null };
  const western = nYear < 1912 ? nYear + 1911 : nYear;
  const ref = now instanceof Date ? now : new Date(now);
  const academicStart = ref.getMonth() + 1 >= 8 ? ref.getFullYear() : ref.getFullYear() - 1;
  const ok = western === academicStart || western === academicStart + 1 || western === ref.getFullYear();
  return { ok, blank: false, western };
}

function scoreLocation(property, profile) {
  if (isBlank(property.area_code)) {
    return { score: null, pending: true };
  }
  const targets = splitList(profile?.target_areas || "");
  const inTarget = !targets.length || targets.includes(property.area_code);
  const claimedRaw = property.school_zone_claimed;
  // 「有宣稱」＝非空且不是否
  const claimed = !isBlank(claimedRaw) && claimedRaw !== false && claimedRaw !== "否";
  const verified = isFlagOn(property.school_zone_verified);
  const verifyDate = property.school_zone_verified_date;
  const dateOk = isCurrentSchoolYearDate(verifyDate);
  const yearParsed = parseSchoolYear(property.school_zone_year);
  if (claimed && (!verified || isBlank(verifyDate) || !dateOk || (!yearParsed.blank && !yearParsed.ok))) {
    return {
      score: 1,
      pending: false,
      note: "學區未核實或未附當年度公告，地段不得記符合"
    };
  }
  if (inTarget) return { score: 2, pending: false };
  return { score: 1, pending: false };
}

/** 評分參數：空值或不合法都算無效，不再讓扣分歸零或門檻失效。 */
const PARAM_KEYS = [
  "w_screen",
  "w_condition",
  "w_price",
  "walk_multiplier",
  "premium_penalty_per_pct",
  "fake_price_penalty",
  "stretch_min_total",
  "stretch_min_price"
];

export function resolveScoringParams(scoring) {
  const sc = { ...DEFAULT_SCORING };
  let invalid = false;
  for (const k of PARAM_KEYS) {
    const raw = scoring?.[k];
    if (raw === undefined) continue; // 沒給用預設
    const r = normalizeValue("scoring", k, raw);
    if (r.state === "ok") sc[k] = r.value;
    else invalid = true;
  }
  sc.over_cap_action = scoring?.over_cap_action === "觀察" ? "觀察" : "淘汰";
  const about = scoring?.about_markup === undefined ? null : normalizeValue("scoring", "about_markup", scoring.about_markup);
  if (about && about.state === "ok") sc.about_markup = about.value;
  const sum = sc.w_screen + sc.w_condition + sc.w_price;
  if (Math.abs(sum - 1) > 0.001) invalid = true;
  return { sc, invalid };
}

/**
 * Price group 0-100. Linear premium, not integer percent.
 */
export function priceScore(property, area, scoring = DEFAULT_SCORING, fakeAlerts = 0) {
  const { sc, invalid } = resolveScoringParams(scoring);
  if (invalid) return { pending: true, score: null, reason: "評分設定有空白或不合法的值" };
  const nSample = n(area?.comps_sample_n);
  const median = n(area?.comps_median_unit);
  const nego = area?.nego_rate;
  const negoNum = isBlank(nego) && nego !== 0 ? null : n(nego);
  if (nSample === null || nSample < 5 || median === null || median <= 0) {
    return { pending: true, score: null, reason: "可比成交少於 5 筆或中位未填" };
  }
  if (negoNum !== null && (negoNum < 0 || negoNum > 0.3)) {
    return { pending: true, score: null, reason: "議價率超出合理範圍，價格組待核" };
  }
  const split = unitPriceAfterParking(property);
  if (split.pending) return { pending: true, score: null, reason: split.reason };
  const fake = Math.max(0, Number.isFinite(fakeAlerts) ? fakeAlerts : 0);
  if (negoNum === null) {
    const refPremium = (split.unit - median) / median;
    const ref = Math.max(0, 100 - refPremium * 100 * sc.premium_penalty_per_pct);
    return {
      pending: true,
      score: null,
      reason: "議價率未填，價格組待核",
      reference_if_nego_zero: round1(Math.min(100, ref)),
      note: "以議價率 0 試算的參考值"
    };
  }
  const premium = (split.unit - median * (1 + negoNum)) / median;
  let raw = 100 - premium * 100 * sc.premium_penalty_per_pct;
  if (premium <= 0) raw = 100;
  raw -= fake * sc.fake_price_penalty;
  const score = Math.max(0, raw);
  return { pending: false, score, premium, unit: split.unit };
}

function normalizeGroup(items) {
  let nume = 0;
  let deno = 0;
  let pendingWeight = 0;
  let totalWeight = 0;
  let scoredCount = 0;
  for (const it of items) {
    totalWeight += it.weight;
    if (it.skip) continue;
    if (it.pending || it.score === null || it.score === undefined) {
      pendingWeight += it.weight;
      continue;
    }
    nume += it.score * it.weight;
    deno += 2 * it.weight;
    scoredCount += 1;
  }
  if (pendingWeight > totalWeight / 2) {
    return { pending: true, score: null, scoredCount, pendingWeight, totalWeight };
  }
  if (deno === 0) return { pending: true, score: null, scoredCount, pendingWeight, totalWeight };
  return {
    pending: false,
    score: (nume / deno) * 100,
    scoredCount,
    pendingWeight,
    totalWeight,
    numerator: nume,
    denominator: deno
  };
}

/**
 * vetoEvidence：看房紀錄累積的否決證據 [{ kind, viewing_id, item_id, released }]。
 * 沒傳（直接呼叫的測試）時，退回用 screenAnswers 判斷現金流與看後決策。
 */
export function gateOne(property, profile, finance, scoring = DEFAULT_SCORING, condition = {}, screenAnswers = {}, vetoEvidence) {
  const hits = [];
  const deal = splitList(profile?.deal_breaker || "").filter((x) => x && x !== "無");
  const propFlags = property.deal_breaker_hits || [];
  for (const d of deal) {
    if (propFlags.includes(d) || property.flags?.includes(d)) hits.push(d);
  }
  const leakVal = condition.leak ?? property.condition?.leak;
  const leakSevere = leakVal === "嚴重" || leakVal === 0 || leakVal === "0";
  if (leakSevere && !hits.includes("嚴重漏水")) {
    hits.push("嚴重漏水");
  }
  const rooms = n(property.rooms);
  const min = n(profile?.rooms_min);
  if (min !== null && rooms !== null && rooms < min) hits.push("房數低於最少房數");

  const total = positiveOrNull(n(property.ask_total)); // 開價 0 視同沒填，不判延伸帶也不判超過上限
  const b01 = n(finance?.budget_cap_total);
  const b03 = n(finance?.search_range_high);
  const b12 = n(finance?.hold_years_min);
  const hold = n(property.hold_years);
  const capBlank = financeCapIsBlank(finance);

  let action = null;
  let priceBand = "區間內";
  let stretch = false;

  if (hits.length) action = ELIMINATE;
  if (min !== null && rooms !== null && rooms < min) action = ELIMINATE;

  if (capBlank) {
    if (total !== null) {
      priceBand = "上限待填";
      action = action || CAP_BLANK_MARK;
    }
  } else if (b01 !== null && total !== null) {
    if (total > b01) {
      priceBand = "超過上限";
      const e07 = scoring?.over_cap_action === "觀察" ? WATCH : ELIMINATE;
      action = action || e07;
      if (e07 === ELIMINATE) hits.push("總價超過上限");
    } else if (b03 !== null && total > b03 && total <= b01) {
      priceBand = STRETCH;
      stretch = true;
    }
  }

  if (hold !== null && b12 !== null && hold < b12) {
    hits.push("現金流撐不住");
    action = ELIMINATE;
  }
  if (Array.isArray(vetoEvidence)) {
    for (const e of vetoEvidence) {
      if (e.released) continue;
      if (!hits.includes(e.kind)) hits.push(e.kind);
      action = ELIMINATE;
    }
  } else {
    if (screenAnswers?.cashflow === "撐不住" && !hits.includes("現金流撐不住")) {
      hits.push("現金流撐不住");
      action = ELIMINATE;
    }
    if (screenAnswers?.decision === "淘汰") {
      if (!hits.includes("看後決定淘汰")) hits.push("看後決定淘汰");
      action = ELIMINATE;
    }
  }
  if (hits.length) action = ELIMINATE;

  return { hits, action, priceBand, stretch, capBlank };
}

function capScore(item, cap) {
  if (cap === null || cap === undefined) return item;
  if (item.score === null || item.score === undefined) return item;
  return { ...item, score: Math.min(item.score, cap), capped: item.score > cap };
}

function applyJudge(item, resolved) {
  if (!resolved) return item;
  if (resolved.pending) return { ...item, score: null, pending: true, source: "checklist" };
  const capped = capScore(item, resolved.cap);
  return resolved.value ? { ...capped, source: capped.source || "program", self_assessment: resolved.value } : capped;
}

export function scoreProperty(input) {
  const {
    property,
    area = {},
    profile = {},
    finance = {},
    scoring = DEFAULT_SCORING,
    condition = {},
    fakeAlerts = 0,
    weightsVersion = "default",
    screenAnswers = {},
    screenResolved = null,
    vetoEvidence
  } = input;
  const params = resolveScoringParams(scoring);
  const sc = params.sc;
  const fakeParsed = normalizeValue("properties", "fake_alerts", fakeAlerts);
  const safeFakeAlerts = fakeParsed.state === "ok" ? Math.max(0, fakeParsed.value) : 0;
  const weightsInvalid = params.invalid;
  const gate = gateOne(property, profile, finance, sc, condition, screenAnswers, vetoEvidence);
  const alerts = [];
  if (weightsInvalid) alerts.push("評分設定有空白或不合法的值");
  const split = unitPriceAfterParking(property);
  const walkMode = property.walk_mode;
  const sr = screenResolved;
  const commuteMin = sr?.commute ? (sr.commute.pending ? null : sr.commute.value) : n(property.commute_min ?? area.commute_min);
  const walkMin = sr?.walk ? (sr.walk.pending ? null : sr.walk.value) : n(property.walk_min ?? area.walk_min);
  const commute = { ...scoreCommute(commuteMin), source: sr?.commute?.source, conflict: sr?.commute?.conflict === true };
  const walk = {
    ...scoreWalk(walkMin, property.transit_status, walkMode),
    source: sr?.walk?.source,
    conflict: sr?.walk?.conflict === true
  };
  if (walk.future) alerts.push("規劃利多(未計分)");
  const unit = split.pending
    ? { score: null, pending: true, reason: split.reason }
    : scoreUnitPrice(split.unit, area);
  if (unit.alerts) alerts.push(...unit.alerts);
  const pf02 = profile.price_band_parsed
    || (profile.price_band && profile.price_band.high !== undefined ? profile.price_band : null)
    || parseBand(profile.price_band);
  const band = scorePriceBand(n(property.ask_total), pf02);
  if (band.alerts) alerts.push(...band.alerts);
  const product = applyJudge(scoreProduct(property, profile), sr?.product);
  const location = applyJudge(scoreLocation(property, profile), sr?.location);
  const cash = applyJudge(scoreCashflow(n(property.hold_years), n(finance.hold_years_min)), sr?.cashflow);
  let timing;
  if (sr?.timing) {
    timing = sr.timing.pending
      ? { score: null, pending: true, source: sr.timing.source }
      : { score: sr.timing.value, pending: false, source: sr.timing.source };
  } else {
    const timingNum = n(property.timing_score);
    const timingAllowed = timingNum === 0 || timingNum === 1 || timingNum === 2;
    timing = timingNum === null || !timingAllowed
      ? { score: null, pending: true, invalid: timingNum !== null && !timingAllowed }
      : { score: timingNum, pending: false };
  }

  if (sr) {
    for (const [k, c] of Object.entries(sr)) {
      if (c?.conflict) alerts.push(`清單與物件資料不一致：${SCREEN_LABELS[k] || k}`);
    }
    const askedUnit = n(sr.unit_price?.value);
    if (askedUnit !== null && split.unit !== null && split.unit !== undefined && Math.abs(askedUnit - split.unit) > Math.abs(split.unit) * 0.01) {
      alerts.push("清單填的單價與計算值不同，請核對");
    }
    const askedBand = n(sr.price_band?.value);
    const askTotal = n(property.ask_total);
    if (askedBand !== null && askTotal !== null && askedBand !== askTotal) {
      alerts.push("清單填的總價與物件開價不同，請核對");
    }
  }

  const screenItems = [
    { key: "location", weight: 1, ...location },
    { key: "commute", weight: 1, ...commute },
    { key: "walk", weight: sc.walk_multiplier, ...walk, skip: !!walk.skip },
    { key: "unit_price", weight: 1, ...unit },
    { key: "price_band", weight: 1, ...band },
    { key: "product", weight: 1, ...product },
    { key: "volume", weight: 1, skip: true, score: null, pending: false, recorded: property.volume },
    { key: "timing", weight: 1, ...timing },
    { key: "cashflow", weight: 1, ...cash }
  ];

  let screen = normalizeGroup(screenItems.filter((x) => !x.skip));
  const scoredScreen = screenItems.filter((x) => !x.skip && !x.pending && x.score !== null && x.score !== undefined).length;
  if (scoredScreen < 5) {
    screen = { ...screen, pending: true, score: null, reason: "已計分初篩項少於 5 項" };
  }

  const condItems = CONDITION_KEYS.map((k) => {
    const v = condition[k];
    const parsed = normalizeCondition(v);
    if (parsed.state !== "ok") {
      return { key: k, weight: 1, pending: true, score: null };
    }
    let score = parsed.score;
    if (k === "leak" && (parsed.value === "嚴重" || score === 0)) {
      alerts.push("漏水嚴重，建議專業驗屋");
      score = 0;
    }
    return { key: k, weight: 1, pending: false, score };
  });
  const conditionGroup = normalizeGroup(condItems);

  const price = priceScore(property, area, scoring, safeFakeAlerts);
  const nSample = n(area?.comps_sample_n);
  let priceGroup = price.pending
    ? { pending: true, score: null, reason: price.reason, reference_if_nego_zero: price.reference_if_nego_zero }
    : { pending: false, score: price.score };
  if (nSample !== null && nSample < 5) {
    priceGroup = { pending: true, score: null, reason: "可比成交少於 5 筆" };
  }

  const anyPending = weightsInvalid || screen.pending || conditionGroup.pending || priceGroup.pending;
  let totalUnrounded = anyPending
    ? null
    : sc.w_screen * screen.score + sc.w_condition * conditionGroup.score + sc.w_price * priceGroup.score;
  if (totalUnrounded !== null && totalUnrounded > 100) totalUnrounded = 100;
  const pendingCount =
    screenItems.filter((x) => !x.skip && x.pending).length +
    condItems.filter((x) => x.pending).length +
    (price.pending ? 1 : 0);

  if (safeFakeAlerts > 0 && isBlank(property.fake_price_alt)) {
    alerts.push("假價格警訊須填替代解釋");
  }
  const fakeNeedAlt = safeFakeAlerts > 0 && isBlank(property.fake_price_alt);

  let stretchCandidate = false;
  if (
    gate.action !== ELIMINATE &&
    !fakeNeedAlt &&
    gate.stretch &&
    !anyPending &&
    totalUnrounded !== null &&
    priceGroup.score !== null
  ) {
    stretchCandidate =
      totalUnrounded >= sc.stretch_min_total && priceGroup.score >= sc.stretch_min_price;
    if (priceGroup.pending) stretchCandidate = false;
  }

  let decision = gate.action;
  if (gate.action === ELIMINATE) {
    stretchCandidate = false;
    decision = ELIMINATE;
  } else if (!decision) {
    if (fakeNeedAlt) decision = "待核";
    else if (anyPending) decision = "待核";
    else if (gate.stretch) decision = stretchCandidate ? "延伸帶候選" : "不進候選";
    else decision = "候選";
  }
  // 看後決策選「觀察」：不排名也不進仲介清單
  const watchByAnswer = screenAnswers?.decision === "觀察" || sr?.decision?.value === "觀察";
  if (watchByAnswer && decision !== ELIMINATE && decision !== CAP_BLANK_MARK) {
    decision = WATCH;
    stretchCandidate = false;
  }

  return {
    veto_hits: gate.hits,
    action: gate.action,
    decision,
    price_band: gate.priceBand,
    stretch: gate.stretch,
    stretch_candidate: stretchCandidate,
    // 目前生效的延伸帶門檻跟著評分結果走，排名資格（rankEligible）才會和決策顯示用同一組數字（F-R11-03）
    stretch_min_total: sc.stretch_min_total,
    stretch_min_price: sc.stretch_min_price,
    screen: {
      ...screen,
      items: screenItems,
      display: screen.pending ? INSUFFICIENT : round1(screen.score)
    },
    condition: {
      ...conditionGroup,
      items: condItems,
      display: conditionGroup.pending ? INSUFFICIENT : round1(conditionGroup.score)
    },
    price: {
      ...priceGroup,
      display: priceGroup.pending ? INSUFFICIENT : round1(priceGroup.score),
      detail: price
    },
    total: totalUnrounded,
    total_display: anyPending ? INSUFFICIENT : round1(totalUnrounded),
    pending_count: pendingCount,
    alerts,
    weights_version: weightsVersion,
    weights: {
      w_screen: sc.w_screen,
      w_condition: sc.w_condition,
      w_price: sc.w_price
    },
    comparable: !anyPending && rankEligible({
      action: gate.action,
      decision,
      price_band: gate.priceBand,
      stale: false,
      stretch: gate.stretch,
      stretch_candidate: stretchCandidate,
      stretch_min_total: sc.stretch_min_total,
      stretch_min_price: sc.stretch_min_price,
      price: { score: priceGroup.score, pending: priceGroup.pending },
      screen: { pending: screen.pending },
      condition: { pending: conditionGroup.pending },
      any_pending: anyPending,
      cap_blank: decision === CAP_BLANK_MARK || gate.priceBand === "上限待填",
      fake_price_need_alt: fakeNeedAlt,
      total: totalUnrounded,
      watch_only: decision === WATCH,
      weights_invalid: weightsInvalid
    }), // 不進候選／待核不進排名
    watch_only: decision === WATCH,
    fake_price_need_alt: fakeNeedAlt,
    weights_invalid: weightsInvalid
  };
}

export function isStretchProperty(property, finance) {
  const total = positiveOrNull(n(property?.ask_total));
  const b01 = n(finance?.budget_cap_total);
  const b03 = n(finance?.search_range_high);
  if (total === null || b01 === null || b03 === null) return false;
  return total > b03 && total <= b01;
}

/** 同一物件（或同一次看房）最新的一筆評分：先濾掉被取代的，再依評分時間取最新，時間相同取陣列較後者。 */
export function latestScoreFor(scores, { propertyId, viewingId } = {}) {
  const live = (scores || []).filter((s) => s && typeof s === "object" && !s.superseded && (!propertyId || s.property_id === propertyId));
  const forViewing = viewingId ? live.filter((s) => s.viewing_id === viewingId || s.id === viewingId) : live;
  const pool = forViewing.length ? forViewing : live;
  let best = null;
  let bestIdx = -1;
  pool.forEach((s, i) => {
    const t = Date.parse(s.scored_at || 0) || 0;
    const bt = best ? Date.parse(best.scored_at || 0) || 0 : -1;
    if (!best || t > bt || (t === bt && i > bestIdx)) {
      best = s;
      bestIdx = i;
    }
  });
  return best;
}

/** 給仲介的清單：只放一般候選，延伸帶一律不放。 */
export function propertiesForAgentDraft(properties, finance, scores = []) {
  return (properties || []).filter((p) => {
    const sc = latestScoreFor(scores, { propertyId: p.id }) || (scores || []).find((s) => s && s.id === p.id);
    if (!agentListEligible(sc)) return false;
    // 第二道防線：以金額排除延伸帶
    if (isStretchProperty(p, finance)) return false;
    const total = n(p.ask_total);
    const b03 = n(finance?.search_range_high);
    if (total !== null && b03 !== null && total > b03) return false;
    return true;
  });
}

function parseBand(s) {
  if (!s) return null;
  if (typeof s === "object" && s.high !== undefined) return s;
  const m = String(s).match(/^\s*(\d+(?:\.\d+)?)\s*[-~～到至]\s*(\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const low = parseNumericRaw(m[1]);
  const high = parseNumericRaw(m[2]);
  if (low.state !== "ok" || high.state !== "ok" || low.value <= 0 || high.value <= 0 || low.value > high.value) return null;
  return { low: low.value, high: high.value };
}

/** 同一物件的所有看房，由舊到新（時間相同依陣列順序）。 */
export function orderedViewings(state, propertyId) {
  const list = (state?.viewings || [])
    .map((v, i) => ({ v, i }))
    .filter((x) => x.v && typeof x.v === "object" && x.v.property_id === propertyId);
  list.sort((a, b) => {
    const ta = Date.parse(a.v.recorded_at || a.v.start || 0) || 0;
    const tb = Date.parse(b.v.recorded_at || b.v.start || 0) || 0;
    if (ta !== tb) return ta - tb;
    return a.i - b.i;
  });
  return list.map((x) => x.v);
}

export function latestViewingFor(state, propertyId) {
  return orderedViewings(state, propertyId).at(-1) || null;
}

const SEVERITY = { 嚴重: 0, 輕微: 1, 無問題: 2, 看不出來: 3 };

function answerBlank(v) {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

/** 一次看房自己填的答案：屋況七類（同類多題取最嚴重）與看房前、看房後的初篩答案。 */
export function viewingAnswers(state, viewing) {
  const items = itemsForViewing(state, viewing);
  const responses = viewing?.responses || {};
  const cond = {};
  const condItem = {};
  const screen = {};
  const screenItem = {};
  for (const item of items) {
    let key = item.condition_key;
    if (!key && /漏水/.test(item.text || "")) key = "leak";
    const rec = responses[item.id];
    const val = rec?.value ?? rec?.status;
    if (key) {
      const label = normalizeCondition(val).value;
      if (label && (cond[key] === undefined || (SEVERITY[label] ?? 9) < (SEVERITY[cond[key]] ?? 9))) {
        cond[key] = label;
        condItem[key] = item.id;
      }
    }
    if (item.screen_key && !answerBlank(val)) {
      screen[item.screen_key] = val;
      screenItem[item.screen_key] = item.id;
    }
  }
  return { cond, condItem, screen, screenItem, items };
}

/**
 * 把同一物件所有看房依時間由舊到新走過：
 *  - 屋況七類：逐類取最新一筆有填的答案，再以物件欄位補沒有任何清單答案的類別
 *  - 初篩答案：逐題取最新一筆有填的
 *  - 否決證據：累積，不因後來的空白看房而消失；填了解除理由才解除
 */
export function mergedEvidenceFor(state, propertyId) {
  const property = (state?.properties || []).find((p) => p && p.id === propertyId) || {};
  const viewings = orderedViewings(state, propertyId);
  const condition = {};
  const screenAnswers = {};
  const veto = [];
  let unknown = false;
  let assumed = false;
  viewings.forEach((v, idx) => {
    const a = viewingAnswers(state, v);
    const isLatest = idx === viewings.length - 1;
    if (!a.items.length && (isLatest || Object.keys(v.responses || {}).length)) unknown = true;
    if (itemsAssumed(state, v)) assumed = true;
    for (const [k, label] of Object.entries(a.cond)) condition[k] = label;
    for (const [k, val] of Object.entries(a.screen)) screenAnswers[k] = val;
    const base = { viewing_id: v.id, index: idx, at: v.recorded_at || v.start || null };
    if (a.cond.leak === "嚴重") veto.push({ ...base, kind: "嚴重漏水", item_id: a.condItem.leak });
    if (a.screen.cashflow === "撐不住") veto.push({ ...base, kind: "現金流撐不住", item_id: a.screenItem.cashflow });
    if (a.screen.decision === "淘汰") veto.push({ ...base, kind: "看後決定淘汰", item_id: a.screenItem.decision });
  });
  const fallback = property.condition && typeof property.condition === "object" ? property.condition : {};
  for (const k of CONDITION_KEYS) {
    if (condition[k] === undefined && fallback[k] !== undefined && fallback[k] !== null) condition[k] = fallback[k];
  }
  const releases = (state?.vetoReleases || []).filter((r) => r && r.property_id === propertyId);
  const indexOf = new Map(viewings.map((v, i) => [v.id, i]));
  for (const e of veto) {
    e.released = releases.some((r) => r.kind === e.kind && (indexOf.get(r.released_viewing_id) ?? -1) > e.index);
  }
  return { viewings, latest: viewings.at(-1) || null, condition, screenAnswers, veto, unknown, assumed, releases };
}

/** 最新一次看房對這項否決的題目，是不是已經明確改答成非否決值（才能申請解除）。 */
export function latestAnswerClearsVeto(state, propertyId, kind) {
  const latest = latestViewingFor(state, propertyId);
  if (!latest) return false;
  const a = viewingAnswers(state, latest);
  if (kind === "嚴重漏水") return a.cond.leak === "無問題" || a.cond.leak === "輕微";
  if (kind === "現金流撐不住") return a.screen.cashflow === "可撐" || a.screen.cashflow === "勉強";
  if (kind === "看後決定淘汰") return ["觀察", "入圍", "進入談判"].includes(a.screen.decision);
  return false;
}

export function conditionFromResponses(viewing, methodPack, property, state) {
  const a = viewingAnswers(state || { methodPack }, viewing);
  if (Object.keys(a.cond).length) return a.cond;
  return property?.condition || {};
}

export function screenAnswersFromResponses(viewing, methodPack, state) {
  return viewingAnswers(state || { methodPack }, viewing).screen;
}

function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

function shortHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fp-${(h >>> 0).toString(16)}${text.length.toString(16)}`;
}

/**
 * 評分輸入指紋：由「實際影響評分的輸入」產生，改設定頁的備註之類不影響評分的欄位，指紋不變。
 * 物件：全部可編輯欄位加屋況快選、否決命中、旗標；區域：整列（去掉系統代號、名稱、錨點、基準日）；
 * 財務：只放上限、對外上緣、持有年數門檻；輪廓與評分設定整份；同一物件所有看房的回應與解除紀錄。
 */
export function scoreInputFingerprint({ property, viewing, viewings, finance, profile, scoring, methodPack, area, areas, releases }) {
  const areaRow = area || (areas || []).find((a) => a.area_code === property?.area_code) || {};
  const areaPart = { ...areaRow };
  for (const k of ["id", "area_label", "anchor", "data_as_of"]) delete areaPart[k];
  const propPart = { id: property?.id };
  for (const k of PROPERTY_EDIT_KEYS) propPart[k] = property?.[k];
  propPart.condition = property?.condition;
  propPart.deal_breaker_hits = property?.deal_breaker_hits;
  propPart.flags = property?.flags;
  const list = viewings && viewings.length ? viewings : viewing ? [viewing] : [];
  const fin = finance || {};
  const payload = {
    property: propPart,
    area: areaPart,
    finance: {
      budget_cap_total: fin.budget_cap_total ?? null,
      search_range_high: fin.search_range_high ?? null,
      hold_years_min: fin.hold_years_min ?? null
    },
    profile: profile || {},
    scoring: scoring || {},
    method: {
      id: methodPack?.meta?.id || methodPack?.id || null,
      version: methodPack?.meta?.version || methodPack?.version || null
    },
    responses: list.map((v) => ({ viewing_id: v?.id ?? null, responses: v?.responses || {}, pack_hash: v?.pack_hash || null })),
    releases: (releases || []).map((r) => ({ property_id: r.property_id, kind: r.kind, released_viewing_id: r.released_viewing_id }))
  };
  return shortHash(stableStringify(payload));
}

export function assessPropertyFromState(state, propertyId) {
  const property = (state.properties || []).find((p) => p && p.id === propertyId);
  if (!property) return { ok: false, error: "找不到物件" };
  const ev = mergedEvidenceFor(state, propertyId);
  const viewing = ev.latest;
  if (ev.unknown) {
    // 題庫版本找不到時，仍須執行已確認的否決檢查；若已確定淘汰，不能被蓋成待核（P10-07）
    const params = resolveScoringParams(state.scoring);
    const gate = gateOne(property, state.profile, state.finance, params.sc, ev.condition, ev.screenAnswers, ev.veto);
    if (gate.action === ELIMINATE) {
      return {
        ok: true,
        property_id: propertyId,
        viewing_id: viewing?.id,
        decision: ELIMINATE,
        action: ELIMINATE,
        veto_hits: gate.hits,
        comparable: false,
        stale: false,
        total: null,
        total_display: INSUFFICIENT,
        pending_count: 1,
        unknown_pack: true,
        alerts: ["當時的題目版本找不到，但已觸發硬淘汰"]
      };
    }
    return {
      ok: true,
      property_id: propertyId,
      viewing_id: viewing?.id,
      decision: PENDING,
      action: PENDING,
      comparable: false,
      stale: false,
      total: null,
      total_display: INSUFFICIENT,
      pending_count: 1,
      unknown_pack: true,
      alerts: ["當時的題目版本找不到，這間先待核"]
    };
  }
  const area = (state.areas || []).find((a) => a && a.area_code === property.area_code) || {};
  const resolved = resolveScreenInputs(property, area, ev.screenAnswers);
  const sc = scoreProperty({
    property,
    area,
    profile: state.profile,
    finance: state.finance,
    scoring: state.scoring,
    condition: ev.condition,
    fakeAlerts: property.fake_alerts || 0,
    weightsVersion: state.scoring?.version || "default",
    screenAnswers: ev.screenAnswers,
    screenResolved: Object.fromEntries(Object.entries(resolved.values).map(([k, v]) => [k, { ...v, key: k }])),
    vetoEvidence: ev.veto
  });
  if (ev.assumed) sc.alerts.push("這筆看房沒有記錄題目版本，以目前版本解讀");
  const fp = scoreInputFingerprint({
    property,
    viewing,
    viewings: ev.viewings,
    finance: state.finance,
    profile: state.profile,
    scoring: state.scoring,
    methodPack: state.methodPack,
    area,
    areas: state.areas,
    releases: ev.releases
  });
  const latestStored = latestScoreFor(state.scores, { propertyId, viewingId: viewing?.id });
  // 是否過期完全由指紋決定；沒有指紋的舊評分視為過期一次
  const stale = !!latestStored && latestStored.input_fingerprint !== fp;
  const decision = stale ? "待重評" : sc.decision;
  const rec = {
    ok: true,
    ...sc,
    property_id: propertyId,
    viewing_id: viewing?.id,
    input_fingerprint: fp,
    stale,
    decision,
    veto_evidence: ev.veto
  };
  rec.comparable = rankEligible(rec);
  return rec;
}

export function listingToProperty(listing, profile) {
  const rooms = n(listing.rooms ?? listing["LST-14"]);
  const rawId = listing.property_id || listing.code || listing["LST-01"] || listing.id;
  const prop = {
    id: rawId == null ? "" : String(rawId).trim(),
    area_code: listing.area_code,
    ask_total: n(listing.ask_total ?? listing["LST-03"]),
    ping_total: n(listing.ping_total),
    rooms,
    parking_included_in_ask: listing.parking_included_in_ask,
    parking_price_ask: listing.parking_price_ask,
    parking_ping: listing.parking_ping,
    has_parking: listing.has_parking,
    product_type: listing.product_type,
    age: listing.age,
    docs: listing.docs
  };
  const min = n(profile?.rooms_min);
  let eliminated = false;
  if (min !== null && rooms !== null && rooms < min) eliminated = true;
  return { property: prop, eliminated };
}

export function priceDropToCapReminder(property, finance) {
  const total = positiveOrNull(n(property?.ask_total));
  const prev = positiveOrNull(n(property?.prev_ask_total));
  const b01 = n(finance?.budget_cap_total);
  if (total === null || prev === null || b01 === null) return null;
  if (prev > b01 && total <= b01) return "開價已降到上限內，可再提醒";
  return null;
}

export { SCREEN_KEYS, parseBand };
