/**
 * Pure UI helpers extracted so screen rules can be tested without a browser.
 * 畫面判斷抽成純函式：核取方塊、表單數字、分數列顯示。
 */
import { isFlagOn, parseNumericRaw, parseNumberByKind } from "./fields.js";
import { SCREEN_LABELS, SELF_FIT_LABEL } from "./defaults.js";
import { splitList } from "./lists.js";
import { rankEligible } from "./rank-eligible.js";
import { suggestSlots } from "./slots.js";
import { DEFAULT_UNVERIFIED, CROSS_CHECK_OPTIONS, licenseConfirmed } from "./module333.js";

export function checkboxChecked(v) {
  return isFlagOn(v);
}

/**
 * 表單的一格數字。kind 是這格的單位種類（F9-05）："plain" 純數字（預設，不接受任何單位字）、
 * "wan" 萬元金額（收「1500萬」）、"yuan" 元金額（收「1萬」「3千」）。
 */
export function parseFormNumber(raw, kind = "plain") {
  const s = raw == null ? "" : String(raw);
  const r = parseNumberByKind(kind, s);
  if (r.state === "invalid") {
    const unitProblem = r.reason === "unit" || r.reason === "range";
    return { ok: false, state: "invalid", error: unitProblem ? `${r.error}，已保留原值` : "數字格式錯誤，已保留原值", invalid: true, reason: r.reason };
  }
  if (r.state === "blank") return { ok: true, state: "blank", value: null };
  return { ok: true, state: "ok", value: r.value };
}

/** 輸入框旁的即時提示：寫了單位字（例如「1萬」）時顯示解析後的值，例如「= 10000 元」；解析不了且是單位問題時顯示原因。 */
export function numberHint(raw, kind = "plain") {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const r = parseNumberByKind(kind, s);
  if (r.state === "invalid") return r.reason === "unit" || r.reason === "range" ? r.error : "";
  if (r.state !== "ok") return "";
  if (String(r.value) === s.replace(/,/g, "")) return "";
  const unit = kind === "yuan" ? " 元" : kind === "wan" ? " 萬" : "";
  return `= ${r.value}${unit}`;
}

export function scoreLineText(live) {
  if (!live || live.ok === false) return "尚未評分";
  if (live.stale) return "待重評";
  if (live.any_pending) return "資料不足";
  if (live.total_display !== undefined && live.total_display !== null) {
    const trimmed = String(live.total_display).trim();
    if (trimmed) return trimmed;
  }
  if (typeof live.total === "number" && Number.isFinite(live.total)) return String(Math.round(live.total * 10) / 10);
  return "資料不足";
}

const SOURCE_LABELS = { property: "物件欄位", checklist: "看房清單", area: "區域預設", conflict: "清單與物件不一致" };

/** 物件頁評分明細：每一項的資料來源（物件欄位、清單、區域預設）與衝突提示。 */
export function scoreBreakdownText(sc) {
  const items = sc?.screen?.items;
  if (!Array.isArray(items)) return "";
  return items
    .filter((i) => i.source && i.source !== "none")
    .map((i) => {
      const label = SCREEN_LABELS[i.key] || i.key;
      const value = i.pending ? "待核" : `${i.score} 分`;
      return `${label}：${value}（${SOURCE_LABELS[i.source] || i.source}）${i.conflict ? "　與物件資料衝突" : ""}`;
    })
    .join("；");
}

/** 解析「AA01:25,AA02:20」這種各區分鐘字串。 */
function minutesByArea(text) {
  const out = {};
  for (const part of splitList(text || "")) {
    const m = String(part).trim().match(/^([A-Z]{2}\d{2})\s*[:：]\s*(\d+)$/);
    if (m) out[m[1]] = parseNumericRaw(m[2]).value;
  }
  return out;
}

/**
 * 自住適配（使用者本人的通勤，F9-21）：G 分頁（常用地點通勤表）每一列，到這個物件所在區的去程與回程分鐘。
 * 只是另欄參考：不計入九項初篩分數，也不取代或覆蓋初篩第 2 項「到強勢辦公區」。
 * 回傳 [{ n, mode, outMin, backMin, asOf }]，分鐘查不到時是 null；不回地點代稱（那是私密字），只用「常用地點 N」。
 */
export function selfFitRows(travel, areaCode) {
  const code = String(areaCode || "").trim();
  return (Array.isArray(travel) ? travel : [])
    .filter((t) => t && typeof t === "object")
    .map((t, i) => {
      const out = minutesByArea(t.minutes_to_area);
      const back = minutesByArea(t.minutes_back);
      const outMin = code && out[code] !== undefined ? out[code] : null;
      const backMin = code && back[code] !== undefined ? back[code] : outMin;
      return { n: i + 1, mode: t.mode || "", outMin, backMin, asOf: t.as_of || "" };
    });
}

/** 「自住適配」欄的文字。short 為真時省略說明，給比較頁的一行用。 */
export function selfFitText(travel, areaCode, { short = false } = {}) {
  const rows = selfFitRows(travel, areaCode);
  if (!rows.length) return short ? `${SELF_FIT_LABEL} 未填` : `${SELF_FIT_LABEL}：尚未填常用地點通勤表（另列參考，不計分）`;
  const parts = rows.map((r) =>
    r.outMin === null ? `常用地點 ${r.n} 待核` : `常用地點 ${r.n}${r.mode ? `（${r.mode}）` : ""} 去 ${r.outMin} 分、回 ${r.backMin} 分`
  );
  return short ? `${SELF_FIT_LABEL} ${parts.join("；")}` : `${SELF_FIT_LABEL}：${parts.join("；")}（另列參考，不計入九項初篩分數）`;
}

/** 物件頁：這間物件的「自住適配」欄。 */
export function propertySelfFitLine(state, property) {
  return selfFitText(state?.travel, property?.area_code);
}

/** 比較頁：排名那一列的文字（總分、價格，加上另欄的自住適配）。 */
export function compareRankedText(state, live) {
  const p = (state?.properties || []).find((x) => x && x.id === live?.property_id);
  return `${live?.property_id}　總分 ${live?.total_display}　價格 ${live?.price?.display ?? ""}　${selfFitText(state?.travel, p?.area_code, { short: true })}`;
}

export function comparableForView(live) {
  return rankEligible(live);
}

/**
 * 表單數字一律走這裡。fields：{ 欄位鍵: 輸入框原文 }，labels：{ 欄位鍵: 畫面上的白話名稱 }，
 * kinds：{ 欄位鍵: "plain" | "wan" | "yuan" }（沒列的欄位一律是純數字，寫了單位字會被擋）。
 * 回傳 { ok, patch, errors }：任何一格不合法就 ok 為 false，呼叫端整次不存；
 * 空白變 null（清空），0 是合法值，不會被當成沒填。
 */
export function collectNumericForm(fields, labels = {}, kinds = {}) {
  const patch = {};
  const errors = [];
  for (const [key, raw] of Object.entries(fields || {})) {
    const r = parseFormNumber(raw, kinds?.[key] || "plain");
    if (r.state === "invalid") {
      errors.push({ field: key, message: r.reason ? `${labels[key] || key}：${r.error}` : `${labels[key] || key} 不是數字，已保留原值` });
    } else patch[key] = r.state === "blank" ? null : r.value;
  }
  return { ok: errors.length === 0, patch, errors };
}

const SETTINGS_NUMBER_LABELS = {
  goal_commit: "目標間數",
  half_day_hours: "已採用半天長度",
  commute_measured_min: "實測單程分鐘",
  course_b_drafts: "課程 B 十張表初稿張數",
  overtime_hours_used: "本週已用工時",
  remaining_weeks_estimate: "剩七週推估",
  goal_commit_choice: "45 或 50 最終決定",
  course_b_blank_ratio: "課程 B 空白比例"
};

const yesNo = (checked) => (checked ? "是" : "否");

/**
 * 設定頁把輸入框原文組成設定補丁（純函式，方便測試）。
 * 回傳 { ok, patch: { settings }, errors }。數字欄 0 是合法值；共同決策人的日期與方式必須一起填。
 */
export function settingsPatchFromForm(v = {}) {
  const numberFields = {
    half_day_hours: v.halfDay,
    commute_measured_min: v.commuteMeasured,
    course_b_drafts: v.courseBDrafts,
    overtime_hours_used: v.overtimeHours,
    remaining_weeks_estimate: v.remainingWeeks,
    goal_commit_choice: v.goalCommitChoice,
    course_b_blank_ratio: v.courseBBlank
  };
  // 目標間數（第 12 輪起設定頁直接顯示）：呼叫端沒傳就不動它，傳了空白才是清空
  if (v.goalCommit !== undefined) numberFields.goal_commit = v.goalCommit;
  const nums = collectNumericForm(numberFields, SETTINGS_NUMBER_LABELS);
  const errors = [...nums.errors];
  const at = String(v.partnerConsentAt ?? "").trim();
  const how = String(v.partnerConsentHow ?? "").trim();
  if ((at && !how) || (!at && how)) {
    errors.push({ field: "partner_consent", message: "共同決策人同意：日期與方式都要填" });
  }
  const settings = {
    online_transcribe: v.sttAllow,
    program_start: v.progStart || undefined,
    ...nums.patch,
    offline_verified: v.offlineVerified === true,
    partner_consent_at: at,
    partner_consent_how: how,
    agencies_selected: v.agenciesSelected === true,
    slot_planned: v.slotPlanned === true,
    sop_v2_complete: v.sopV2 === true,
    profile_final: v.profileFinal === true,
    course_b_complete: v.courseBComplete === true,
    course_b_core_unknown: v.courseBCoreUnknown === true,
    combat_self_assess: v.combatSelfAssess === true,
    s3_complete: v.s3Complete === true,
    gap_documented: v.gapDocumented === true,
    s1_complete: yesNo(v.s1Complete === true),
    s2_complete: yesNo(v.s2Complete === true),
    w3_goal_rechecked: yesNo(v.w3GoalRechecked === true),
    overtime_consent: yesNo(v.overtimeConsent === true),
    w10_unknown_as_pass: v.w10UnknownAsPass === "有" ? "是" : v.w10UnknownAsPass === "沒有" ? "否" : null,
    w10_nonself_action: v.w10NonSelfAction === "有" ? "是" : v.w10NonSelfAction === "沒有" ? "否" : null
  };
  if (settings.program_start === undefined) delete settings.program_start;
  return { ok: errors.length === 0, patch: { settings }, errors };
}

/** Excel 分頁的儲存格轉成 CSV 文字：空儲存格是空字串，不是字面的 null 或 undefined。 */
export function sheetRowsToCsvText(rows) {
  return (rows || [])
    .map((r) => (r || []).map((c) => `"${(c === null || c === undefined ? "" : String(c)).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

/** 資料信任狀態的畫面文字（單一來源）：未核實一律寫「資料未核實」。 */
export function trustLabel(state) {
  if (state === "unverified") return "資料未核實";
  if (state === "verified") return "已核實";
  return "待核";
}

/**
 * 計畫第幾週（0 表示還沒開跑或沒填開跑日）。開跑日 YYYY-MM-DD 以「本地日期」解析（年月日分開建立），
 * 不用 new Date("YYYY-MM-DD")，因為那會被當成 UTC 午夜，在台灣早上 8 點前會少算一天。
 */
export function weekOf(start, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(start || "").trim());
  if (!m) return 0;
  const [y, mo, d] = [m[1], m[2], m[3]].map((x) => parseNumericRaw(x).value);
  const startLocal = new Date(y, mo - 1, d);
  const cur = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(startLocal.getTime()) || Number.isNaN(cur.getTime())) return 0;
  if (startLocal.getFullYear() !== y || startLocal.getMonth() !== mo - 1 || startLocal.getDate() !== d) return 0;
  const today = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate());
  const days = Math.round((today.getTime() - startLocal.getTime()) / 86400000);
  if (days < 0) return 0;
  return Math.floor(days / 7) + 1;
}

/** 「有沒有出價」只看畫面勾選框（勾選框初值由狀態帶入）。 */
export function hasOfferFlag(checked) {
  return checked === true;
}

/** 現場快速模式：只列現場必做題（core 為真）；其餘放在可展開的「其他」區。 */
export function onsiteQuickItems(pack) {
  return (pack?.checklist || []).filter((i) => i.phase === "現場" && i.core === true);
}

/**
 * 私密數字揭露狀態：綁定對象，不是全域旗標。reveal 長得像 { scope, key }：
 * scope 是 "home"（首頁私密區）、"aff"（負擔頁，key 是物件代號）或 "import"（匯入預覽）。
 */
export function isRevealed(reveal, scope, key = null) {
  if (!reveal || reveal.scope == null) return false;
  if (reveal.scope !== scope) return false;
  return (reveal.key ?? null) === (key ?? null);
}

/**
 * 揭露狀態轉移。reveal 指定對象；conceal、select（切換物件）、tab（切換分頁）、hide（頁面隱藏）、
 * page（頁面與上次不同）一律回到未揭露；其他動作維持原狀。
 */
export function nextReveal(reveal, action) {
  const none = { scope: null, key: null };
  switch (action?.type) {
    case "reveal":
      return { scope: action.scope ?? null, key: action.key ?? null };
    case "conceal":
    case "select":
    case "tab":
    case "hide":
    case "page":
      return none;
    default:
      return reveal || none;
  }
}

/**
 * 時段試算（純函式，不寫入任何資料）：只呼叫 suggestSlots 一次並以它的結果為準，不再另外呼叫 usableFieldTime 當後備。
 * 回傳 { status: "ok" | "excluded" | "pending" | "invalid", usable, fullMark, reasons, label }。
 * start、end 是當天從 0 點起算的分鐘數；events 的 start、end 是 "HH:MM" 文字。
 * 只有 status 是 "ok" 時才可以按「採用這個時段」，採用由畫面另外呼叫 setSelectedSlot。
 */
export function slotTrialResult({ half, start, end, outm, backm, events = [], areaCode = "AA01" } = {}) {
  const pending = (why) => ({ status: "pending", usable: null, fullMark: "", reasons: [why], label: why });
  const bad = (v) => typeof v !== "number" || !Number.isFinite(v) || v < 0;
  if ([start, end, outm, backm].some(bad) || typeof half !== "number" || !Number.isFinite(half) || half <= 0) return pending("資料不足");
  const sug = suggestSlots({
    days: [{ date: "d" }],
    events: (events || []).map((e) => ({ ...e, date: "d" })),
    areaCode,
    halfHours: half,
    outboundMin: outm,
    returnMin: backm,
    windows: [{ id: "custom", label: "指定", start, end }]
  });
  if (sug.status === "invalid") {
    const reasons = sug.invalidEvents.map((x) => `第 ${x.index} 筆行程的時間格式不對`);
    return { status: "invalid", usable: null, fullMark: "", reasons, label: `行程資料有誤：${reasons.join("、")}` };
  }
  const cand = sug.candidates[0];
  if (!cand) return pending("資料不足");
  if (cand.commutePending) return pending("通勤待核");
  if (cand.exclude) {
    const reasons = cand.reasons || [];
    return { status: "excluded", usable: null, fullMark: "", reasons, label: `排除：${reasons.join("、")}` };
  }
  return {
    status: "ok",
    usable: cand.usable,
    fullMark: cand.fullMark || "",
    reasons: [],
    label: `可用現場 ${cand.usable} 分${cand.fullMark ? `　${cand.fullMark}` : ""}`
  };
}

/**
 * 把門市訪視紀錄轉成表單要顯示的值（畫面只負責套用）。questionIds 是題庫題號清單。
 * 題庫答案的預設字樣是標示不是答案：存起來的預設字樣在表單上顯示成空白。
 */
export function visitFormModel(visit, questionIds = []) {
  const v = visit && typeof visit === "object" ? visit : {};
  const s = (x) => (x === undefined || x === null ? "" : String(x));
  const detail = v.vis14 && typeof v.vis14 === "object" && v.vis14.detail && typeof v.vis14.detail === "object" ? v.vis14.detail : {};
  const on = (x) => x === 1 || x === true;
  const answers = v.answers && typeof v.answers === "object" ? v.answers : {};
  return {
    vis01: s(v.date || v.start),
    vis02: s(v.branch_label),
    vis03: s(v.agent_alias),
    vis04: s(v.chain_or_local),
    vis05: s(v.slot_id),
    vis06: s(v.companion),
    vis07: s(v.purpose),
    vis08: s(v.advantage),
    vis09: s(v.view_slots),
    vis10: s(v.promo),
    vis11: s(v.clients),
    // 交核結果是固定的四個選項：舊的自由文字顯示為空白，並視為還沒交核（F9-10）
    vis12: CROSS_CHECK_OPTIONS.includes(s(v.cross_check).trim()) ? s(v.cross_check).trim() : "",
    vis13: s(v.promise),
    vis15: s(v.main_partner),
    vis16: s(v.n_listings),
    vis14flex: on(detail.flex),
    vis14docs: on(detail.docs),
    vis14promise: on(detail.promise),
    vis14nopress: on(detail.no_pressure),
    vis14local: on(detail.local_knowledge),
    vis14reason: s(v.vis14_reason),
    visLicense: licenseConfirmed(v.license_ok),
    // 證照確認是三選一：是、否、改用公開查詢（舊資料的勾選 true／false 對應成是／否）
    visLicenseChoice: v.license_ok === true ? "是" : v.license_ok === false ? "否" : ["是", "否", "改用公開查詢"].includes(s(v.license_ok).trim()) ? s(v.license_ok).trim() : "",
    signed: s(v.signed),
    fee: s(v.fee_clause),
    priv: s(v.private_deal_fee),
    ex: s(v.exclude_other),
    redFlags: Array.isArray(v.red_flags) ? v.red_flags.map((x) => String(x)) : [],
    g1Confirm: isFlagOn(v.g1_partner_confirmed),
    g1ConfirmReason: s(v.g1_partner_reason),
    answers: Object.fromEntries((questionIds || []).map((id) => [id, s(answers[id]) === DEFAULT_UNVERIFIED ? "" : s(answers[id])]))
  };
}

/**
 * 橫幅要顯示的訊息：常駐訊息（上限待填、冷靜期等，每次重繪重新算）加上通知佇列（重繪不會讓通知消失）。
 * notices 每則長得像 { id, level: "error" | "warn" | "info", text, sticky }。
 */
export function bannerModel({ standing = [], notices = [] } = {}) {
  const items = [
    ...standing.map((text, i) => ({ id: `standing-${i}`, level: "standing", text: String(text), sticky: true })),
    ...notices.map((n) => ({ id: n.id, level: n.level || "info", text: String(n.text ?? ""), sticky: !!n.sticky }))
  ];
  return { items, hasDanger: notices.some((n) => n.level === "error"), hidden: items.length === 0 };
}

/**
 * 指令回報之後通知佇列怎麼變：成功就清掉非常駐（sticky 為假）的通知，常駐的留著；失敗時全部保留。
 */
export function afterCommand(notices = [], result) {
  if (result && result.ok === false) return notices;
  return notices.filter((n) => n.sticky);
}

/** 指令回傳的警告（warnings）轉成通知，等級是 warn。 */
export function noticesFromResult(result) {
  const out = [];
  for (const w of result?.warnings || []) {
    const text = String(w?.message ?? w ?? "").trim();
    if (text) out.push({ level: "warn", text });
  }
  return out;
}

/**
 * 匯出備份完成後的訊息（F9-01、F9-04）：照片與錄音共幾個、備份檔約多少 MB；
 * 先同步過另一個分頁就加一句說明。
 */
export function exportDoneMessage(pack) {
  const parts = ["已分別下載資料檔與媒體包。"];
  const st = pack?.stats;
  if (st && Number.isFinite(st.mediaCount) && Number.isFinite(st.fileBytes)) {
    const mb = Math.max(0.1, Math.round((st.fileBytes / 1048576) * 10) / 10);
    parts.push(`照片與錄音共 ${st.mediaCount} 個，備份檔約 ${mb} MB。`);
  }
  if (pack?.resynced) parts.push("已先同步另一個分頁的變更。");
  return parts.join("");
}

/** 還原備份時，各張表的白話名稱（量詞加名稱）。畫面上不出現內部表名。 */
const DIFF_ROW_UNITS = {
  properties: "間物件",
  viewings: "筆看房紀錄",
  scores: "筆評分",
  visits: "筆門市訪視",
  listings: "筆屋單",
  transcripts: "筆逐字稿",
  drafts: "份訊息草稿",
  media: "張照片或文件照",
  audioChunks: "段錄音",
  vetoReleases: "筆否決解除紀錄",
  priceLog: "筆問價紀錄"
};
const DIFF_SINGLE_NAMES = { settings: "設定", finance: "財務門檻", profile: "理想輪廓", scoring: "評分設定", coach: "口袋大叔的進度與筆記" };
const DIFF_LIST_NAMES = { areas: "區域資料", agents: "仲介名單", travel: "常用地點通勤表", slots: "格位表" };

/**
 * 把 backupDiff 的結果寫成白話句子（F9-03）：先列各項筆數，再列內容不同的門檻資料。
 * 例：「這台手機和備份有不同的地方：這台手機有 2 張照片或文件照是備份裡沒有的；有 1 間物件兩邊的內容不同；財務門檻兩邊也不同。」
 */
export function backupDiffSummary(diff) {
  if (!diff || !diff.total) return "備份和這台手機的內容相同。";
  const parts = [];
  for (const [table, unit] of Object.entries(DIFF_ROW_UNITS)) {
    const r = diff.rows?.[table];
    if (!r) continue;
    if (r.localOnly > 0) parts.push(`這台手機有 ${r.localOnly} ${unit}是備份裡沒有的`);
    if (r.incomingOnly > 0) parts.push(`備份裡有 ${r.incomingOnly} ${unit}是這台手機沒有的`);
    if (r.changed > 0) parts.push(`有 ${r.changed} ${unit}兩邊的內容不同`);
  }
  const others = [
    ...(diff.singles || []).map((k) => DIFF_SINGLE_NAMES[k] || "其他設定"),
    ...(diff.lists || []).map((k) => DIFF_LIST_NAMES[k] || "其他清單")
  ];
  if (others.length) parts.push(`${others.join("、")}兩邊也不同`);
  return `這台手機和備份有不同的地方：${parts.join("；")}。`;
}

/**
 * 負擔能力頁要顯示的每一行文字（F9-17）。
 * 白話：延伸帶物件的結果以前是「真的文字已經寫進畫面、只是套了遮罩樣式」，樣式失效、螢幕閱讀器、複製貼上
 * 或頁面搜尋都讀得到。現在 hidden 為真時只回固定的占位文字，不含任何真實狀態、數字或缺項名稱。
 * liquidText 是「購屋後流動資金」要顯示的文字（由畫面決定是遮成圓點還是顯示），hidden 時完全不用。
 */
export function affordLines(r, { hidden = false, liquidText = "" } = {}) {
  const note = "（延伸帶，長按顯示）";
  if (hidden) {
    return [`頭期適足：${note}`, ...[1, 2, 3, 4].map((n) => `第 ${n} 道：${note}`), `購屋後流動資金：${note}`];
  }
  const missing = r?.adequacy?.missing?.length ? `缺：${r.adequacy.missing.join("、")}` : "";
  return [
    `頭期適足：${r?.adequacy?.status} ${missing}`,
    ...(r?.checks || []).map((c, i) => `第 ${i + 1} 道：${c.status} ${c.display || ""}${c.missing?.length ? ` 缺 ${c.missing.join("、")}` : ""}`),
    `購屋後流動資金：${liquidText}`
  ];
}

/**
 * 現在該不該存門市草稿（F9-07）：有進行中（還沒結束）的訪視才存。
 * 白話：事件一律先掛上，處理的當下才用這個函式判斷，所以「按了開始本次門市之後才出現訪視」也會存。
 */
export function shouldSaveVisitDraft(state) {
  const vid = state?.currentVisitId;
  if (!vid) return false;
  const vis = (state?.visits || []).find((x) => x && x.id === vid);
  return !!vis && !vis.end;
}

/**
 * 門市草稿存檔器（F9-07）。onInput 是打字時呼叫（去抖動一小段時間後才存），flush 是離開欄位、按開始、
 * 換頁或切到背景時呼叫（立刻存）。getState 在「存的當下」才讀狀態，所以建立它的時候還沒有訪視也沒關係。
 * collect 回傳目前表單內容；回 null 代表畫面上已經沒有這個表單（頁面換掉了），就不存。
 * setTimer、clearTimer 可以注入，測試時不必真的等時間。
 */
export function makeVisitDraftSaver({
  getState,
  save,
  collect,
  delay = 250,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h)
} = {}) {
  let timer = null;
  const stopTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const run = async () => {
    stopTimer();
    const st = getState();
    if (!shouldSaveVisitDraft(st)) return;
    const form = collect();
    if (!form) return;
    await save(st.currentVisitId, form);
  };
  return {
    onInput() {
      stopTimer();
      timer = setTimer(() => {
        timer = null;
        run();
      }, delay);
    },
    flush: run,
    /** 只有還在等待的草稿才立刻送出（換頁、切到背景時用）。 */
    flushPending() {
      if (timer === null) return Promise.resolve();
      return run();
    },
    /** 取消還沒送出的草稿（按「結束並存門市紀錄」前用）。 */
    cancel: stopTimer,
    hasPending: () => timer !== null
  };
}

/**
 * 現場頁畫面顯示的看房和目前選定的看房不同，就是過期的畫面（F9-08）：這時不能把清單、拍照寫下去，
 * 否則會記到另一間。兩邊都沒有看房算同一個狀態，不過期。
 */
export function isStaleFieldView(shownId, currentId) {
  return (shownId ?? null) !== (currentId ?? null);
}

/** 另一個分頁更新後重新讀取的結果怎麼處理（F9-19）：讀取失敗就顯示鎖定畫面，其餘照常重繪。 */
export function afterReload(status) {
  return status === "failed" ? "lock" : "render";
}
