/**
 * Viewing count: one property counts as 一間 only when pre/on-site/post
 * core items meet thresholds. Second visits, listing-only, exterior-only do not count.
 */
import { parseTimeRange, parseNumericRaw, isFlagOn } from "./fields.js";

export const PRE_CORE_N = 11;
export const ONSITE_CORE_N = 21;
export const POST_CORE_N = 6;

const NON_COUNT_REASONS = {
  residence: "目前住處不算",
  exterior: "只看外觀不算",
  photos_only: "只看網路照片不算",
  listing_only: "只看屋單不算",
  revisit: "同一物件第二次看另開複看，不算一間"
};

export function coreItems(methodPack, phase) {
  const raw = methodPack && Array.isArray(methodPack.checklist) ? methodPack.checklist : [];
  const list = raw.filter((i) => i && i.phase === phase && i.core === true);
  return list;
}

function responseValue(resp) {
  if (!resp) return { filled: false, pending: false };
  const status = resp.status;
  const raw = status === undefined || status === null || status === "" ? resp.value : status;
  if (raw === undefined || raw === null) return { filled: false, pending: false };
  const v = typeof raw === "string" ? raw.trim() : raw;
  if (v === "") return { filled: false, pending: false };
  if (v === "待核" || v === "UNKNOWN" || v === "看不出來") return { filled: true, pending: true };
  if (v === "不適用" || String(v).startsWith("不適用")) return { filled: true, pending: false, na: true };
  return { filled: true, pending: false };
}

/**
 * @param {object} viewing
 * @param {object} property
 * @param {object} methodPack
 */
export function countViewing(viewing, property, methodPack) {
  if (viewing?.kind === "複看" || isFlagOn(viewing?.revisit)) {
    return { counts: false, reason: NON_COUNT_REASONS.revisit };
  }
  if (viewing?.kind === "目前住處" || isFlagOn(property?.is_current_residence)) {
    return { counts: false, reason: NON_COUNT_REASONS.residence };
  }
  if (viewing?.kind === "只看外觀") return { counts: false, reason: NON_COUNT_REASONS.exterior };
  if (viewing?.kind === "只看網路照片") return { counts: false, reason: NON_COUNT_REASONS.photos_only };
  if (viewing?.kind === "只看屋單") return { counts: false, reason: NON_COUNT_REASONS.listing_only };

  const packForCount =
    viewing?.core_snapshot?.length
      ? { checklist: viewing.core_snapshot.map((i) => ({ ...i, core: i.core !== false })) }
      : methodPack;
  const pre = coreItems(packForCount, "看房前");
  const onsite = coreItems(packForCount, "現場");
  const post = coreItems(packForCount, "看房後");
  const responses = viewing?.responses || {};

  const preEval = pre.map((item) => ({ id: item.id, ...responseValue(responses[item.id]) }));
  const preFilled = preEval.filter((x) => x.filled).length;
  const prePending = preEval.filter((x) => x.pending).length;
  const preOk = preFilled === pre.length && prePending <= 3;

  const askVal = property?.ask_total;
  const pingVal = property?.ping_total;
  const askParsed = parseNumericRaw(askVal);
  const pingParsed = parseNumericRaw(pingVal);
  const askNum = askParsed.state === "ok" ? askParsed.value : null;
  const pingNum = pingParsed.state === "ok" ? pingParsed.value : null;
  const askMissing = askVal === undefined || askVal === null || askVal === "" || askNum == null || askNum <= 0;
  const pingMissing = pingVal === undefined || pingVal === null || pingVal === "" || pingNum == null || pingNum <= 0;
  const areaCode = String(property?.area_code || "").trim();
  const askPending = isFlagOn(property?.ask_pending) || responses.ask_total?.status === "待核" || askMissing || String(askVal).includes("待核") || String(askVal) === "UNKNOWN";
  const pingPending = isFlagOn(property?.ping_pending) || responses.ping_total?.status === "待核" || pingMissing || String(pingVal).includes("待核") || String(pingVal) === "UNKNOWN";
  const areaPending = isFlagOn(property?.area_pending) || !areaCode || areaCode === "待核" || areaCode === "UNKNOWN";
  if (askPending || pingPending || areaPending) {
    return {
      counts: false,
      reason: "開價、坪數或區域代號待核，不計入一間",
      prePending,
      onsiteDone: 0,
      postDone: 0
    };
  }
  if (prePending > 3 || preFilled < pre.length) {
    return {
      counts: false,
      reason: "看房前必做未齊或待核超過 3 項",
      prePending,
      preFilled,
      preNeed: pre.length,
      onsiteDone: 0,
      postDone: 0
    };
  }

  const onEval = onsite.map((item) => ({ id: item.id, ...responseValue(responses[item.id]) }));
  const onNa = onEval.filter((x) => x.na).length;
  const onDone = onEval.filter((x) => x.filled && !x.pending && !x.na).length;
  const onOk = onDone >= 19 && onNa <= 2;

  const postEval = post.map((item) => ({ id: item.id, ...responseValue(responses[item.id]) }));
  const postDone = postEval.filter((x) => x.filled && !x.pending).length;
  const postOk = postDone === post.length && isFlagOn(viewing?.post_saved);

  const counts = preOk && onOk && postOk;
  return {
    counts,
    preOk,
    onOk,
    postOk,
    prePending,
    preFilled,
    onsiteDone: onDone,
    onsiteNa: onNa,
    onsiteNeed: 19,
    postDone,
    postNeed: post.length,
    reason: counts
      ? null
      : !onOk
        ? onNa > 2
          ? `現場「不適用」${onNa} 項超過上限 2`
          : `現場必做完成 ${onDone}/${onsite.length}，少於 19 不計入`
        : "看房後必做未存檔或仍有待核"
  };
}

export function uniqueCounted(viewings, properties, methodPack) {
  const seen = new Set();
  let n = 0;
  const details = [];
  const ids = new Set(); // 真正計入的看房代號（同一間物件只算第一次）
  for (const v of viewings || []) {
    const prop = (properties || []).find((p) => p.id === v.property_id) || {};
    const r = countViewing(v, prop, methodPack);
    details.push({ id: v.id, ...r });
    if (r.counts && !seen.has(v.property_id)) {
      seen.add(v.property_id);
      ids.add(v.id);
      n += 1;
    }
  }
  return { count: n, details, ids };
}

/** Same-day 3 properties: 3.5-hour plan needs commute between them ≤ 15 min. */
export function sameDaySoftWarning(viewings, { halfDayHours = 4, maxGapMin = 15 } = {}) {
  const byDay = new Map();
  for (const v of viewings || []) {
    const day = (v.start || v.date || "").slice(0, 10);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(v);
  }
  const hits = [];
  for (const [day, list] of byDay) {
    if (list.length < 3) continue;
    if (halfDayHours === 3.5) {
      const gaps = [];
      const sorted = [...list].sort((a, b) => String(a.start).localeCompare(String(b.start)));
      for (let i = 1; i < sorted.length; i++) {
        const prevEnd = sorted[i - 1].end || sorted[i - 1].start;
        const curStart = sorted[i].start;
        if (prevEnd && curStart) {
          const gap = (new Date(curStart) - new Date(prevEnd)) / 60000;
          if (Number.isFinite(gap)) gaps.push(gap);
        }
      }
      if (gaps.some((g) => g > maxGapMin)) {
        hits.push({ warn: true, day, message: "半天 3.5 小時同日 3 間須交通順路（間隔不超過 15 分）" });
        continue;
      }
    }
    hits.push({ warn: true, day, message: `同日已排 ${list.length} 間，請確認交通順路` });
  }
  if (!hits.length) return { warn: false, days: [] };
  return { warn: true, day: hits[0].day, days: hits, message: hits.map((h) => h.message).join("；") };
}

/** W3 flags on-site core < 19 that were wrongly counted. */
export function w3OnsiteAudit(viewings, methodPack, properties = []) {
  const flags = [];
  const list = Array.isArray(properties) ? properties : [];
  for (const v of viewings || []) {
    if (v.kind === "複看" || v.kind === "只看外觀" || v.kind === "只看屋單" || v.kind === "只看網路照片" || v.kind === "目前住處" || isFlagOn(v.revisit) || isFlagOn(list.find((p) => p.id === v.property_id)?.is_current_residence)) {
      continue;
    }
    if (v.start || v.end) {
      const tr = parseTimeRange(v.start, v.end);
      if (tr.state === "invalid") {
        flags.push({ id: v.id, unknown: true, message: "時間無法解析，待核" });
        continue;
      }
    }
    const prop =
      v.property ||
      list.find((p) => p.id === v.property_id) ||
      {};
    const r = countViewing(v, prop, methodPack);
    let onsiteDone = r.onsiteDone ?? 0;
    if (onsiteDone === 0 && v.responses) {
      const packForCount =
        v?.core_snapshot?.length
          ? { checklist: v.core_snapshot.map((i) => ({ ...i, core: i.core !== false })) }
          : methodPack;
      const onsite = coreItems(packForCount, "現場");
      const responses = v.responses || {};
      onsiteDone = onsite.filter((item) => {
        const ev = responseValue(responses[item.id]);
        return ev.filled && !ev.pending && !ev.na;
      }).length;
    }
    if (onsiteDone < 19) {
      flags.push({
        id: v.id,
        onsiteDone,
        message: "現場必做少於 19/21",
        wronglyCounted: !!r.counts
      });
    }
  }
  return flags;
}
