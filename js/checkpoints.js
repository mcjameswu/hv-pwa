/**
 * Ten-week checkpoint thresholds (supplement 1.5).
 * All thresholds use unconditional rounding up of 60% / 85%.
 */
import { parseTimeRange, parseEvidence, isFlagOn, toFiniteNumber } from "./fields.js";
import { splitList } from "./lists.js";
import { agencyStoreId } from "./module333.js";

export function plannedCumulative(halfHours, week) {
  const w1w2 = halfHours >= 4 ? 3 : 3;
  const rest = halfHours >= 4 ? 5 : 4;
  if (week <= 0) return 0;
  if (week === 1) return w1w2;
  if (week === 2) return w1w2 * 2;
  return w1w2 * 2 + rest * (week - 2);
}

export function thresholdBand(planned) {
  const pass = Math.ceil(planned * 0.85);
  const fail = Math.ceil(planned * 0.6);
  return {
    planned,
    pass,
    conditionalFrom: fail,
    conditionalTo: pass - 1,
    failBelow: fail
  };
}

export function judgeCount(actual, planned) {
  if (!Number.isInteger(actual) || actual < 0) {
    return { result: "待核", reason: "實際間數無效", actual, planned };
  }
  const b = thresholdBand(planned);
  if (actual >= b.pass) return { result: "通過", ...b };
  if (actual >= b.failBelow) return { result: "附條件", ...b };
  return { result: "否決", ...b };
}

export function w3Judge(actual, halfHours = 4) {
  const planned = halfHours >= 4 ? 11 : 10;
  return judgeCount(actual, planned);
}

export function w6Judge(actual, halfHours = 4) {
  const planned = halfHours >= 4 ? 26 : 22;
  return judgeCount(actual, planned);
}

export function w10Judge(actual, commit, { gapDocumented = false } = {}) {
  if (commit == null || !Number.isFinite(commit) || commit <= 0) {
    return { result: "待核", reason: "承諾看房間數未填", actual, commit: null };
  }
  if (!Number.isInteger(actual) || actual < 0) {
    return { result: "待核", reason: "實際間數無效", actual, commit };
  }
  const conditional = Math.ceil(commit * 0.8);
  const fail = Math.ceil(commit * 0.6);
  if (actual >= commit) return { result: "通過", commit, conditional, fail };
  if (actual >= conditional && isFlagOn(gapDocumented)) {
    return { result: "通過", commit, conditional, fail, byGapNote: true };
  }
  if (actual >= fail) return { result: "附條件", commit, conditional, fail };
  return { result: "否決", commit, conditional, fail };
}

export function evidenceNumber(v) {
  const r = parseEvidence(v);
  return r.state === "ok" ? r.value : null;
}

export function uniqueAgencyCount(visits) {
  const keys = new Set();
  for (const v of visits || []) {
    // 去重鍵是「品牌加門店」：不同品牌的同名門店算兩家，同一家店寫法稍不同算一家；品牌與門店都空白不計入
    const key = agencyStoreId(v?.brand, v?.branch_label);
    if (key !== "ag-|") keys.add(key);
  }
  return keys.size;
}

function flagOn(v) {
  return isFlagOn(v);
}

/**
 * Paper makeup: does not trigger 事後補寫 veto at W3 when timestamped photos exist
 * and W0 plan-start was incomplete.
 */
/**
 * 「事後補寫」否決。紙本補登要「真的有對得到的照片」（makeupPhotoExists 由呼叫端查媒體表）而且在 24 小時內才不否決；
 * 不再讀可以被任意寫入的 has_timestamped_photo 旗標。非紙本補登，記錄時間比發生時間晚超過 24 小時就否決。
 */
export function retroWriteVeto({ paperMakeup, makeupPhotoExists, recordedAt, occurredAt }) {
  const rec = recordedAt ? new Date(recordedAt).getTime() : NaN;
  const occ = occurredAt ? new Date(occurredAt).getTime() : NaN;
  const gap = rec - occ;
  if (paperMakeup) {
    if (makeupPhotoExists !== true) return true;
    if (!(Number.isFinite(gap) && gap >= 0 && gap <= 24 * 3600 * 1000)) return true;
    return false;
  }
  return Number.isFinite(gap) && gap > 24 * 3600 * 1000;
}

export function adoptedHalfDayHours(settings) {
  const v = toFiniteNumber(settings?.half_day_hours);
  if (v === 3.5 || v === 4) return v;
  return null;
}

const W0_EVIDENCE = {
  httpsLive: "https 或本機",
  capFilled: "上限已由本人手打",
  methodPackLoaded: "方法包已載入",
  imported: "匯入表已匯入",
  offlineVerified: "離線實測通過",
  selfEnteredCap: "上限為本人輸入",
  partnerConsent: "共同決策人已同意節奏",
  commuteMeasured: "已實測單程分鐘",
  agenciesSelected: "第一組三家已選並查營業時間",
  slotPlanned: "下週看房半天已用時段規則決定"
};

export function w0PlanStartAllowed({
  httpsLive = false,
  capFilled = false,
  methodPackLoaded = false,
  imported = false,
  offlineVerified = false,
  selfEnteredCap = false,
  partnerConsent = false,
  commuteMeasured = false,
  agenciesSelected = false,
  slotPlanned = false
} = {}) {
  // 接收端只認布林真值 true：逼呼叫端先把「否」「待核」這類字串轉成真正的布林值
  const flags = {
    httpsLive: httpsLive === true,
    capFilled: capFilled === true,
    methodPackLoaded: methodPackLoaded === true,
    imported: imported === true,
    offlineVerified: offlineVerified === true,
    selfEnteredCap: selfEnteredCap === true,
    partnerConsent: partnerConsent === true,
    commuteMeasured: commuteMeasured === true,
    agenciesSelected: agenciesSelected === true,
    slotPlanned: slotPlanned === true
  };
  const missing = Object.entries(flags).filter(([, v]) => !v).map(([k]) => W0_EVIDENCE[k] || k);
  const ok = missing.length === 0;
  return { ok, pending: !ok, missing, flags };
}

function worseResult(countResult, overlay) {
  const rank = { 否決: 3, 待核: 2, 附條件: 1, 通過: 0 };
  const overlayRank = rank[overlay] ?? 0;
  const countRank = rank[countResult] ?? 0;
  if (overlay === "否決" || overlayRank >= countRank) return overlay;
  return countResult;
}

export function rowsHaveStartEnd(rows) {
  if (!Array.isArray(rows) || !rows.length) return false;
  return rows.every((r) => {
    if (!r || !r.start || !r.end) return false;
    return parseTimeRange(r.start, r.end).state === "ok";
  });
}

export function w3FullJudge(actual, halfHours, extra = {}) {
  if (halfHours !== 3.5 && halfHours !== 4) {
    return { result: "待核", reason: "尚未採用半天長度（3.5 或 4 小時）", actual };
  }
  const count = w3Judge(actual, halfHours);
  if (isFlagOn(extra.retroWrite)) {
    return { ...count, result: worseResult(count.result, "否決"), reason: "事後補寫" };
  }
  if (isFlagOn(extra.onsiteShort)) {
    return { ...count, result: worseResult(count.result, "否決"), reason: "現場必做少於 19" };
  }
  const missing = [];
  const agencies = toFiniteNumber(extra.agenciesVisited);
  if (!(agencies >= 9)) missing.push("九家門市未走完");
  if (!isFlagOn(extra.minutesMeasured)) missing.push("每間／每家分鐘未量到");
  if (!isFlagOn(extra.profileReady)) missing.push("第一版理想輪廓未完成");
  const weeks = evidenceNumber(extra.remainingWeeksEstimate);
  if (weeks === null || weeks < 0) missing.push("剩七週推估未填");
  const goal = evidenceNumber(extra.goalCommitChoice);
  if (goal !== 45 && goal !== 50) missing.push("尚未決定 45 或 50");
  const blankRatio = evidenceNumber(extra.courseBBlankRatio);
  if (blankRatio === null || blankRatio < 0 || blankRatio > 1) missing.push("課程 B 空白比例未填");
  else if (blankRatio > 0.3) missing.push("課程 B 空白加 UNKNOWN 超過 30%");
  const partners = extra.mainPartnersCount;
  if (!(partners >= 1 && partners <= 3)) missing.push("主要合作須選定 1 到 3 位");
  if (missing.length) {
    return { ...count, result: worseResult(count.result, "待核"), missing };
  }
  return count;
}

export function w6FullJudge(actual, halfHours, extra = {}) {
  if (halfHours !== 3.5 && halfHours !== 4) {
    return { result: "待核", reason: "尚未採用半天長度（3.5 或 4 小時）", actual };
  }
  const count = w6Judge(actual, halfHours);
  if (isFlagOn(extra.retroWrite)) {
    return { ...count, result: worseResult(count.result, "否決"), reason: "事後補寫" };
  }
  const missing = [];
  if (!isFlagOn(extra.weightsVersioned)) {
    return { ...count, result: worseResult(count.result, "否決"), reason: "權重改了沒留版本" };
  }
  if (isFlagOn(extra.overtimeUnconsented)) {
    return { ...count, result: worseResult(count.result, "否決"), reason: "加碼超過工時上限未經同意" };
  }
  if (!isFlagOn(extra.s1Complete)) missing.push("安全里程碑 S1 未完成");
  if (!isFlagOn(extra.s2Complete)) missing.push("安全里程碑 S2 未完成");
  const drafts = evidenceNumber(extra.courseBDrafts);
  if (drafts === null || drafts < 7) {
    missing.push("課程 B 十張表初稿不足 7 張");
  }
  if (!isFlagOn(extra.w3GoalRechecked)) missing.push("W3 的 45 或 50 決定未複核");
  if (missing.length) {
    return { ...count, result: worseResult(count.result, "待核"), missing };
  }
  return count;
}

export function w10FullJudge(actual, commit, extra = {}) {
  if (commit == null || !Number.isFinite(commit)) {
    return { result: "待核", reason: "承諾看房間數未填", actual, commit: null };
  }
  const count = w10Judge(actual, commit, { gapDocumented: extra.gapDocumented });
  // 規格的兩個否決條件：把待核寫成通過、出現非本人做的出價申貸付款紀錄（只能靠本人聲明）。
  // 已經觸發的否決聲明要排在「間數待核」之前判斷，否則間數資料一有問題就會把否決蓋掉（F9-19 第 1 點）
  if (flagOn(extra.unknownAsPass)) return { ...count, result: "否決", reason: "把待核寫成通過" };
  if (flagOn(extra.nonSelfAction)) return { ...count, result: "否決", reason: "出現非本人做的出價、申貸或付款紀錄" };
  if (count.result === "待核") return count;
  const missing = [];
  const declared = (v) => v === true || v === "是" || v === false || v === "否";
  if (!declared(extra.unknownAsPass) || !declared(extra.nonSelfAction)) missing.push("請確認兩項聲明（待核寫成通過、非本人的出價申貸付款紀錄）");
  if (!flagOn(extra.sopV2)) missing.push("個人看房 SOP v2 未完成");
  if (!flagOn(extra.profileFinal)) missing.push("理想輪廓未定稿");
  if (!flagOn(extra.courseBComplete)) missing.push("課程 B 盤點表未補完");
  if (!flagOn(extra.combatSelfAssess)) missing.push("實戰課準備度自評未填");
  if (!flagOn(extra.s3Complete)) missing.push("安全里程碑 S3 未完成");
  if (missing.length) {
    return { ...count, result: worseResult(count.result, "待核"), missing };
  }
  if (flagOn(extra.courseBCoreUnknown)) {
    return { ...count, result: worseResult(count.result, "附條件"), reason: "課程 B 核心欄位仍有 UNKNOWN" };
  }
  return count;
}

export function checkpointLabel(judge, { currentWeek = 0, targetWeek, actual = 0 } = {}) {
  if (currentWeek < targetWeek) {
    return {
      ...judge,
      result: "尚未到檢查週",
      label: `尚未到第 ${targetWeek} 週（目前第 ${currentWeek} 週，已計入 ${actual} 間）`,
      tooEarly: true
    };
  }
  return { ...judge, label: judge.result, tooEarly: false };
}

/** countedIds：已計入看房的代號集合；只加總集合內、而且時間有效的看房。沒傳時沿用舊的 counts 旗標。 */
export function minutesSplit(viewings, visits, countedIds) {
  const idSet = countedIds ? new Set(countedIds) : null;
  let viewMins = 0;
  let nView = 0;
  for (const v of viewings || []) {
    const counted = idSet ? idSet.has(v.id) : v.counts === true || v.counted === true;
    if (!counted) continue;
    const r = parseTimeRange(v.start, v.end);
    if (r.state === "ok") {
      viewMins += r.minutes;
      nView += 1;
    }
  }
  let visitMins = 0;
  let nVisit = 0;
  for (const v of visits || []) {
    const r = parseTimeRange(v.start, v.end);
    if (r.state === "ok") {
      visitMins += r.minutes;
      nVisit += 1;
    }
  }
  return {
    viewing_total_min: viewMins,
    visit_total_min: visitMins,
    per_viewing: nView ? viewMins / nView : null,
    per_visit: nVisit ? visitMins / nVisit : null
  };
}

/** 輪廓是否就緒：目標區域與不能接受的條件，各自切開後至少要有一個非空項目（只有逗號不算）。 */
export function profileIsReady(profile) {
  return splitList(profile?.target_areas).length > 0 && splitList(profile?.deal_breaker).length > 0;
}
