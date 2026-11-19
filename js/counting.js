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

/** 一題回應的狀態：有沒有填、是不是待核、是不是不適用（匯出到筆記也用它算功課完成度）。 */
export function responseValue(resp) {
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
 * 同一題多間的答案，嚴重的排在前面，取最嚴重的那一間。
 * 第 15 輪 F-R15-01：「異常」和「有問題」同級（方法包可能用這個字）。
 */
const WORST_ORDER = ["嚴重", "有問題", "異常", "否", "不符合", "撐不住", "輕微", "部分符合", "勉強", "待核", "待查", "看不出來", "無問題", "正常", "符合", "是", "已查", "可撐"];

/** 沒寫選項的勾選、拍照、錄音題，畫面預設的四個大按鈕（sites.js 與這裡共用同一份）。 */
export const DEFAULT_OPTIONS = ["是", "否", "不適用", "待核"];

/**
 * 第 15 輪 F-R15-01：這一題是不是「選擇題」，是的話回傳它允許的選項清單；文字題與數字題回 null。
 * 白話：選擇題的答案只能是按鈕上那幾個字；文字題與數字題本來就是自由填寫（量測數字、備註），
 * 不能因為「看不懂」就當成待核，否則這類題目會永遠沒完成。
 */
export function choiceOptionsOf(item) {
  if (!item) return null;
  if (Array.isArray(item.options) && item.options.length) return item.options;
  if (!item.input_type || ["check", "photo", "voice"].includes(item.input_type)) return DEFAULT_OPTIONS;
  return null;
}

/**
 * 一題在好幾間（房間、浴室）各答一次之後，整題的答案：
 * 有任何一間沒答就整題算沒答；全部答了，取最嚴重的那一間；全部都標不適用，整題就是不適用。
 * 第 15 輪 F-R15-01：第二個參數 item（題目定義，至少要有 options 與 input_type）可省略；
 * 有給而且是選擇題時，「不在嚴重程度表、也不在這題選項清單裡」的答案算「看不懂」，那一間當成待核參與取最嚴重，
 * 全部都看不懂時整題是待核並保留原字串（raw_value），絕不回「是」。文字題與數字題維持原行為：有填就算答了，值用分號串起來。
 */
export function aggregateInstanceAnswers(recs, item) {
  if (!recs.length || recs.some((r) => !responseValue(r).filled)) return null;
  const real = recs.filter((r) => !responseValue(r).na);
  if (!real.length) return { status: "不適用", value: "不適用", reason: String(recs.find((r) => r.reason)?.reason || "") };
  // 第 16 輪 F-R16-48：取每一間的答案和 responseValue 一致，value 去掉空白後是空的就改看 status；純空白不算答案
  const values = real.map((r) => {
    const own = typeof r.value === "string" ? r.value.trim() : r.value;
    const v = own === undefined || own === null || own === "" ? r.status : own;
    return String(v ?? "").trim();
  });
  const choices = choiceOptionsOf(item);
  // 第 16 輪 F-R16-48：只有選擇題才用嚴重程度排序；有給題目定義而且不是選擇題（文字題、數字題）一律用分號串接，
  // 避免某一間文字剛好寫「正常」就把另一間的文字丟掉。沒給題目定義（舊呼叫）維持原本的排序行為。
  if (item && !choices) {
    const texts = values.filter((v) => v !== "" && v !== "待核");
    if (!texts.length) return { status: "待核", value: "待核" };
    return { status: "是", value: texts.join("；") };
  }
  const isUnknown = (v) => Boolean(choices) && v !== "" && !WORST_ORDER.includes(v) && !choices.includes(v);
  const unknownValues = values.filter(isUnknown);
  let best = null;
  let bestRank = Infinity;
  for (const v of values) {
    const rank = isUnknown(v) ? WORST_ORDER.indexOf("待核") : WORST_ORDER.indexOf(v);
    if (rank >= 0 && rank < bestRank) {
      best = isUnknown(v) ? "待核" : v;
      bestRank = rank;
    }
  }
  if (best === null) {
    const joined = values.filter((v) => v && v !== "待核").join("；");
    return { status: joined ? "是" : "待核", value: joined || "待核" };
  }
  if (best === "待核" && unknownValues.length) {
    // 看不懂的答案佔了最嚴重的位置：整題待核，保留看不懂的原字串，之後才查得到
    return { status: "待核", value: "待核", raw_value: unknownValues.join("；") };
  }
  const worstRec = real.find((r, i) => values[i] === best);
  return { status: best, value: best, ...(worstRec?.note ? { note: worstRec.note } : {}) };
}

/**
 * 第 14 輪 F-R14-01：一題拿來「計分與一票否決」的證據答案。
 * 白話：完成度和證據分開看。完成度要每一間都答完才算（那是 responses[題目代號] 那一格）；
 * 證據只要任何一間已經有答案，就取已答各間裡最嚴重的那一個，其他間有沒有答都不影響，
 * 所以新增一間沒答的浴室、改站名、換順序，都不會讓已經知道的嚴重答案消失。
 * 沒有任何一間答過時，回到原本整題那一格（舊版或進階現場頁寫的整題答案）。
 */
export function evidenceRecord(responses, itemId, item) {
  const bag = responses || {};
  const prefix = `${itemId}@`;
  const answeredHere = Object.keys(bag)
    .filter((k) => k.startsWith(prefix))
    .map((k) => bag[k])
    .filter((r) => responseValue(r).filled);
  if (!answeredHere.length) return bag[itemId];
  const whole = bag[itemId];
  // 第 16 輪 F-R16-41：整題那一格如果是 recomputeAggregates 算出來的彙整（有 aggregated 標記），就不要再把它餵回去一起算，
  // 否則「有；無」這種彙整字串會被當成看不懂而變待核。只有舊版或進階現場頁直接寫的整題答案才一起算。
  const all = responseValue(whole).filled && !(whole && whole.aggregated === true) ? [...answeredHere, whole] : answeredHere;
  return aggregateInstanceAnswers(all, item) || bag[itemId];
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
