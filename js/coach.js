/**
 * 口袋教練（第 13 輪 C1 到 C4、E1、E6）：純函式，不碰畫面、不寫資料、不連網。
 * 白話：教練內容（階段、步驟、話術）放在方法包的 `stages` 裡，程式裡不寫死任何課程內容；
 * 這裡只負責三件事：檢查方法包的 stages 結構對不對、算出「你現在在第幾階段、下一步做什麼、還要幾分鐘」、
 * 以及整理教練的持久狀態（目前階段、各步驟完成日期、階段筆記、自訂題目）。
 */
import { emptyCoach } from "./persisted.js";
import { toFiniteNumber } from "./fields.js";

export { emptyCoach };

/** 這個審查狀態的階段，頁首要顯示黃條「這段還在顧問審查中，先當參考」。 */
export const REVIEW_PENDING = "待安家審";

/** 方法包 stages 裡 links_to 認得的畫面連結：名稱對到網址井字號與按鈕文字。不認得的連結不顯示按鈕，也不報錯。 */
export const SCREEN_LINKS = {
  import: { href: "#more/import", label: "去匯入" },
  visit: { href: "#visit", label: "去看一間" },
  agency333: { href: "#more/agency", label: "去門市紀錄" },
  price_log: { href: "#price_log", label: "去問價紀錄" },
  notes_export: { href: "#more/export", label: "去匯出到筆記" }
};

const PREFILL_KINDS = ["import", "ai_research"];
const COUNT_FROM = ["rooms", "baths"];

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isText(v) {
  return typeof v === "string" && v.trim() !== "";
}

function textList(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

// ---------------------------------------------------------------------------
// C1：stages 結構檢查
// ---------------------------------------------------------------------------

/**
 * 檢查方法包的 stages（選填）。缺欄位就列錯誤，但不讓整個方法包失敗，只是教練不啟用。
 * @param {unknown} stages 方法包裡的 stages
 * @param {{ checklist?: object[] }} ctx 方法包的清單（用來提醒 checklist_ids 指到不存在的題目；那只是提醒，不算錯誤）
 * @returns {{ present: boolean, enabled: boolean, errors: {stage:string, field:string, message:string}[], warnings: {stage:string, field:string, message:string}[], stages: object[] }}
 */
export function validateStages(stages, { checklist = [] } = {}) {
  if (stages === undefined || stages === null) return { present: false, enabled: false, errors: [], warnings: [], stages: [] };
  const errors = [];
  const warnings = [];
  const err = (stage, field, message) => errors.push({ stage, field, message });
  if (!Array.isArray(stages)) {
    err("", "stages", "stages 必須是清單");
    return { present: true, enabled: false, errors, warnings, stages: [] };
  }
  if (stages.length === 0) {
    err("", "stages", "stages 是空的，沒有任何階段");
    return { present: true, enabled: false, errors, warnings, stages: [] };
  }
  const items = new Map((Array.isArray(checklist) ? checklist : []).filter(isObj).map((i) => [i.id, i]));
  const stageIds = new Set();
  const orders = new Set();
  const stepIds = new Set();
  const out = [];
  stages.forEach((s, idx) => {
    const label = isObj(s) && isText(s.id) ? s.id : `第 ${idx + 1} 個階段`;
    if (!isObj(s)) {
      err(label, "", "階段必須是物件");
      return;
    }
    for (const f of ["id", "title", "goal", "enter_when", "next_when", "review_status"]) {
      if (!isText(s[f])) err(label, f, `階段缺少 ${f}`);
    }
    if (isText(s.id)) {
      if (stageIds.has(s.id)) err(label, "id", `階段代號重複：${s.id}`);
      stageIds.add(s.id);
    }
    if (!Number.isInteger(s.order) || s.order < 1) err(label, "order", "階段順序 order 必須是 1 以上的整數");
    else {
      if (orders.has(s.order)) err(label, "order", `階段順序重複：${s.order}`);
      orders.add(s.order);
    }
    if (s.minutes !== undefined && !(toFiniteNumber(s.minutes) > 0)) err(label, "minutes", "建議分鐘 minutes 必須是大於 0 的數字");
    for (const f of ["record", "stop_signals"]) {
      if (!Array.isArray(s[f]) || !s[f].every(isText)) err(label, f, `${f} 必須是文字清單（可以是空清單）`);
    }
    if (!Array.isArray(s.uncle_says)) err(label, "uncle_says", "uncle_says 必須是清單（可以是空清單）");
    else if (!s.uncle_says.every((u) => isObj(u) && isText(u.text) && isText(u.source))) err(label, "uncle_says", "uncle_says 每一項都要有 text 與 source");
    if (!Array.isArray(s.scripts)) err(label, "scripts", "scripts 必須是清單（可以是空清單）");
    else {
      s.scripts.forEach((sc, j) => {
        if (!isObj(sc) || !isText(sc.situation)) err(label, "scripts", `第 ${j + 1} 則話術缺少 situation`);
        else for (const f of ["say", "ask", "listen_for", "avoid"]) if (!textList(sc[f])) err(label, "scripts", `話術「${sc.situation}」的 ${f} 必須是文字清單（可以是空清單）`);
      });
    }
    if (!Array.isArray(s.steps) || s.steps.length === 0) err(label, "steps", "steps 必須是至少一個步驟的清單");
    else {
      s.steps.forEach((st, j) => {
        const sl = isObj(st) && isText(st.id) ? st.id : `${label} 第 ${j + 1} 步`;
        if (!isObj(st)) {
          err(label, "steps", `${sl} 必須是物件`);
          return;
        }
        for (const f of ["id", "text", "how"]) if (!isText(st[f])) err(label, "steps", `${sl} 缺少 ${f}`);
        if (isText(st.id)) {
          if (stepIds.has(st.id)) err(label, "steps", `步驟代號重複：${st.id}`);
          stepIds.add(st.id);
        }
        if (st.links_to !== undefined && typeof st.links_to !== "string") err(label, "steps", `${sl} 的 links_to 必須是文字`);
        if (st.optional !== undefined && typeof st.optional !== "boolean") err(label, "steps", `${sl} 的 optional 必須是 true 或 false`);
        if (st.minutes !== undefined && !(toFiniteNumber(st.minutes) > 0)) err(label, "steps", `${sl} 的 minutes 必須是大於 0 的數字`);
        if (st.checklist_ids !== undefined && (!textList(st.checklist_ids) || st.checklist_ids.length === 0)) err(label, "steps", `${sl} 的 checklist_ids 必須是題目代號的清單`);
        if (st.tips !== undefined && !(textList(st.tips) && st.tips.every(isText))) err(label, "steps", `${sl} 的 tips 必須是文字清單`);
        if (st.prefill !== undefined && !PREFILL_KINDS.includes(st.prefill)) err(label, "steps", `${sl} 的 prefill 只認 ${PREFILL_KINDS.join("、")}`);
        if (st.repeatable !== undefined && typeof st.repeatable !== "boolean") err(label, "steps", `${sl} 的 repeatable 必須是 true 或 false`);
        if (st.repeatable === true && !(Array.isArray(st.checklist_ids) && st.checklist_ids.length)) err(label, "steps", `${sl} 可重複，但沒有 checklist_ids`);
        if (st.count_from !== undefined && !COUNT_FROM.includes(st.count_from)) err(label, "steps", `${sl} 的 count_from 只認 ${COUNT_FROM.join("、")}`);
        if (st.instance_label !== undefined && !isText(st.instance_label)) err(label, "steps", `${sl} 的 instance_label 必須是文字`);
        if (st.visit_step !== undefined && !(Number.isInteger(st.visit_step) && st.visit_step >= 1 && st.visit_step <= 4)) err(label, "steps", `${sl} 的 visit_step 必須是 1 到 4 的整數`);
        if (Array.isArray(st.checklist_ids) && items.size) {
          for (const id of st.checklist_ids) {
            if (typeof id === "string" && !items.has(id)) warnings.push({ stage: label, field: "checklist_ids", message: `${sl} 的 checklist_ids 有找不到的題目：${id}` });
          }
        }
      });
    }
    out.push(s);
  });
  if (errors.length) return { present: true, enabled: false, errors, warnings, stages: [] };
  const sorted = [...out].sort((a, b) => a.order - b.order).map((s) => ({
    ...s,
    steps: s.steps.map((st) => ({ ...st, optional: st.optional === true }))
  }));
  return { present: true, enabled: true, errors: [], warnings, stages: sorted };
}

/** 方法包的教練內容：結構正確才有（回傳 enabled、已依順序排好的 stages、錯誤清單）。 */
export function stagesInfo(pack) {
  return validateStages(pack?.stages, { checklist: pack?.checklist });
}

// ---------------------------------------------------------------------------
// 連結
// ---------------------------------------------------------------------------

/**
 * 解析步驟的 links_to。認得 checklist:題目代號（題目在方法包裡才算）與 screen:畫面名稱；不認得就回 null（不顯示按鈕，不報錯）。
 */
export function parseLink(raw, checklist = []) {
  if (typeof raw !== "string") return null;
  const m = /^(checklist|screen):(.+)$/.exec(raw.trim());
  if (!m) return null;
  if (m[1] === "screen") {
    const t = SCREEN_LINKS[m[2]];
    return t ? { kind: "screen", name: m[2], href: t.href, label: t.label } : null;
  }
  const item = (Array.isArray(checklist) ? checklist : []).find((i) => i && i.id === m[2]);
  return item ? { kind: "checklist", itemId: item.id, phase: item.phase, label: "去這一題" } : null;
}

// ---------------------------------------------------------------------------
// C2：教練的持久狀態
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 第 15 輪 F-R15-11：上手卡的手動標記（存在教練狀態裡，走單一寫入者 commit()）。
 * pwa_done 我已經加好了、builtin_pack 先用內建通用版、tried 我試過了、collapsed 先收起來。
 * 這些只留在手機：匯出到筆記的教練區段是逐欄整理的，不含這一欄（有測試守著）。
 */
export const ONBOARDING_FLAGS = ["pwa_done", "builtin_pack", "tried", "collapsed"];

function normalizeOnboarding(raw) {
  const out = {};
  if (isObj(raw)) for (const k of ONBOARDING_FLAGS) if (raw[k] === true) out[k] = true;
  return out;
}

function uniqueTexts(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter(isText))];
}

/** 把任何來源的教練狀態整理成乾淨的樣子（備份、舊資料、損毀資料都不會讓畫面當掉）；找不到的步驟代號照樣保留。 */
export function normalizeCoach(raw) {
  const c = isObj(raw) ? raw : {};
  const done = {};
  if (isObj(c.steps_done)) {
    for (const [k, v] of Object.entries(c.steps_done)) if (k && typeof v === "string" && DATE_RE.test(v)) done[k] = v;
  }
  const notes = (Array.isArray(c.stage_notes) ? c.stage_notes : [])
    .filter((n) => isObj(n) && isText(n.id) && isText(n.stage_id) && typeof n.text === "string")
    .map((n) => ({
      id: n.id,
      stage_id: n.stage_id,
      ...(isText(n.property_code) ? { property_code: n.property_code } : {}),
      at: typeof n.at === "string" ? n.at : "",
      text: n.text
    }));
  const custom = (Array.isArray(c.custom_items) ? c.custom_items : [])
    .filter((i) => isObj(i) && isText(i.id) && isText(i.text) && textList(i.options) && i.options.length >= 2)
    .map((i) => ({ id: i.id, text: i.text, options: [...i.options], step_id: isText(i.step_id) ? i.step_id : null }));
  const onboarding = normalizeOnboarding(c.onboarding);
  return {
    current_stage: isText(c.current_stage) ? c.current_stage : null,
    steps_done: done,
    stage_notes: notes,
    custom_items: custom,
    hidden_items: uniqueTexts(c.hidden_items),
    // 沒有任何標記時不多一個空欄位（舊資料與舊測試看到的形狀不變）
    ...(Object.keys(onboarding).length ? { onboarding } : {})
  };
}

/** 本機日期（手機的時區）：YYYY-MM-DD。 */
export function localDate(nowMs) {
  const d = new Date(nowMs);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function unionById(local, incoming) {
  const seen = new Set((local || []).map((x) => x.id));
  return [...(local || []), ...(incoming || []).filter((x) => !seen.has(x.id))];
}

/** 備份合併：本機優先，備份裡本機沒有的步驟完成日期、階段筆記、自訂題目、隱藏題目補進來。 */
export function mergeCoach(local, incoming) {
  const a = normalizeCoach(local);
  const b = normalizeCoach(incoming);
  return {
    current_stage: a.current_stage || b.current_stage,
    steps_done: { ...b.steps_done, ...a.steps_done },
    stage_notes: unionById(a.stage_notes, b.stage_notes),
    custom_items: unionById(a.custom_items, b.custom_items),
    hidden_items: uniqueTexts([...a.hidden_items, ...b.hidden_items]),
    ...(Object.keys({ ...(a.onboarding || {}), ...(b.onboarding || {}) }).length ? { onboarding: { ...(b.onboarding || {}), ...(a.onboarding || {}) } } : {})
  };
}

// ---------------------------------------------------------------------------
// C3、C4、E1、E6：進度與下一步
// ---------------------------------------------------------------------------

export function requiredSteps(stage) {
  return (stage?.steps || []).filter((s) => s.optional !== true);
}

/** 一個階段的完成情形：done/total 是所有步驟（含選做）勾了幾個，requiredDone 是必要步驟勾完了沒有。 */
export function stageProgress(stage, coach) {
  const done = coach?.steps_done || {};
  const steps = stage?.steps || [];
  const req = requiredSteps(stage);
  const reqDone = req.filter((s) => done[s.id]).length;
  return {
    total: steps.length,
    done: steps.filter((s) => done[s.id]).length,
    required: req.length,
    requiredDone: reqDone,
    allRequiredDone: reqDone === req.length
  };
}

/** 這一階段第一個還沒做的必要步驟；都做完了回 null。 */
export function nextStepOf(stage, coach) {
  const done = coach?.steps_done || {};
  return requiredSteps(stage).find((s) => !done[s.id]) || null;
}

/** 目前階段：使用者手動切換的優先（方法包裡找得到才算）；否則是第一個必要步驟還沒做完的階段；全做完停在最後一個。 */
export function currentStageOf(stages, coach) {
  if (!stages?.length) return null;
  const picked = stages.find((s) => s.id === coach?.current_stage);
  if (picked) return picked;
  return stages.find((s) => !stageProgress(s, coach).allRequiredDone) || stages[stages.length - 1];
}

/** 階段建議分鐘：階段自己有寫就用，沒有就是必要步驟的分鐘加總；都沒寫回 0。 */
export function stageMinutes(stage) {
  const own = toFiniteNumber(stage?.minutes);
  if (own > 0) return own;
  return requiredSteps(stage).reduce((n, s) => n + (toFiniteNumber(s.minutes) || 0), 0);
}

/** E6：目前階段與之後各階段，還沒做的必要步驟的建議分鐘加總。 */
export function remainingMinutes(stages, coach, fromOrder) {
  const done = coach?.steps_done || {};
  let sum = 0;
  for (const s of stages || []) {
    if (s.order < fromOrder) continue;
    for (const st of requiredSteps(s)) if (!done[st.id]) sum += toFiniteNumber(st.minutes) || 0;
  }
  return sum;
}

/** F-R14-11：只算這一個階段，還沒做的必要步驟的建議分鐘加總。 */
export function stageRemainingMinutes(stage, coach) {
  const done = coach?.steps_done || {};
  let sum = 0;
  for (const st of requiredSteps(stage)) if (!done[st.id]) sum += toFiniteNumber(st.minutes) || 0;
  return sum;
}

/** 分鐘換成「約 X 小時」的白話（一小時以內就直接講分鐘）。 */
export function hoursText(minutes) {
  if (!(minutes > 0)) return "0 分鐘";
  if (minutes < 60) return `${Math.round(minutes)} 分鐘`;
  const h = Math.round((minutes / 60) * 10) / 10;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} 小時`;
}

/** E1：看一間第 n 步（2 看房前、3 現場、4 看房後）的建議分鐘 = 方法包裡標了 visit_step 為 n 的必要步驟的分鐘加總；沒有就是 0。 */
export function visitStepMinutes(pack, n) {
  const info = stagesInfo(pack);
  if (!info.enabled) return 0;
  let sum = 0;
  for (const s of info.stages) for (const st of requiredSteps(s)) if (st.visit_step === n) sum += toFiniteNumber(st.minutes) || 0;
  return sum;
}

/** 方法包裡所有標了 visit_step 為 n 的步驟（C7：把「看房後」的步驟標示出來）。 */
export function stepsForVisitStep(pack, n) {
  const info = stagesInfo(pack);
  if (!info.enabled) return [];
  return info.stages.flatMap((s) => s.steps.filter((st) => st.visit_step === n).map((st) => ({ ...st, stage_id: s.id, stage_order: s.order })));
}

/** 首頁口袋教練卡要顯示的內容（C3、E6）。方法包沒有教練內容、或結構有錯，enabled 為 false。 */
export function coachModel(state) {
  const info = stagesInfo(state?.methodPack);
  if (!info.enabled) return { enabled: false, errors: info.errors };
  const coach = normalizeCoach(state?.coach);
  const stage = currentStageOf(info.stages, coach);
  const next = nextStepOf(stage, coach);
  const later = info.stages.find((s) => s.order > stage.order) || null;
  const minutes = stageRemainingMinutes(stage, coach); // 「這階段」還要幾分鐘（F-R14-11：不再把八個階段全部加總說成「這間」）
  const allMinutes = remainingMinutes(info.stages, coach, 1); // 全部階段還沒做的必要步驟
  let nextLine;
  if (next) nextLine = `下一步:${next.text}`;
  else if (later) nextLine = `下一步:這一階段的必要步驟都做完了，到「${later.title}」`;
  else nextLine = "下一步:必要步驟都做完了，可以回頭看看哪裡還要補";
  return {
    enabled: true,
    stage: { id: stage.id, order: stage.order, title: stage.title },
    stageLine: `你現在在:第 ${stage.order} 階段 ${stage.title}`,
    next: next ? { id: next.id, text: next.text } : null,
    nextLine,
    remainingMinutes: minutes,
    minutesLine: minutes > 0 ? `這階段還要大約 ${minutes} 分鐘` : "這階段的必要步驟都做完了",
    allMinutes,
    allMinutesLine: allMinutes > 0 ? `全部 ${info.stages.length} 階段約 ${hoursText(allMinutes)}` : `全部 ${info.stages.length} 階段的必要步驟都做完了`,
    buttonLabel: "照著做",
    href: `#coach/${stage.order}`
  };
}

/**
 * E1 計時器的顯示：已用幾分幾秒；超過建議分鐘只提示，不擋任何操作。只在本機計時，不連網。
 * startedAt 與 nowMs 都是毫秒時間；minutes 是建議分鐘（0 代表沒有建議）。
 */
export function timerView({ startedAt, nowMs, minutes = 0 }) {
  const sec = Math.max(0, Math.floor((nowMs - startedAt) / 1000));
  const mm = Math.floor(sec / 60);
  const ss = String(sec % 60).padStart(2, "0");
  const over = minutes > 0 && sec > minutes * 60;
  return { seconds: sec, text: `已用 ${mm} 分 ${ss} 秒`, over, hint: over ? "已經超過建議的時間了，只是提醒，不用急，先把重要的做完" : "" };
}
