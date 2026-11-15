/**
 * 簡化版畫面的判斷（第 12 輪 U1 到 U6）：純函式，不碰畫面、不寫資料。
 * 白話：四個分頁（首頁、看房、物件、更多）怎麼從網址對到頁面、舊網址怎麼導到新位置、首頁要顯示什麼、
 * 「看一間」四步現在在第幾步、看房前還差幾項、物件清單每一列寫什麼，都寫在這裡，畫面只負責照著畫，也方便不開瀏覽器直接測。
 */
import { isFlagOn, toFiniteNumber } from "./fields.js";
import { itemsForViewing, displayItem } from "./items-for-viewing.js";
import { responseValue, uniqueCounted, countViewing } from "./counting.js";
import { assessPropertyFromState, orderedViewings, sizeCheck } from "./scoring.js";
import { propertyStatus } from "./notes-export.js";
import { scoreLineText, capLabelLine, bonusLine } from "./ui-logic.js";
import { coachModel } from "./coach.js";

/** 底部導覽只有四個分頁。 */
export const NAV_PAGES = [
  { page: "home", label: "首頁", href: "#home" },
  { page: "visit", label: "看房", href: "#visit" },
  { page: "property", label: "物件", href: "#property" },
  { page: "more", label: "更多", href: "#more" }
];

/** 「更多」底下的小頁面。 */
export const MORE_SECTIONS = ["import", "settings", "progress", "agency", "aff", "drafts", "backup", "slots", "profile", "export", "start"];

export const VISIT_STEPS = [
  { n: 1, label: "選物件" },
  { n: 2, label: "看房前" },
  { n: 3, label: "現場" },
  { n: 4, label: "看房後" }
];

/** 舊網址對到新位置（匯入、仲介、負擔移到「更多」，現場併進「看房」，比較移到「物件」）。 */
export const LEGACY_ROUTES = {
  import: "#more/import",
  agency: "#more/agency",
  aff: "#more/aff",
  compare: "#property/compare"
};

/**
 * 把網址的井字號部分解成頁面。
 * 回傳 { page, sub, id, step, canonical, redirected }：canonical 是新位置的井字號，redirected 為真代表舊網址或網址不認得，
 * 畫面要把網址改成 canonical（不留舊網址的歷史），而且永遠有頁面可以畫，不會出現空白頁。
 * ctx.hasCurrentViewing：有進行中的看房時，舊的「現場」網址（#field）導到看一間的第 3 步，否則導到第 1 步。
 */
export function resolveRoute(hash, ctx = {}) {
  const raw = String(hash ?? "").replace(/^#/, "");
  const parts = raw.split("/");
  const head = parts[0] || "home";
  // navPage 是底部導覽要亮哪一個分頁（口袋大叔屬於首頁、問價紀錄屬於物件）；沒指定就是頁面本身
  const done = (r) => ({ id: null, sub: null, step: null, station: null, ...r, navPage: r.navPage || r.page, redirected: r.redirected === true });
  if (head === "field") {
    return done({ page: "visit", step: ctx.hasCurrentViewing ? 3 : 1, canonical: ctx.hasCurrentViewing ? "#visit/3" : "#visit", redirected: true });
  }
  if (LEGACY_ROUTES[head]) {
    const next = resolveRoute(LEGACY_ROUTES[head], ctx);
    return { ...next, redirected: true };
  }
  if (head === "home") return done({ page: "home", canonical: "#home", redirected: raw !== "home" });
  if (head === "coach") {
    // 口袋大叔階段頁：#coach 是目前階段，#coach/N 是第 N 階段（N 是階段順序）
    const n = toFiniteNumber(parts[1]);
    const order = Number.isInteger(n) && n >= 1 && n <= 99 ? n : null;
    return done({ page: "coach", id: order, navPage: "home", canonical: order ? `#coach/${order}` : "#coach", redirected: parts.length > 1 && !order });
  }
  if (head === "price_log") {
    // 問價紀錄：#price_log 先選物件，#price_log/物件代號 直接看那一間
    let id = null;
    if (parts[1]) {
      try {
        id = decodeURIComponent(parts[1]);
      } catch {
        id = parts[1];
      }
    }
    return done({ page: "price_log", id, navPage: "property", canonical: id ? `#price_log/${encodeURIComponent(id)}` : "#price_log" });
  }
  if (head === "visit") {
    const n = toFiniteNumber(parts[1]);
    const step = Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
    // 第 13 輪 E2：現場（第 3 步）若有路線站，#visit/3/N 是第 N 站；到場確認那一頁是 #visit/3
    const m = toFiniteNumber(parts[2]);
    const station = step === 3 && Number.isInteger(m) && m >= 1 && m <= 99 ? m : null;
    const canonical = step ? (station ? `#visit/3/${station}` : `#visit/${step}`) : "#visit";
    return done({ page: "visit", step, station, canonical, redirected: parts.length > 1 && (!step || (parts.length > 2 && !station)) });
  }
  if (head === "sheet") return done({ page: "sheet", navPage: "visit", canonical: "#sheet", redirected: parts.length > 1 });
  if (head === "property") {
    const sub = parts[1] || null;
    if (sub === "compare") return done({ page: "property", sub: "compare", canonical: "#property/compare" });
    if (sub === "field") return done({ page: "property", sub: "field", canonical: "#property/field" });
    if (sub === "detail" && parts[2]) {
      let id = parts[2];
      try {
        id = decodeURIComponent(parts[2]);
      } catch {
        id = parts[2];
      }
      return done({ page: "property", sub: "detail", id, canonical: `#property/detail/${encodeURIComponent(id)}` });
    }
    return done({ page: "property", canonical: "#property", redirected: Boolean(sub) });
  }
  if (head === "more") {
    const sub = parts[1] || null;
    if (sub && MORE_SECTIONS.includes(sub)) return done({ page: "more", sub, canonical: `#more/${sub}` });
    return done({ page: "more", canonical: "#more", redirected: Boolean(sub) });
  }
  return done({ page: "home", canonical: "#home", redirected: true });
}

/** 某間物件有沒有沒存檔的看房（看房到一半）。 */
export function unfinishedViewing(state, propertyId) {
  return orderedViewings(state, propertyId).filter((v) => !isFlagOn(v.post_saved)).at(-1) || null;
}

/** 目前進行中的看房（看房紀錄沒存檔）。 */
export function currentOpenViewing(state) {
  const v = (state?.viewings || []).find((x) => x && x.id === state.currentViewingId);
  return v && !isFlagOn(v.post_saved) ? v : null;
}

/** 看房前或看房後必做項目的完成情形：還差幾項（沒填的）、待核幾項。 */
export function phaseProgress(state, viewing, phase = "看房前") {
  const items = viewing ? itemsForViewing(state, viewing).filter((i) => i.phase === phase && i.core === true) : [];
  let left = 0;
  let pending = 0;
  let done = 0;
  for (const item of items) {
    const rv = responseValue(viewing.responses?.[item.id]);
    if (!rv.filled) left += 1;
    else if (rv.pending) pending += 1;
    else done += 1;
  }
  return { total: items.length, left, pending, done };
}

/** 現場必做題依分類分組（分類名稱來自方法包；沒有分類的歸在「其他」）。 */
export function groupByCategory(items) {
  const groups = [];
  for (const item of items || []) {
    const name = item.category || "其他";
    let g = groups.find((x) => x.name === name);
    if (!g) {
      g = { name, items: [] };
      groups.push(g);
    }
    g.items.push(item);
  }
  return groups;
}

/** 看房中的物件分到哪個步驟（沒有看房、或看房已存檔就是第 1 步；到一半的看房預設第 2 步）。 */
export function defaultVisitStep(state) {
  return currentOpenViewing(state) ? 2 : 1;
}

/** 清單一列的名稱：有 label 就用，沒有（空白、undefined）就退回代號，不會出現空白或 undefined（第 15 輪 F-R15-07）。 */
export function rowLabel(r) {
  const label = typeof r?.label === "string" ? r.label.trim() : "";
  if (label) return label;
  const id = r?.id;
  return id === undefined || id === null ? "" : String(id);
}

/**
 * 第 16 輪 F-R16-51（依統籌 11/15 更正）：手機新建物件的自動代號延續筆記正本的 H 編號，格式 H-NNN（三位數補零）。
 * 規則：取手機上所有 H- 開頭代號的最大數字加 1；沒有任何 H 代號從 H-001 開始；不和現有代號重複；非 H 開頭的舊代號不動也不計入。
 * 白話：代號只是系統用來分辨的編號，不用人想；要記得是哪一間，靠「記憶備註」。
 */
export function nextAutoCode(properties) {
  const taken = new Set((Array.isArray(properties) ? properties : []).filter((p) => p && typeof p === "object").map((p) => String(p.id)));
  let max = 0;
  for (const id of taken) {
    const m = /^H-(\d+)$/.exec(id);
    if (!m) continue;
    const n = toFiniteNumber(m[1]);
    if (Number.isInteger(n) && n > max) max = n;
  }
  let n = max + 1;
  const code = (k) => `H-${String(k).padStart(3, "0")}`;
  while (taken.has(code(n))) n += 1;
  return code(n);
}

/** 錄音段落一行的文字，例如「03:10 浴室 2」（第 16 輪 F-R16-55）：錄音開始後第幾秒加站名。 */
export function recMarkText(mark) {
  const sec = Math.max(0, Math.floor(toFiniteNumber(mark?.sec) ?? 0));
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return `${mm}:${ss} ${String(mark?.name ?? "").trim()}`.trim();
}

/** 記憶備註的第二行小字：太長就截斷（預設 28 個字）。 */
export function memoryLine(text, max = 28) {
  const t = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

const idText = (id) => (id === undefined || id === null ? "" : String(id).trim());

/** 物件清單一列要顯示的內容。 */
export function propertyRows(state) {
  const counted = uniqueCounted(state.viewings, state.properties, state.methodPack);
  const areaLabel = (code) => (state.areas || []).find((a) => a && a.area_code === code)?.area_label || code || "";
  return (state.properties || [])
    .filter((p) => p && typeof p === "object")
    .map((p) => {
      const live = assessPropertyFromState(state, p.id);
      const views = orderedViewings(state, p.id);
      const countedView = views.some((v) => counted.ids.has(v.id));
      const community = typeof p.community_name === "string" ? p.community_name.trim() : "";
      return {
        id: p.id,
        communityName: community,
        memoryNote: typeof p.memory_note === "string" ? p.memory_note.trim() : "",
        // F-R14-15：有案名就顯示「代號 案名」，沒有才只顯示代號；第 16 輪 F-R16-44：代號也沒有時是最後退路「未命名物件」，不留空白列
        label: community ? `${p.id} ${community}` : idText(p.id) || "未命名物件",
        area: areaLabel(p.area_code),
        areaCode: p.area_code || "",
        status: propertyStatus(state, p, live),
        score: scoreLineText(live),
        counted: countedView,
        plannedDate: p.planned_date || "",
        fromNotes: p.from_notes === true,
        // 第 17 輪：上限比對標籤（F-R17-01，只在本機畫面）、加分項（F-R17-04）、實際建坪提醒（F-R17-03）
        capLabel: capLabelLine(p, state.finance),
        bonus: bonusLine(p),
        sizeAlert: sizeCheck(p, state.profile).alert || ""
      };
    });
}

/** 待看物件（還沒看過，筆記狀態是待看或已約），預計看房日早的在前面，沒日期的排後面，同日依代號。 */
export function pendingProperties(state, limit = 5) {
  const rows = propertyRows(state).filter((r) => (r.status === "待看" || r.status === "已約") && !(state.viewings || []).some((v) => v.property_id === r.id && isFlagOn(v.post_saved)));
  rows.sort((a, b) => {
    if (a.plannedDate && !b.plannedDate) return -1;
    if (!a.plannedDate && b.plannedDate) return 1;
    return a.plannedDate.localeCompare(b.plannedDate) || String(a.id).localeCompare(String(b.id));
  });
  return rows.slice(0, limit);
}

/** 首頁要顯示的內容：進度一行、三個大按鈕的文字、待看物件。 */
export function homeModel(state, { week = 0 } = {}) {
  const counted = uniqueCounted(state.viewings, state.properties, state.methodPack).count;
  const goal = state.settings?.goal_commit;
  const goalText = goal === undefined || goal === null || goal === "" ? "未設定" : `${goal} 間`;
  const weekText = week >= 1 ? `(第 ${week} 週)` : "(第 0 週，計畫開始日還沒填)";
  const open = currentOpenViewing(state);
  return {
    progressLine: `已計入 ${counted} 間/目標 ${goalText}${weekText}`,
    visitLabel: open ? `繼續看 ${open.property_id}` : "開始看一間",
    importLabel: "從筆記匯入",
    exportLabel: "匯出到筆記",
    openViewingId: open?.id || null,
    pending: pendingProperties(state, 5),
    coach: coachModel(state)
  };
}

/** 看房結果卡的白話說明：是否計入一間與原因、下一步建議。 */
export function resultSummary(state, viewing, live) {
  const prop = (state.properties || []).find((p) => p.id === viewing?.property_id) || {};
  const c = countViewing(viewing, prop, state.methodPack);
  const counted = uniqueCounted(state.viewings, state.properties, state.methodPack);
  const countsHere = counted.ids.has(viewing?.id);
  const reason = countsHere ? "這間已經符合計入一間的條件。" : c.counts ? "這間符合條件，但同一間物件只算第一次。" : `這次不計入一間：${c.reason || "還沒符合條件"}。`;
  const next = [];
  if (countsHere) next.push("匯出到筆記，讓筆記裡的看房物件總表更新。");
  else next.push("回上一步把沒做完的項目補齊，再存檔一次，就可能計入。");
  next.push("看下一間。");
  return {
    total: scoreLineText(live),
    parts: [
      ["九項初篩", live?.screen?.display ?? ""],
      ["屋況與社區", live?.condition?.display ?? ""],
      ["價格", live?.price?.display ?? ""]
    ],
    countsHere,
    reason,
    countedTotal: counted.count,
    next
  };
}

// ---------------------------------------------------------------------------
// U5 白話用語
// ---------------------------------------------------------------------------

/** 專有名詞與一句白話解釋（第一次出現的頁面，要在頁首加一行小字）。 */
export const GLOSSARY = [
  { term: "待核", gloss: "還不確定,之後要查" },
  { term: "一票否決", gloss: "碰到就直接淘汰的條件" },
  { term: "延伸帶", gloss: "超出原本條件但值得記下的物件" }
];

export function glossText(term) {
  const g = GLOSSARY.find((x) => x.term === term);
  return g ? `${g.term}(${g.gloss})` : term;
}

/** 這段文字裡出現了哪些需要白話解釋的名詞。 */
export function glossTermsIn(text) {
  const t = String(text ?? "");
  return GLOSSARY.filter((g) => t.includes(g.term)).map((g) => g.term);
}

/** 畫面上不得出現程式內部欄位名（英文小寫加底線），回傳找到的字串。 */
export function internalNameHits(text) {
  return [...new Set(String(text ?? "").match(/[a-z]+_[a-z_]+/g) || [])];
}

export { displayItem };
