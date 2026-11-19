import { HARD_GATES_ALWAYS, HARD_GATE_STRETCH, HARD_GATE_CAP_BLANK, REMINDER_GATES } from "./defaults.js";
import { splitList } from "./lists.js";
import { toFiniteNumber, isFlagOn } from "./fields.js";

export function activeHardGates({ capBlank = false, askingStretch = false } = {}) {
  const g = [...HARD_GATES_ALWAYS];
  // 是否類旗標一律用 isFlagOn（只認 true 與「是」），字串「否」不會被當成真（F-R11-08）
  if (isFlagOn(askingStretch)) g.push(HARD_GATE_STRETCH);
  if (isFlagOn(capBlank)) g.push(HARD_GATE_CAP_BLANK);
  return g;
}

export function canStartAgencyVisit(checked, ctx = {}) {
  const need = activeHardGates(ctx);
  const set = checked instanceof Set ? checked : new Set(checked || []);
  const missing = need.filter((id) => !set.has(id));
  return { ok: missing.length === 0, missing, reminders: REMINDER_GATES };
}

function nameOrEmpty(settings) {
  return (settings?.call_name || "").trim();
}

export function openingScript(settings, finance, areaLabel, { aboutPhrase } = {}) {
  const a01 = nameOrEmpty(settings);
  const hi = a01 ? `您好，我姓${a01}，` : "您好，";
  const area = areaLabel || "這一帶";
  const b02 = finance?.search_range_low;
  const b03 = finance?.search_range_high;
  const b03Ok = b03 !== undefined && b03 !== null && b03 !== "";
  let price;
  if (!b03Ok) {
    price = "總價範圍待核";
  } else if (b02 !== undefined && b02 !== null && b02 !== "") {
    price = `總價大概看 ${b02} 到 ${b03} 萬`;
  } else if (aboutPhrase === "上下") {
    price = `總價大概 ${b03} 萬上下`;
  } else {
    price = `總價希望控制在 ${b03} 萬以內`;
  }
  return `${hi}最近在看${area}附近自住的房子，${price}。今天想先請你介紹一下這區，再看看目前有哪些屋單；條件對的話，我們再約時間帶看。`;
}

export function checkAboutPhrase(finance, scoring) {
  const blank = (v) => v === undefined || v === null || v === "";
  if (blank(finance?.budget_cap_total) || blank(finance?.search_range_high)) {
    return { ok: false, warn: true, message: "上限待填，無法檢查「上下」句型" };
  }
  const b01 = toFiniteNumber(finance?.budget_cap_total);
  const b03 = toFiniteNumber(finance?.search_range_high);
  if (finance?.search_ratio_max === undefined || finance?.search_ratio_max === null || finance?.search_ratio_max === "") {
    return { ok: false, warn: true, message: "搜尋比例待核，無法檢查「上下」句型" };
  }
  const b04 = toFiniteNumber(finance.search_ratio_max);
  const e11 = toFiniteNumber(scoring?.about_markup ?? 1.15) ?? 1.15;
  if (!Number.isFinite(b01) || !Number.isFinite(b03) || !Number.isFinite(b04) || b01 <= 0) {
    return { ok: false, warn: true, message: "上限待填，無法檢查「上下」句型" };
  }
  if (b03 * e11 > b01 * b04 + 1e-9) {
    return { ok: false, warn: true, message: "選上下句型時，預估仲介推案可能超過建議搜尋比例" };
  }
  return { ok: true, warn: false };
}

function fill(template, vars) {
  let missing = false;
  const text = String(template).replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    if (v === undefined || v === null || v === "") {
      missing = true;
      return "資料待核";
    }
    return String(v);
  });
  return missing ? "資料待核" : text;
}

function budgetRangeText(finance) {
  const b02 = finance?.search_range_low;
  const b03 = finance?.search_range_high;
  if (b03 === undefined || b03 === null || b03 === "") return "資料待核";
  if (b02 !== undefined && b02 !== null && b02 !== "") {
    return fill("我目前看的總價大概在 {b02} 到 {b03} 萬", { b02, b03 });
  }
  return fill("我總價希望控制在 {b03} 萬以內", { b03 });
}

export function answerAQ(id, settings, finance, { hasViewings = false, loanSelfAssess = false, hasOffer = false } = {}) {
  const a01 = nameOrEmpty(settings) || "";
  const a02 = settings?.partner_label || "家人";
  const range = budgetRangeText(finance);
  const map = {
    "AQ-01": a01
      ? `我姓${a01}。今天我自己來（或：和${a02}一起）。`
      : `今天我自己來（或：和${a02}一起）。`,
    "AQ-02": "在公司上班。",
    "AQ-03": settings?.purpose === "出租" ? "出租" : settings?.purpose === "自住兼出租" ? "自住兼出租" : "自住",
    "AQ-04": isFlagOn(hasViewings)
      ? "有在看，條件整理好了，每週都會排一個半天看房。"
      : "剛整理好條件，這週開始每週排半天實地看房。",
    "AQ-05": isFlagOn(loanSelfAssess) ? `${range}；貸款我會自己先去銀行評估。` : range,
    "AQ-06": isFlagOn(hasOffer) ? "有談過，細節我自己記。" : "還沒，條件對才會出。"
  };
  return map[id] || "";
}

export function scriptText(id, settings, finance, extra = {}) {
  const a02 = settings?.partner_label || "家人";
  const b02 = finance?.search_range_low;
  const b03 = finance?.search_range_high;
  const area = extra.area || "這一帶";
  const layout = extra.layout || "格局";
  const rangeAsk = (b03 === undefined || b03 === null || b03 === "")
    ? "資料待核"
    : (b02 !== undefined && b02 !== null && b02 !== ""
      ? fill("我看的總價在 {b02} 到 {b03} 萬，請依{area}、{layout}幫我篩屋單。", { b02, b03, area, layout })
      : fill("我總價希望控制在 {b03} 萬以內，請依{area}、{layout}幫我篩屋單。", { b03, area, layout }));
  const slots = extra.selectedSlots || "時段未選";
  const map = {
    "SCRIPT-SERIOUS": "我條件已經整理好，每週都會排一個半天看房，條件對才會出價，不對寧願多看。",
    "SCRIPT-BUDGET": rangeAsk,
    "SCRIPT-SEE-TODAY": isFlagOn(extra.prepared)
      ? "可以，請先給我屋單，我先對一下成交資料再出發。"
      : `今天先看屋單，條件合適再約帶看，我這週可以的時段是 ${slots}。`,
    "SCRIPT-OFFER-NOW": `條款我要帶回去看完，也要跟${a02}確認，今天先不簽、不付訂。請先給我書面條件。`,
    "SCRIPT-OTHER-BID": "請給我可以核實的書面條件，我對完資料再決定。",
    "SCRIPT-THINK": `這幾點我還要對資料：${extra.list || "（清單）"}。請先給我屋單或書面條件，也請再幫我找符合${extra.conditions || "條件"}的案子。`,
    "SCRIPT-SIGN-VIEWING-A": "我先看一下內容，簽完拍一張給我留存，可以嗎？",
    "SCRIPT-SIGN-VIEWING-B": "這份有服務費條款，我先拍照帶回去看，今天先看房可以嗎？",
    "SCRIPT-SIGN-VIEWING-C": `條款我要帶回去看完，也要跟${a02}確認，今天先不簽、不付訂。請先給我書面條件。`
  };
  return map[id] || "";
}

export function stretchInquiryDraft() {
  return "想請你提供這間的屋單與物件資料，面積拆分、屋齡、樓層、管理費與車位是否含在開價。不談總價、也不調整搜尋範圍。";
}

/**
 * 共同決策人草稿的時間點，選單用，鍵與選項文字一一對應（F9-11）。
 * 簽帶看確認書前有三種：signOk 一定是沒有費用條款版、signFee 一定是有費用條款版，
 * sign 則依這次訪視勾選的三個條款自動選。
 */
export const PARTNER_STAGES = [
  { key: "before", label: "出門前" },
  { key: "arrived", label: "到了" },
  { key: "during", label: "過程中" },
  { key: "pressured", label: "對方催書面" },
  { key: "hard", label: "節奏過硬" },
  { key: "sign", label: "簽帶看確認書前（依這次訪視勾選的條款自動選）" },
  { key: "signOk", label: "簽帶看確認書前（沒有費用條款）" },
  { key: "signFee", label: "簽帶看確認書前（有費用條款）" }
];

export const PARTNER_BLANK = "＿＿";

/**
 * 服務費、私下成交、排除他店三個條款的勾選值（F-R11-08）：
 * 「有」或旗標的 true、「是」算有；「無」或 false、「否」算沒有；空白與其他任何字都不算。
 */
function clauseYes(c) {
  return c === "有" || isFlagOn(c);
}
function clauseNo(c) {
  return c === "無" || c === false || c === "否";
}

/**
 * 占位符沒有值時用全形底線「＿＿」留白讓使用者自己填，不輸出「門店」「稍後」這類假內容；
 * 回傳的 needsFill 是每個時間點「還有沒有空格」。
 */
export const SIGN_NEEDS_CLAUSES_TEXT = "請先在門市頁勾選這份文件有沒有服務費、私下成交、排除他店條款";

/**
 * clauses 是這次訪視的三個條款勾選值 [服務費條款, 私下成交仍須付費條款, 排除他店條款]：
 * sign（簽帶看確認書前，沒指定哪一種）依它自動選。任一為「有」用有條款版；三個都明確為「無」用沒有條款版；
 * 有任何一個沒填就回提示文字，needsFill.sign 為真，不可複製（F9-11）。
 */
export function partnerDrafts({ branch, time, nListings, nView, askRange, clauses } = {}) {
  const pick = (v) => (v === undefined || v === null || String(v).trim() === "" ? PARTNER_BLANK : String(v));
  const count = (v) => (Number.isFinite(v) ? String(v) : PARTNER_BLANK);
  const texts = {
    before: `今天要去${pick(branch)}看屋單／帶看，預計${pick(time)}回來。我們說好的上限只留在我們之間。若要動到書面出價，我會先打電話跟你確認。`,
    arrived: `我到${pick(branch)}了，先看屋單，有需要再傳照片。`,
    during: `目前看了${count(nListings)}間屋單／現場${count(nView)}間，開價大概${pick(askRange)}。還沒有出價。`,
    pressured: "仲介希望今天談書面條件，我還沒答應。我先打電話跟你確認。",
    hard: "對方節奏很硬，我先結束，回家對完資料再決定。",
    signOk: "仲介請我簽今天的帶看確認書，我核對過只列今天看的物件、沒有服務費與排除他店條款，照片先傳給你留存。",
    signFee: "這份有服務費（或排除他店）條款，我先拍照回家看，今天不簽。"
  };
  const list = Array.isArray(clauses) ? clauses : [];
  const yes = clauseYes;
  const no = clauseNo;
  let sign = SIGN_NEEDS_CLAUSES_TEXT;
  let signPending = true;
  if (list.some(yes)) {
    sign = texts.signFee;
    signPending = false;
  } else if (list.length === 3 && list.every(no)) {
    sign = texts.signOk;
    signPending = false;
  }
  const all = { ...texts, sign };
  const needsFill = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.includes(PARTNER_BLANK)]));
  needsFill.sign = signPending;
  return { ...all, needsFill };
}

export function agentDraft({ list = "", conditions = "", slots = "時段未選" } = {}) {
  return `謝謝今天說明。我先記下這幾間：${list || "（清單）"}。請再幫我看有沒有符合${conditions || "條件"}的案子。我這週${slots}可以帶看，一次希望能看同一區的好幾間。書面資料再請你傳給我。`;
}

export function agencyStoreId(brand, branch) {
  // 全形轉半形、去空白、轉小寫、去掉結尾的「分店」「門市」「店」字樣，「站前店」與「站前」才會算同一家
  const n = (s) => String(s ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "").replace(/(分店|門市|店)$/u, "");
  return `ag-${n(brand)}|${n(branch)}`;
}

export function transferAgent(slots, agents, { agentId, oldSlotId, newSlotId, newBranch }) {
  const target = String(newSlotId || "").trim().toUpperCase();
  if (!target || !/^G[123]-[123]$/.test(target)) {
    return { ok: false, error: "新格位不合法", slots, agents };
  }
  newSlotId = target;
  if (String(oldSlotId || "").toUpperCase() === target) {
    return { ok: false, error: "不得同格空轉", slots, agents };
  }
  const occupied = (agents || []).some((a) => String(a.slot_id || "").toUpperCase() === target && a.id !== agentId && a.status !== "人已離店");
  if (occupied) return { ok: false, error: "目標格位已有在職仲介", slots, agents };
  if (!newSlotId || !/^[Gg][123]-[123]$/.test(String(newSlotId).trim())) {
    return { ok: false, error: "新格位不合法", slots, agents };
  }
  const nextSlots = (slots || []).map((s) => {
    if (s.id === oldSlotId || s.slot_id === oldSlotId) {
      return { ...s, status: "人已離店", agent_id: null, previous_agent_id: agentId };
    }
    if (newSlotId && (s.id === newSlotId || s.slot_id === newSlotId)) {
      return { ...s, agent_id: agentId, status: "未排", branch_label: newBranch || s.branch_label };
    }
    return s;
  });
  const nextAgents = (agents || []).map((a) => {
    if (a.id === agentId) {
      return { ...a, slot_id: newSlotId, branch_label: newBranch || a.branch_label, moved_from: oldSlotId };
    }
    return a;
  });
  return { ok: true, slots: nextSlots, agents: nextAgents };
}

export function vis14Score(flags) {
  const keys = ["flex", "docs", "promise", "no_pressure", "local_knowledge"];
  let n = 0;
  const detail = {};
  for (const k of keys) {
    const v = isFlagOn(flags?.[k]) ? 1 : 0;
    detail[k] = v;
    n += v;
  }
  return { score: n, detail };
}

export function vis17RedFlag(vis) {
  const signed = vis?.signed && vis.signed !== "無";
  const clauses = [vis?.fee_clause, vis?.private_deal_fee, vis?.exclude_other];
  const anyYes = clauses.some(clauseYes);
  return { red: !!(signed && anyYes), signed, anyYes };
}

export function listingDocsRedFlag(listing) {
  const v = listing?.docs_now || listing?.["LST-13"];
  return v === "不給";
}

export const QUESTIONS = {
  G1: [
    { id: "G1-Q1", text: "這一帶主要街道怎麼走？哪些路段比較貴、哪些比較親民？" },
    { id: "G1-Q2", text: "這一帶有哪些社區？各社區大概什麼總價帶、什麼產品？" },
    { id: "G1-Q3", text: "賣方委託費怎麼算？一般委託和專任委託差在哪？" },
    { id: "G1-Q4", text: "最近成交大概落在哪？有沒有可以對照的成交例子？" },
    { id: "G1-Q5", text: "買方服務費你們一般收多少？什麼時候收？寫在哪份文件？（答案待自行核實）" }
  ],
  G2: [
    { id: "G2-Q1", text: "你們跟別家相比，優勢在哪裡？" },
    { id: "G2-Q2", text: "帶看怎麼安排？同一時段能不能連看同社區或附近好幾間？" },
    { id: "G2-Q3", text: "物件通常怎麼宣傳？會怎麼通知我？" },
    { id: "G2-Q4", text: "客源從哪來？這一帶什麼總價帶比較多人問？" },
    { id: "G2-Q5", text: "剛才說的優勢或成交量，可以給我可核對的資料嗎？" }
  ],
  G3: [
    { id: "G3-Q1", text: "（大型連鎖）產權、面積、用途你們怎麼交核？會給我哪些書面？" },
    { id: "G3-Q2", text: "（在地）這一帶你最熟的是哪幾個社區？為什麼？" },
    { id: "G3-Q3", text: "同一物件多家在賣，你們和別家差在哪？文件會比較齊嗎？" },
    { id: "G3-Q4", text: "證照確認：可當面請看經紀營業員證明，或回家用主管機關公開查詢（查詢方式待核）。" }
  ]
};

export const DEFAULT_UNVERIFIED = "仲介主張，未驗證";

export function isSubstantiveAnswer(v) {
  const s = String(v ?? "").trim();
  if (!s) return false;
  if (s === DEFAULT_UNVERIFIED) return false;
  if (s === "仲介主張,未驗證") return false;
  if (s === "待核" || /^unknown$/i.test(s)) return false;
  return true;
}

/** 交核結果的固定選項（F9-10）：只有前兩個算完成，另兩個是「還沒做完」。 */
export const CROSS_CHECK_OPTIONS = ["相符", "有出入", "尚未查證", "請對方給資料"];

/** 只有「相符」或「有出入」（去空白後）才算已交核；其他一律不算，包含布林 true（它不說明結果）與自由輸入的字。 */
export function isCrossCheckDone(v) {
  if (typeof v !== "string") return false;
  const s = v.trim();
  return s === "相符" || s === "有出入";
}

/** 證照確認：「是」或「改用公開查詢」都算已確認（舊資料的 true 也算）。 */
export function licenseConfirmed(v) {
  if (isFlagOn(v)) return true;
  if (typeof v !== "string") return false;
  const s = v.trim();
  return s === "是" || s === "改用公開查詢";
}

export function groupComplete(group, checks = {}) {
  if (checks.answers) {
    const qs = QUESTIONS[group] || [];
    if (!qs.length) return false;
    const allAnswered = qs.every((q) => isSubstantiveAnswer(checks.answers[q.id]));
    if (group === "G1") return isFlagOn(checks.entered) && allAnswered;
    if (group === "G2") return isFlagOn(checks.entered) && allAnswered && isCrossCheckDone(checks.cross_check);
    if (group === "G3") return allAnswered && licenseConfirmed(checks.license);
    return allAnswered;
  }
  if (group === "G1") {
    return isFlagOn(checks.entered) && isFlagOn(checks.streets) && isFlagOn(checks.fees);
  }
  if (group === "G2") {
    return isFlagOn(checks.entered) && isFlagOn(checks.four_q) && isFlagOn(checks.cross_check);
  }
  if (group === "G3") {
    return isFlagOn(checks.chain_local_marked) && isFlagOn(checks.cross_or_local) && licenseConfirmed(checks.license);
  }
  return false;
}

/**
 * 一筆訪視用現行規則算出「這一組是否完成」。沒有格位、或格位格式不對就不算任何一組完成。
 * 存訪視與載入舊資料重算時共用（F9-10）。
 */
export function visitGroupComplete(visit) {
  const sid = String(visit?.slot_id || "").trim().toUpperCase();
  if (!/^G[1-3]-[1-3]$/.test(sid)) return false;
  return groupComplete(sid.slice(0, 2), {
    entered: true,
    answers: visit.answers,
    license: licenseConfirmed(visit.license_ok),
    chain_local_marked: visit.chain_or_local === "大型連鎖" || visit.chain_or_local === "在地",
    cross_check: visit.cross_check
  });
}

/**
 * 主要合作的格位代號集合。格位表是正本；仲介表標了主要合作而格位表沒有的也一併算進來，
 * 這樣匯入表填的與 App 內選的都算在同一個上限（3 位）裡。
 */
export function mainPartnerSlotIds(slots = [], agents = []) {
  const ids = new Set();
  for (const s of slots || []) {
    if (s?.status === "列為主要合作") ids.add(String(s.slot_id || s.id || "").trim().toUpperCase());
  }
  for (const a of agents || []) {
    if (a?.status === "列為主要合作" && a.slot_id) ids.add(String(a.slot_id).trim().toUpperCase());
  }
  ids.delete("");
  return ids;
}

export function mainPartnersOk(slots, agents = []) {
  const ids = [...mainPartnerSlotIds(slots, agents)];
  const mains = ids.map((slot_id) => ({ slot_id, id: slot_id }));
  if (ids.length > 3) return { ok: false, message: "主要合作最多 3 位", mains };
  return { ok: true, needConfirmG1: ids.some((id) => id.startsWith("G1")), mains };
}
