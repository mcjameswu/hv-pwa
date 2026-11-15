/**
 * 現場路線分站、自動帶入、防漏清單（第 13 輪 E2 到 E5、E7）：純函式，不碰畫面、不寫資料、不連網。
 * 白話：現場那一步不再是一長串題目，而是照路線一站一站走（社區、房間、浴室⋯）。每一站有哪些題目、有沒有大叔提醒，
 * 都寫在方法包的教練階段裡（steps 的 checklist_ids 與 tips），程式只負責「照資料分站」；房間與浴室這種有好幾間的站，
 * 依物件的房數、衛浴數建立對應數量的站，每一間各答一次、各存各的答案與照片，同一題多間的結果取最嚴重的那一間。
 */
import { toFiniteNumber } from "./fields.js";
import { stagesInfo } from "./coach.js";
import { responseValue, aggregateInstanceAnswers, DEFAULT_OPTIONS } from "./counting.js";

// 同一題多間的合成規則放在 counting.js（計分也要用），這裡原樣再匯出，舊的呼叫端不用改。
export { aggregateInstanceAnswers };
import { unitPriceAfterParking } from "./scoring.js";

/** 一個可重複的站最多幾間（防止填錯成 200 房，把畫面撐爆）。 */
export const MAX_INSTANCES = 12;
/** 「其他必做」站的代號：方法包有必做題沒被分配到任何一站時，畫面最後一站自動收容。 */
export const CATCH_ALL_KEY = "extra";
/** 「這站都正常」只認選項裡有這幾個字的題目。 */
export const NORMAL_WORDS = ["正常", "無問題", "符合"];
/** 選到這幾個答案就跳出拍照與一行備註。 */
export const PROBLEM_WORDS = ["有問題", "嚴重"];
/** 使用者自己加的題目預設的選項。 */
export const DEFAULT_CUSTOM_OPTIONS = ["正常", "有問題", "待查"];
/** 沒有選項的題目（勾選、拍照、錄音這類）預設的四個大按鈕。 */
export { DEFAULT_OPTIONS };

/** 一票否決類的題目：答案可能讓整間物件被淘汰，所以「這站都正常」不能替使用者帶過，必須逐題按。 */
export function isVetoItem(item) {
  if (!item) return false;
  return Boolean(item.veto) || item.condition_key === "leak" || /漏水/.test(String(item.text || "")) || ["cashflow", "decision"].includes(item.screen_key);
}

/** 題目的選項：方法包有寫就用；勾選、拍照、錄音這類沒寫選項的題目用預設四個；文字、數字、評分題沒有選項（用輸入框）。 */
export function optionsOf(item) {
  if (Array.isArray(item?.options) && item.options.length) return item.options;
  if (!item?.input_type || ["check", "photo", "voice"].includes(item.input_type)) return DEFAULT_OPTIONS;
  return null;
}

/** 選項裡第一個「正常」類的答案（正常、無問題、符合）；沒有就是 null。 */
export function normalOptionOf(item) {
  const opts = optionsOf(item) || [];
  return NORMAL_WORDS.map((w) => opts.find((o) => o === w)).find(Boolean) || null;
}

export function isProblemValue(v) {
  return PROBLEM_WORDS.includes(String(v ?? ""));
}

// ---------------------------------------------------------------------------
// 路線站的定義（來自方法包）
// ---------------------------------------------------------------------------

/**
 * 從方法包的教練階段找出路線站：有 checklist_ids、而且指到現場題目的步驟，依階段順序與步驟順序排好。
 * 同一題只算在第一次出現的站；現場必做題沒有被任何一站收到時，最後加一站「其他必做」收容，不得漏題。
 * @param {object} pack 方法包
 * @param {object[]} items 這次看房的題目（看房紀錄存的清單快照）
 * @param {string[]} hiddenIds 使用者隱藏的選做題代號（隱藏的選做題不顯示；必做題永遠不能隱藏）
 */
export function routeStations(pack, items, hiddenIds = []) {
  const info = stagesInfo(pack);
  if (!info.enabled) return [];
  const onsite = (Array.isArray(items) ? items : []).filter((i) => i && i.phase === "現場");
  const byId = new Map(onsite.map((i) => [i.id, i]));
  const hidden = new Set(hiddenIds);
  const keep = (i) => i.core === true || !hidden.has(i.id);
  const used = new Set();
  const defs = [];
  for (const stage of info.stages) {
    for (const step of stage.steps) {
      if (!Array.isArray(step.checklist_ids)) continue;
      const ids = step.checklist_ids.filter((id) => byId.has(id) && !used.has(id));
      if (!ids.length) continue;
      ids.forEach((id) => used.add(id));
      defs.push({
        stepId: step.id,
        stageId: stage.id,
        title: step.text,
        how: step.how,
        tips: Array.isArray(step.tips) ? step.tips : [],
        minutes: toFiniteNumber(step.minutes) || 0,
        repeatable: step.repeatable === true,
        countFrom: step.count_from || null,
        label: step.instance_label || "站",
        itemIds: ids,
        items: ids.map((id) => byId.get(id)).filter(keep),
        hiddenItems: ids.map((id) => byId.get(id)).filter((i) => !keep(i)),
        isCatchAll: false
      });
    }
  }
  if (!defs.length) return [];
  const rest = onsite.filter((i) => !used.has(i.id));
  const restCore = rest.filter((i) => i.core === true);
  if (restCore.length) {
    defs.push({
      stepId: CATCH_ALL_KEY,
      stageId: null,
      title: "其他必做",
      how: "方法包的路線沒有排到、但一定要答的題目，都收在這一站。",
      tips: [],
      minutes: 0,
      repeatable: false,
      countFrom: null,
      label: "站",
      itemIds: restCore.map((i) => i.id),
      items: restCore,
      hiddenItems: [],
      isCatchAll: true
    });
  }
  return defs;
}

/** 沒有被任何一站收到的選做題（顯示在到場確認那一頁的「其他選做」裡）。 */
export function unassignedOptional(items, defs, hiddenIds = []) {
  const used = new Set(defs.flatMap((d) => d.itemIds));
  const hidden = new Set(hiddenIds);
  return (Array.isArray(items) ? items : []).filter((i) => i && i.phase === "現場" && i.core !== true && !used.has(i.id) && !hidden.has(i.id));
}

/**
 * 第 15 輪 F-R15-05：沒有被任何一站收到的現場題（站台總覽最下面「其他現場題」一區列出，可直接作答）。
 * 必做題本來會被收進「其他必做」那一站，所以這裡實際上是沒分站的選做題；仍然把必做題也算進來，避免日後規則改動時漏題。
 */
export function unassignedOnsite(items, defs, hiddenIds = []) {
  const used = new Set((Array.isArray(defs) ? defs : []).flatMap((d) => d.itemIds));
  const hidden = new Set(hiddenIds);
  return (Array.isArray(items) ? items : []).filter((i) => i && i.phase === "現場" && !used.has(i.id) && (i.core === true || !hidden.has(i.id)));
}

// ---------------------------------------------------------------------------
// 這一次看房的站（存在看房紀錄的 sites 欄位）
// ---------------------------------------------------------------------------

/** 可重複站依物件的房數或衛浴數建立幾間；沒有數字就先建 1 間。 */
export function defaultInstanceCount(def, property) {
  if (!def.repeatable) return 1;
  const raw = def.countFrom === "baths" ? property?.baths : def.countFrom === "rooms" ? property?.rooms : null;
  const n = toFiniteNumber(raw);
  if (n === null || !(n >= 1)) return 1;
  return Math.min(MAX_INSTANCES, Math.round(n));
}

export function stationKeyOf(def, n) {
  return def.repeatable ? `${def.stepId}.${n}` : def.stepId;
}

export function stationNameOf(def, n) {
  return def.repeatable ? `${def.label} ${n}` : def.title;
}

/** 一個還沒有任何修改的預設站清單。 */
export function buildSites(defs, property) {
  const stations = [];
  const nextN = {};
  for (const def of defs) {
    if (def.isCatchAll) continue; // 其他必做站是自動收容的，不存
    const count = defaultInstanceCount(def, property);
    for (let n = 1; n <= count; n += 1) stations.push({ key: stationKeyOf(def, n), step_id: def.stepId, n, name: stationNameOf(def, n) });
    nextN[def.stepId] = count + 1;
  }
  return { version: 1, stations, next_n: nextN, custom: [] };
}

/**
 * 把存起來的站和方法包的站定義對起來，得到畫面要走的站（依存的順序；方法包新增的站補在後面；方法包拿掉的站不顯示）。
 * 每一站帶著自己的定義 def；最後一站可能是自動加的「其他必做」。
 */
export function resolveStations(sites, defs, property) {
  const byStep = new Map(defs.map((d) => [d.stepId, d]));
  const base = sites && Array.isArray(sites.stations) ? sites : buildSites(defs, property);
  const out = [];
  for (const s of base.stations) {
    const def = byStep.get(s.step_id);
    if (!def) continue;
    out.push({ key: s.key, stepId: s.step_id, n: s.n, name: s.name || stationNameOf(def, s.n), def });
  }
  if (sites && Array.isArray(sites.stations)) {
    // 方法包後來多了新的站：補在後面
    for (const def of defs) {
      if (def.isCatchAll || out.some((s) => s.stepId === def.stepId)) continue;
      const fresh = buildSites([def], property).stations;
      for (const s of fresh) out.push({ key: s.key, stepId: s.step_id, n: s.n, name: s.name, def });
    }
  }
  const catchAll = defs.find((d) => d.isCatchAll);
  if (catchAll) out.push({ key: CATCH_ALL_KEY, stepId: CATCH_ALL_KEY, n: 1, name: catchAll.title, def: catchAll });
  return out;
}

/** 這一站某一題的答案存在看房紀錄的哪個鍵：可重複的站是「題目代號@站代號」，其他站就是題目代號。 */
export function responseKeyOf(itemId, station) {
  return station?.def?.repeatable ? `${itemId}@${station.key}` : itemId;
}

/** 這一站的題目：方法包排給這一站的題目（隱藏的選做題不算）加上使用者自己加的題目。 */
export function stationItems(station, { customAll = [], customHere = [], hiddenIds = [] } = {}) {
  const hidden = new Set(hiddenIds);
  const base = station.def.items.filter((i) => i.core === true || !hidden.has(i.id));
  const custom = [...customAll, ...customHere]
    .filter((c) => c && c.step_id === station.stepId)
    .map((c) => ({ id: c.id, text: c.text, phase: "現場", core: false, options: c.options, custom: true, input_type: "text", category: "自訂" }));
  return [...base, ...custom];
}

// ---------------------------------------------------------------------------
// 答案
// ---------------------------------------------------------------------------

function recOf(viewing, item, station) {
  const key = responseKeyOf(item.id, station);
  return item.custom ? viewing?.custom_answers?.[key] : viewing?.responses?.[key];
}

/** 這一站某一題有沒有答（不適用也算答了）。 */
export function answered(viewing, item, station) {
  return responseValue(recOf(viewing, item, station)).filled;
}

/** 這一站某一題目前的答案文字（沒答是空字串）。 */
export function answerOf(viewing, item, station) {
  const rec = recOf(viewing, item, station) || {};
  return String(rec.value ?? rec.status ?? "");
}

/**
 * 重算可重複站裡每一題的整題答案（存在原本的題目代號那一格，計分與計入一間都只看這一格）。
 * 有任何一間記錄過答案才重算；一間都沒記錄過，就保留原來的整題答案（舊版看房或進階現場頁寫的答案不被洗掉）。
 */
export function recomputeAggregates(responses, stations) {
  const out = { ...(responses || {}) };
  const done = new Set();
  for (const st of stations) {
    if (!st.def.repeatable || done.has(st.stepId)) continue;
    done.add(st.stepId);
    const group = stations.filter((s) => s.stepId === st.stepId);
    for (const item of st.def.items) {
      const recs = group.map((s) => out[`${item.id}@${s.key}`]);
      if (recs.every((r) => !responseValue(r).filled)) continue;
      const agg = aggregateInstanceAnswers(recs, item);
      if (agg) out[item.id] = agg;
      else delete out[item.id];
    }
  }
  return out;
}

/** 刪掉可重複站的一間時，會一起刪掉幾題答案、幾張照片（刪之前列給使用者看）。 */
export function stationImpact(viewing, station) {
  const suffix = `@${station.key}`;
  const answers = Object.keys(viewing?.responses || {}).filter((k) => k.endsWith(suffix)).length + Object.keys(viewing?.custom_answers || {}).filter((k) => k.endsWith(suffix)).length;
  const photos = (Array.isArray(viewing?.photos) ? viewing.photos : []).filter((p) => p && p.station_key === station.key).length;
  return { answers, photos };
}

/**
 * 第 14 輪 F-R14-05：一題在路線上屬於哪一站（「去這一題」要導到那一站）。
 * 回傳站的順序（從 1 開始）；一題不屬於任何一站（例如沒被分配的選做題）回 0。
 * 可重複的站（房間、浴室）導到第一間還沒答這一題的那一間；每一間都答過了就導到第一間。
 */
export function stationIndexForItem(viewing, item, stations) {
  const list = Array.isArray(stations) ? stations : [];
  const owners = list.map((s, i) => ({ s, i })).filter((x) => x.s.def.itemIds.includes(item?.id));
  if (!owners.length) return 0;
  const open = owners.find((x) => !answered(viewing, item, x.s));
  return (open || owners[0]).i + 1;
}

// ---------------------------------------------------------------------------
// E5 防漏清單
// ---------------------------------------------------------------------------

/**
 * 還沒答的必做題清單。phase 可以是看房前、現場、看房後，或 "all"。
 * 現場的題目如果在可重複的站，每一間各自列（寫明是哪一間漏了）；每一項帶著要跳去的位置。
 * @param {object} ctx { viewing, items（這次看房的題目）, defs, stations（resolveStations 的結果）}
 */
export function missingItems({ viewing, items, defs = [], stations = [] }, phase = "all") {
  const out = [];
  const phases = phase === "all" ? ["看房前", "現場", "看房後"] : [phase];
  const step = { 看房前: 2, 現場: 3, 看房後: 4 };
  const list = Array.isArray(items) ? items : [];
  for (const ph of phases) {
    for (const item of list.filter((i) => i.phase === ph && i.core === true)) {
      if (ph !== "現場" || !stations.length) {
        if (!responseValue(viewing?.responses?.[item.id]).filled) out.push({ phase: ph, itemId: item.id, text: item.text, step: step[ph], stationIndex: null, stationKey: null, stationName: "" });
        continue;
      }
      const owners = stations.filter((s) => s.def.itemIds.includes(item.id));
      if (!owners.length) {
        if (!responseValue(viewing?.responses?.[item.id]).filled) out.push({ phase: ph, itemId: item.id, text: item.text, step: 3, stationIndex: null, stationKey: null, stationName: "" });
        continue;
      }
      const def = owners[0].def;
      if (!def.repeatable) {
        if (!responseValue(viewing?.responses?.[item.id]).filled) {
          out.push({ phase: ph, itemId: item.id, text: item.text, step: 3, stationIndex: stations.indexOf(owners[0]) + 1, stationKey: owners[0].key, stationName: owners[0].name });
        }
        continue;
      }
      const recs = owners.map((s) => viewing?.responses?.[`${item.id}@${s.key}`]);
      if (recs.every((r) => !responseValue(r).filled) && responseValue(viewing?.responses?.[item.id]).filled) continue; // 先前整題已答
      owners.forEach((s, i) => {
        if (!responseValue(recs[i]).filled) out.push({ phase: ph, itemId: item.id, text: item.text, step: 3, stationIndex: stations.indexOf(s) + 1, stationKey: s.key, stationName: s.name });
      });
    }
  }
  return out;
}

/** 把遺漏清單換成一行白話文字。 */
export function missingLine(m) {
  return `${m.stationName ? `${m.stationName}：` : ""}${m.text}`;
}

// ---------------------------------------------------------------------------
// E3 這站都正常
// ---------------------------------------------------------------------------

/**
 * 「這站都正常」要填哪些題：該站（那一間）還沒作答，而且選項含「正常」「無問題」「符合」的題目；
 * 已作答的不改，一票否決類的題目不帶過（回傳在 skippedVeto，畫面要提醒使用者逐題按）。
 */
export function normalFillPlan(viewing, station, items) {
  const fill = [];
  const skippedVeto = [];
  for (const item of items) {
    if (answered(viewing, item, station)) continue;
    if (isVetoItem(item)) {
      skippedVeto.push(item.id); // 一票否決類不帶過；還沒答的都算進「要逐題按」的數字（F-R14-16）
      continue;
    }
    const value = normalOptionOf(item);
    if (!value) continue;
    fill.push({ item, value, key: responseKeyOf(item.id, station) });
  }
  return { fill, skippedVeto };
}

// ---------------------------------------------------------------------------
// E4 自動帶入與「請確認」
// ---------------------------------------------------------------------------

/**
 * 方法包裡哪些步驟標了 prefill（import 是從匯入資料算出來，ai_research 是顧問研究帶來的區域功課），
 * 這些步驟的 checklist_ids 就是可以帶入的題目；回傳 { 題目代號: "import" | "ai_research" }。
 */
export function prefillOrigins(pack) {
  const info = stagesInfo(pack);
  const out = {};
  if (!info.enabled) return out;
  for (const stage of info.stages) {
    for (const step of stage.steps) {
      if (!step.prefill || !Array.isArray(step.checklist_ids)) continue;
      for (const id of step.checklist_ids) if (out[id] === undefined) out[id] = step.prefill;
    }
  }
  return out;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

/**
 * 一題能從匯入資料算出的帶入值；算不出來回 null。
 * 規則（依題目在方法包裡的資料，不寫死課程內容）：
 *  - 題目的 screen_key 是 unit_price：開價拆掉車位後除以拆掉車位的坪數（單價，萬/坪）
 *  - screen_key 是 commute 或 walk：區域表的通勤分鐘、步行分鐘
 *  - 題目有 prefill_from（area.欄位）：區域功課的文字，建議答「已查」
 * 回傳 { source, value, status, text }：value 與 status 是使用者按「對」才會存進去的答案，text 是畫面上要顯示的一句話。
 */
export function prefillFor(item, { property, area, origins }) {
  const source = origins?.[item?.id];
  if (!source || !item) return null;
  if (item.screen_key === "unit_price") {
    const r = unitPriceAfterParking(property || {});
    if (r.pending || r.unit === null) return null;
    const v = round2(r.unit);
    return { source, value: v, status: "是", text: `單價算出來是每坪 ${v} 萬（開價拆掉車位後除以坪數）` };
  }
  if (item.screen_key === "commute" || item.screen_key === "walk") {
    const raw = toFiniteNumber(item.screen_key === "commute" ? area?.commute_min : area?.walk_min);
    if (raw === null) return null;
    return { source, value: raw, status: "是", text: `區域資料寫的是 ${raw} 分鐘` };
  }
  const m = /^area\.([a-z_]+)$/.exec(String(item.prefill_from || ""));
  if (m) {
    const raw = area?.[m[1]];
    if (raw === undefined || raw === null || String(raw).trim() === "") return null;
    return { source, value: "已查", status: "已查", text: `區域功課有資料：${String(raw)}（查到的資料已經在手機裡，按「對」就記成已查）` };
  }
  return null;
}
