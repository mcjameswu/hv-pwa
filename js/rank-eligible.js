/**
 * Allowlists for ranking and for the agent list.
 * 可排名允許清單：一般候選，或已通過延伸帶門檻的延伸帶候選，而且一定要有有限的總分。
 * 仲介清單更嚴：只放一般候選，不放延伸帶。
 * 延伸帶門檻（E09 最低總分、E10 最低價格分）一律讀「目前生效的設定值」，沒有寫死下限（F-R11-03）：
 * 白話：使用者依規格走完 7 天冷靜期把 E09 從 75 調成 70 之後，評分結果說「延伸帶候選」，
 * 排名資格也要跟著放行，兩邊不能各說各話；只有呼叫端完全沒傳門檻時才退回出貨預設。
 */
import { DEFAULT_SCORING } from "./defaults.js";

const ELIMINATE = "淘汰";
const WATCH = "觀察";
const STRETCH_CANDIDATE = "延伸帶候選";
const CANDIDATE = "候選";
const PENDING = "待核";
const CAP_BLANK = "上限待填，不進候選";

/** 有傳入有限數字的門檻就用它（目前生效的設定值），沒傳才用出貨預設。 */
function effectiveMin(value, shipped) {
  return typeof value === "number" && Number.isFinite(value) ? value : shipped;
}

/** 可以進比較頁排名。 */
export function rankEligible(sc) {
  if (!sc || sc.ok === false || sc.stale || sc.unknown_pack || sc.weights_invalid) return false;
  if (typeof sc.total !== "number" || !Number.isFinite(sc.total)) return false;
  if (sc.action === ELIMINATE || sc.decision === ELIMINATE) return false;
  if (sc.action === WATCH || sc.decision === WATCH || sc.watch_only) return false;
  if (
    sc.any_pending === true ||
    (typeof sc.pending_count === "number" && sc.pending_count > 0) ||
    sc.decision === PENDING ||
    sc.action === PENDING ||
    sc.screen?.pending === true ||
    sc.condition?.pending === true ||
    sc.price?.pending === true
  ) {
    return false;
  }
  if (sc.cap_blank === true || sc.action === CAP_BLANK || sc.decision === CAP_BLANK || sc.price_band === "上限待填") {
    return false;
  }
  if (sc.fake_price_need_alt === true) return false;
  if (sc.decision === CANDIDATE) {
    return sc.stretch !== true && sc.stretch_candidate !== true;
  }
  if (sc.decision === STRETCH_CANDIDATE) {
    if (sc.stretch !== true || sc.stretch_candidate !== true) return false;
    const minTotal = effectiveMin(sc.stretch_min_total, DEFAULT_SCORING.stretch_min_total);
    const minPrice = effectiveMin(sc.stretch_min_price, DEFAULT_SCORING.stretch_min_price);
    if (sc.total < minTotal) return false;
    if (typeof sc.price?.score !== "number" || !Number.isFinite(sc.price.score) || sc.price.score < minPrice) {
      return false;
    }
    return true;
  }
  return false;
}

/** 可以進給仲介的清單：一般候選才行，延伸帶物件不放。 */
export function agentListEligible(sc) {
  return rankEligible(sc) && sc.decision === CANDIDATE && sc.stretch !== true && sc.stretch_candidate !== true;
}
