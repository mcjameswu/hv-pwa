/**
 * DOM-free app controller. Screens call these functions; tests use createMemoryDb.
 */
import { DEFAULT_SCORING, CONDITION_KEYS } from "./defaults.js";
import { propertiesForAgentDraft, listingToProperty as listingToPropertyFn, assessPropertyFromState, isStretchProperty, latestScoreFor, latestViewingFor, latestAnswerClearsVeto, mergedEvidenceFor, VETO_KINDS } from "./scoring.js";
import { runAffordability } from "./affordability.js";
import { countViewing, uniqueCounted, w3OnsiteAudit, sameDaySoftWarning, responseValue } from "./counting.js";
import { encryptBackup, decryptDownloadedFiles, toUint8, restoreMediaItem, validateBackupPayload, looksLikeImportThresholds, mergeBackupKeepLocal, backupDiff, isFreshState, findOrphanMedia, BACKUP_VERSION } from "./backup.js";
import { applyImport, applyGatedThresholdChange, restoreBatch, planImport, thresholdFingerprint } from "./validate.js";
import { validateMethodPack } from "./method-pack.js";
import { agentDraft, canStartAgencyVisit, transferAgent as transferAgentFn, mainPartnersOk, mainPartnerSlotIds, groupComplete, visitGroupComplete, vis14Score, listingDocsRedFlag } from "./module333.js";
import { whitelistUploadPack, buildShareSummary } from "./scanner.js";
import { prepareOutbound, buildUploadPackZip } from "./egress.js";
import { w0PlanStartAllowed, checkpointLabel, adoptedHalfDayHours, w3FullJudge, w6FullJudge, w10FullJudge, retroWriteVeto, rowsHaveStartEnd, uniqueAgencyCount, minutesSplit, profileIsReady } from "./checkpoints.js";
import { cloneValue, mergeAuditLogs, diffDataset } from "./merge.js";
import { PERSISTED_KEYS, PROPERTY_REF_TABLES, emptyPersisted, pickPersisted } from "./persisted.js";
import { normalizeValue, normalizeChanged, capIsBlank, stripFinanceMeta, isFlagOn, toFiniteNumber, FIELD_TABLES, PROPERTY_EDIT_KEYS } from "./fields.js";
import { collectInvariantErrors } from "./invariants.js";
import { getImportSchemaCached, isRealIsoDate } from "./schema.js";
import { applyFinanceMeta, applyNextFinanceMeta, migrateFinanceMeta, isLegacyPlainHash } from "./finance-trust.js";
import { itemsForViewing, packContentHash, snapshotItems, packChecklist } from "./items-for-viewing.js";
import { rankEligible } from "./rank-eligible.js";
import { planNotesProperties, hasThresholdTables, hasNotesProperties, plainImportSummary, unknownAreaCodesOf } from "./notes-import.js";
import { buildNotesPayload, notesFileName } from "./notes-export.js";
import { scanPriceLogEntry, priceLogProblems, PRICE_LOG_AMOUNT_MESSAGE } from "./price-log.js";
import { stagesInfo, normalizeCoach, mergeCoach, stageProgress, localDate } from "./coach.js";
import { routeStations, buildSites, resolveStations, responseKeyOf, recomputeAggregates, normalFillPlan, stationItems, stationImpact, stationKeyOf, stationNameOf, MAX_INSTANCES, DEFAULT_CUSTOM_OPTIONS } from "./sites.js";
import { splitStateToStores, NEVER_IN_SPLIT, hasContent } from "../db.js";

export const WRITE_COMMANDS = [
  "addProperty",
  "updateProperty",
  "setChecklistResponse",
  "takePhoto",
  "takeVisitPhoto",
  "addAudioChunk",
  "appendFinalTranscript",
  "applyBackupPayload",
  "setScoringWeights",
  "saveVisitDraft",
  "scoreCurrent",
  "applyThreshold",
  "confirmImport",
  "restorePreviousBatch",
  "setSelectedSlot",
  "loadMethodPack",
  "confirmFinanceVerified",
  "appendAudit",
  "startVisit",
  "saveVisit",
  "backfillVisit",
  "backfillRecord",
  "unsetMainPartner",
  "listingToProperty",
  "releaseVeto",
  "rescoreAllStale",
  "setMainPartner",
  "transferAgent",
  "addViewing",
  "selectViewing",
  "leaveViewing",
  "confirmOnsiteFields",
  "setCoachStage",
  "setCoachStepDone",
  "completeCoachStage",
  "addStageNote",
  "removeStageNote",
  "addPriceLog",
  "removePriceLog",
  "ensureSites",
  "setSiteResponse",
  "addStation",
  "removeStation",
  "renameStation",
  "moveStation",
  "markStationNormal",
  "addCustomItem",
  "removeCustomItem",
  "setItemHidden",
  "markItemNotApplicable",
  "markMissingPending"
];

export function emptyState() {
  return {
    ...emptyPersisted(),
    scoring: { ...DEFAULT_SCORING, version: "default" },
    boundRecordingViewingId: null,
    sttViewingId: null,
    sttConsented: false,
    recordingExpectedStop: false
  };
}

function freezeDeep(obj, seen = new WeakSet()) {
  if (obj === null || typeof obj !== "object") return obj;
  if (ArrayBuffer.isView(obj) || (typeof ArrayBuffer !== "undefined" && obj instanceof ArrayBuffer)) return obj;
  if (typeof Blob !== "undefined" && obj instanceof Blob) return obj;
  if (seen.has(obj)) return obj;
  seen.add(obj);
  for (const v of Object.values(obj)) freezeDeep(v, seen);
  return Object.freeze(obj);
}

const SINGLETON_STORES = new Set([
  "coach",
  "cooling",
  "methodPack",
  "scoring",
  "financeMeta",
  "session",
  "settings",
  "finance",
  "profile"
]);

/** 只對「是物件的資料列」做轉換；損毀的元素原樣留著，交給不變條件回報，不在這裡拋型別錯誤。 */
function mapRows(rows, fn) {
  return rows.map((x, i) => (x !== null && typeof x === "object" && !Array.isArray(x) ? fn(x, i) : x));
}

function migrateLoaded(s) {
  migrateFinanceMeta(s);
  // 第 13 輪：口袋教練狀態與問價紀錄。舊資料沒有這兩樣就補成空的；教練狀態整理成乾淨的樣子（找不到的步驟代號照樣保留）
  s.coach = normalizeCoach(s.coach);
  if (!Array.isArray(s.priceLog)) s.priceLog = [];
  if (!s.selectedSlot && s.selectedSlotText) {
    s.selectedSlot = { text: s.selectedSlotText, date: null };
  }
  if (!s.scoring) s.scoring = { ...DEFAULT_SCORING, version: "default" };
  else if (typeof s.scoring === "object" && !Array.isArray(s.scoring)) {
    // 舊資料或備份的評分設定缺欄位時補上出貨預設；只補「沒有」的鍵，不覆蓋已有的空值（F9-14）
    for (const [k, v] of Object.entries(DEFAULT_SCORING)) if (s.scoring[k] === undefined) s.scoring[k] = v;
  }
  if (s.currentViewingId && !(s.viewings || []).some((v) => v?.id === s.currentViewingId)) {
    s.currentViewingId = null;
  }
  if (s.currentVisitId && !(s.visits || []).some((v) => v?.id === s.currentVisitId)) {
    s.currentVisitId = null;
  }
  if (s.settings && Object.prototype.hasOwnProperty.call(s.settings, "has_offer")) {
    const { has_offer, ...rest } = s.settings;
    s.settings = rest;
    if (isFlagOn(has_offer)) s.offered = true;
  }
  if (Array.isArray(s.areas)) {
    s.areas = mapRows(s.areas, (a, i) => ({
      ...a,
      id: a.id && String(a.id) !== String(a.area_code) ? a.id : `area-${a.area_code || i}`
    }));
  }
  if (Array.isArray(s.agents)) {
    s.agents = mapRows(s.agents, (a, i) => ({
      ...a,
      id: a.id || `ag-${a.slot_id || i}`
    }));
  }
  if (Array.isArray(s.travel)) {
    s.travel = mapRows(s.travel, (t, i) => ({
      ...t,
      id: t.id || `tr-${t.place_alias || t.area_code || i}`
    }));
  }
  if (Array.isArray(s.slots)) {
    s.slots = mapRows(s.slots, (x, i) => ({
      ...x,
      id: x.id || x.slot_id || `slot-${i}`
    }));
  }
  if (Array.isArray(s.slots) && Array.isArray(s.agents)) {
    const mainIds = new Set(s.slots.filter((x) => x?.status === "列為主要合作").map((x) => x.slot_id || x.id));
    s.agents = mapRows(s.agents, (a) => (mainIds.has(a.slot_id) ? { ...a, status: "列為主要合作" } : a));
    // 反方向：仲介表標了主要合作而格位表沒有的，補進（或更新）格位表，格位表才完整
    for (const a of s.agents) {
      if (a?.status === "列為主要合作" && a.slot_id && !mainIds.has(a.slot_id)) {
        const at = s.slots.findIndex((x) => (x.slot_id || x.id) === a.slot_id);
        if (at >= 0) s.slots[at] = { ...s.slots[at], status: "列為主要合作" };
        else s.slots.push({ id: a.slot_id, slot_id: a.slot_id, status: "列為主要合作" });
        mainIds.add(a.slot_id);
      }
    }
  }
  // 已存訪視的「這一組是否完成」旗標用現行規則重算一次（交核與證照的規則改過，F9-10）
  if (Array.isArray(s.visits)) {
    s.visits = mapRows(s.visits, (v) => {
      if (typeof v.group_complete !== "boolean") return v;
      const now = visitGroupComplete(v);
      return now === v.group_complete ? v : { ...v, group_complete: now };
    });
  }
  if (Array.isArray(s.scores)) {
    s.scores = mapRows(s.scores, (sc, i) => ({
      ...sc,
      id: sc.id || `sc-${sc.property_id || sc.viewing_id || i}`
    }));
  }
  if (s.methodPack) {
    const hash = packContentHash(s.methodPack);
    s.methodPacks = Array.isArray(s.methodPacks) ? s.methodPacks : [];
    if (!s.methodPacks.some((p) => p.hash === hash)) {
      s.methodPacks.push({ hash, pack: s.methodPack });
    }
  }
  for (const table of ["settings", "finance", "profile", "scoring"]) {
    if (s[table] && typeof s[table] === "object") {
      const spec = FIELD_TABLES[table];
      if (!spec) continue;
      const next = {};
      for (const k of Object.keys(s[table])) {
        if (spec[k]) next[k] = s[table][k];
      }
      s[table] = next;
    }
  }
  return s;
}

function stripBytes(rec) {
  if (!rec || typeof rec !== "object") return rec;
  const out = { ...rec };
  delete out.bytes;
  delete out.blob;
  delete out.bytesB64;
  return out;
}

/**
 * 寫進資料庫的媒體紀錄：內容只留 bytes 一份，不留文字編碼（bytesB64）與二進位物件（blob），
 * 否則還原一次資料庫裡就多存一份（F9-01）。
 */
function toStoredMedia(rec) {
  const base = rec.bytesB64 && !(rec.bytes instanceof Uint8Array) ? restoreMediaItem(rec) : rec;
  const out = { ...base };
  delete out.bytesB64;
  delete out.blob;
  return out;
}

function cloneMeta(s) {
  const c = cloneValue({
    ...s,
    media: (s.media || []).map(stripBytes),
    audioChunks: (s.audioChunks || []).map(stripBytes)
  });
  return c;
}

function publicCopy(result) {
  if (result == null || typeof result !== "object") return result;
  return freezeDeep(cloneValue(result));
}

export async function mediaBytes(item, db) {
  if (!item) return new Uint8Array();
  if (item.bytes instanceof Uint8Array) return item.bytes;
  if (item.bytesB64) {
    const restored = restoreMediaItem(item);
    return restored.bytes instanceof Uint8Array ? restored.bytes : toUint8(restored.blob);
  }
  if (item.blob) return toUint8(item.blob);
  if (db && item.id) {
    if (typeof db.get === "function") {
      const rec = (await db.get("media", item.id)) || (await db.get("audioChunks", item.id));
      if (rec) return mediaBytes(rec);
    }
  }
  return new Uint8Array();
}

function persistPayload(s) {
  const payload = pickPersisted(s);
  payload.settings = { ...s.settings, has_offer: s.offered ? "是" : "否" };
  return payload;
}

/** 一般提交的表內容：永遠不含媒體、錄音分片與稽核（它們只走專用通道）。 */
function splitForCommit(s) {
  const split = splitStateToStores(persistPayload(s));
  for (const k of NEVER_IN_SPLIT) delete split[k];
  return split;
}

function sameRows(a, b) {
  const x = a || [];
  const y = b || [];
  return x.length === y.length && JSON.stringify(x) === JSON.stringify(y);
}

/** 進行中訪視的草稿可以寫入的欄位（白名單）。草稿不寫結束時間，也不做主要合作與組別判定。 */
const VISIT_DRAFT_KEYS = [
  "date", "branch_label", "agent_alias", "chain_or_local", "slot_id", "companion", "purpose", "advantage",
  "view_slots", "promo", "clients", "cross_check", "promise", "main_partner", "n_listings", "signed",
  "fee_clause", "private_deal_fee", "exclude_other", "license_ok", "vis14", "vis14_reason", "answers",
  "red_flags", "g1_partner_confirmed", "g1_partner_reason"
];

export function createController({ db, now = () => Date.now(), idgen, testMode } = {}) {
  if (!db) throw new Error("controller 需要資料庫");
  const inTest = testMode ?? Boolean(db && db._data !== undefined);
  let seq = 0;
  // 同一毫秒內兩個分頁各建一個控制器也不會撞號：每個控制器有自己的 4 碼隨機字尾
  const inst = Math.random().toString(36).slice(2, 6);
  const nid = (prefix) => {
    seq += 1;
    if (idgen) return idgen(prefix);
    return `${prefix}-${(toFiniteNumber(now()) ?? 0).toString(36)}-${inst}${seq.toString(36)}`;
  };
  let committed = emptyState();
  let committedSplit = null; // committed 對應的各表內容（快取，換 committed 就要清掉）
  let committedCodes = null; // committed 目前已存在的欄位值違規代碼（舊資料不鎖死用）
  let rev = 0; // 資料庫修訂號：兩個分頁同時寫入時用來擋過期寫入
  let loadStatus = "unloaded";
  let loadToken = 0;
  let tail = Promise.resolve();
  const session = {
    boundRecordingViewingId: null,
    sttViewingId: null,
    sttConsented: false,
    recordingExpectedStop: false
  };

  function viewState() {
    const s = cloneMeta(committed);
    s.boundRecordingViewingId = session.boundRecordingViewingId;
    s.sttViewingId = session.sttViewingId;
    s.sttConsented = session.sttConsented;
    return freezeDeep(s);
  }

  function plainError(e) {
    return { code: e.code, kind: e.kind, table: e.table, rowId: e.rowId, field: e.field, message: e.message };
  }

  /** 提交失敗後的收尾：畫面與磁碟必須一致，所以一律重新讀取。 */
  async function afterCommitFailure(err) {
    if (err && err.code === "STALE") {
      const r = await load();
      return {
        ok: false,
        code: "STALE",
        error: "另一個分頁已更新資料，已重新載入，請再操作一次",
        reloaded: r?.ok !== false
      };
    }
    loadStatus = "stale";
    const r = await load();
    const reloadFailed = r?.ok === false;
    return {
      ok: false,
      persistFailed: true,
      error: reloadFailed ? "資料未保存，且重新讀取失敗，已鎖定寫入" : "資料未保存，已重新讀取",
      detail: err?.message || String(err)
    };
  }

  function command(name, body) {
    const run = tail.then(async () => {
      if (loadStatus !== "loaded") return { ok: false, code: "NOT_LOADED", error: "資料尚未載入成功，已鎖定寫入" };
      const draft = cloneMeta(committed);
      const tx = { puts: [], deletes: [], mediaPuts: [], chunkPuts: [], auditPuts: [], commitOnFailure: false };
      const result = await body(draft, tx);
      if (result?.ok === false && !tx.commitOnFailure) return publicCopy(result);
      migrateLoaded(draft);
      // 不變條件：主鍵與關聯一律擋；欄位值只擋「這次新造成」的違規，舊資料裡本來就有的不鎖死
      const nowErrors = collectInvariantErrors(draft);
      if (committedCodes === null) {
        committedCodes = new Set(collectInvariantErrors(committed).filter((e) => e.kind === "value").map((e) => e.code));
      }
      const blocking = nowErrors.filter((e) => e.kind !== "value" || !committedCodes.has(e.code));
      if (blocking.length) {
        return {
          ok: false,
          invariant: true,
          error: `這次修改無法儲存：${blocking.map((e) => e.message).join("；")}`,
          errors: blocking.map(plainError)
        };
      }
      const prevSplit = committedSplit || (committedSplit = splitForCommit(committed));
      const nextSplit = splitForCommit(draft);
      const changed = {};
      const prevCounts = {};
      for (const [tname, rows] of Object.entries(nextSplit)) {
        prevCounts[tname] = (prevSplit[tname] || []).length;
        if (!sameRows(prevSplit[tname], rows)) changed[tname] = rows;
      }
      for (const tname of Object.keys(changed)) {
        const declared = tx.deletes.some((d) => d.store === tname);
        if (prevCounts[tname] > 0 && changed[tname].length === 0 && !declared) {
          if (tx.replaceAll || SINGLETON_STORES.has(tname)) tx.deletes.push({ store: tname, clear: true });
        }
      }
      const prevAudit = new Set((committed.audit || []).map((a) => a.id));
      for (const rec of draft.audit || []) {
        if (rec.id && !prevAudit.has(rec.id) && !tx.auditPuts.some((x) => x.id === rec.id)) {
          tx.auditPuts.push(rec);
        }
      }
      const hasExtras = tx.puts.length || tx.deletes.length || tx.mediaPuts.length || tx.chunkPuts.length || tx.auditPuts.length;
      if (Object.keys(changed).length || hasExtras) {
        try {
          await db.commitTx({ split: changed, prevCounts }, tx, loadToken, rev);
        } catch (err) {
          return afterCommitFailure(err);
        }
        rev += 1;
      }
      committed = draft;
      committedSplit = nextSplit;
      committedCodes = new Set(nowErrors.filter((e) => e.kind === "value").map((e) => e.code));
      return publicCopy(result && typeof result === "object" ? result : { ok: true });
    });
    tail = run.catch(() => {});
    return run;
  }

  /** 唯讀指令：排在目前所有寫入之後執行，不提交、不改狀態。 */
  function readQuery(body) {
    const run = tail.then(async () => {
      if (loadStatus !== "loaded") return { ok: false, code: "NOT_LOADED", error: "資料尚未載入成功，已鎖定寫入" };
      return body(committed);
    });
    tail = run.catch(() => {});
    return run;
  }

  async function readMeta(store) {
    if (typeof db.getAllMeta === "function") return (await db.getAllMeta(store)) || [];
    return ((await db.getAll(store)) || []).map(stripBytes);
  }

  async function load() {
    loadStatus = "loading";
    try {
      const saved = db.loadAppState ? await db.loadAppState() : null;
      const next = emptyState();
      let nextRev = 0;
      if (saved) {
        nextRev = toFiniteNumber(saved.__rev) || 0;
        Object.assign(next, saved);
        if (isFlagOn(saved.settings?.has_offer) || isFlagOn(saved.offered)) next.offered = true;
      }
      if (db.getAll || db.getAllMeta) {
        next.media = (await readMeta("media")).map(stripBytes);
        next.audioChunks = (await readMeta("audioChunks")).map(stripBytes);
        next.audit = (db.getAll ? await db.getAll("auditLog") : null) || next.audit || [];
      }
      migrateLoaded(next);
      committed = next;
      committedSplit = null;
      committedCodes = null;
      rev = nextRev;
      loadToken += 1;
      if (typeof db.bindGeneration === "function") db.bindGeneration(loadToken);
      loadStatus = "loaded";
      // v1.13.0 以前存的內容指紋是明文 JSON：記憶體裡已在 migrateLoaded 換成新指紋，這裡再把資料庫那一列也改掉，
      // 否則舊的明文會一直留在裝置上，直到下次修改財務才被覆蓋（F-R11-04）
      if (saved && isLegacyPlainHash(saved.finance_meta?.content_hash)) await rewriteLegacyFinanceMeta(next);
      return viewState();
    } catch (err) {
      loadStatus = "failed";
      return { ok: false, code: "LOAD_FAILED", error: err.message || String(err) };
    }
  }

  /** 只改寫財務來源那一列（內容等價、不改修訂號，其他分頁不必重讀）。寫不進去不影響使用：畫面已是新格式。 */
  async function rewriteLegacyFinanceMeta(state) {
    try {
      await db.commitTx({}, { puts: [{ store: "financeMeta", value: { ...state.finance_meta, id: "current" } }] }, loadToken, null);
    } catch {
      /* 下次修改財務時會一併寫入 */
    }
  }

  /** 排在目前所有寫入之後重新讀取（其他分頁更新資料後用）。 */
  function reload() {
    const run = tail.then(() => load());
    tail = run.catch(() => {});
    return run;
  }

  /** 載入時發現的資料問題（舊資料不合新規則、主鍵或關聯有問題），每次重新計算。 */
  function getLoadIssues() {
    const issues = collectInvariantErrors(committed).map(plainError);
    // 提示類（kind "hint"，只提醒、不擋任何操作，也不列入不變條件）：
    // 管理費只有 1 到 99 元的整數，很可能是舊版把「1萬」的「萬」字吃掉的結果（F9-05）
    for (const p of committed.properties || []) {
      const fee = p?.mgmt_fee_yuan;
      if (typeof fee === "number" && Number.isInteger(fee) && fee >= 1 && fee <= 99) {
        issues.push({
          code: `properties|${p.id}|mgmt_fee_yuan|unit_hint`,
          kind: "hint",
          table: "properties",
          rowId: String(p.id),
          field: "mgmt_fee_yuan",
          message: `物件 ${p.id} 的管理費只有幾十元以下（${fee} 元），請確認單位是元`
        });
      }
    }
    return issues;
  }

  function seedForTest(patch) {
    if (!inTest) throw new Error("seedForTest 僅測試可用");
    const next = cloneMeta(committed);
    const incoming = cloneValue(patch || {});
    if (incoming.boundRecordingViewingId !== undefined) session.boundRecordingViewingId = incoming.boundRecordingViewingId;
    if (incoming.sttViewingId !== undefined) session.sttViewingId = incoming.sttViewingId;
    if (incoming.sttConsented !== undefined) session.sttConsented = incoming.sttConsented;
    Object.assign(next, incoming);
    if (incoming.finance && incoming.finance_meta === undefined) delete next.finance_meta;
    migrateLoaded(next);
    committed = next;
    committedSplit = null;
    committedCodes = null;
    loadStatus = "loaded";
    loadToken += 1;
    if (typeof db.bindGeneration === "function") db.bindGeneration(loadToken);
    return viewState();
  }

  async function appendAudit(entry) {
    return command("appendAudit", async (draft, tx) => {
      const rec = { ...entry, at: entry.at || new Date(now()).toISOString(), id: entry.id || nid("au") };
      draft.audit = draft.audit || [];
      draft.audit.push(rec);
      return { ok: true, rec };
    });
  }

  function snapshotCore(pack) {
    return snapshotItems(pack);
  }

  function viewingPackFields(pack) {
    const hash = pack ? packContentHash(pack) : null;
    return {
      method_pack_id: pack?.meta?.id || pack?.id || "generic",
      method_pack_version: pack?.meta?.version || pack?.version || "1",
      pack_hash: hash,
      items_snapshot: snapshotItems(pack),
      core_snapshot: snapshotItems(pack)
    };
  }

  /**
   * 物件欄位正規化。only（一組欄位名稱）只在更新時用：只驗這次有改的欄位，
   * 沒改的欄位即使是舊的不合法值也保留原值、不報錯（F9-13）。
   */
  function normalizePropertyFields(fields, { forUpdate = false, only = null } = {}) {
    const errors = [];
    const out = {};
    for (const k of PROPERTY_EDIT_KEYS) {
      if (forUpdate && !(k in fields)) continue;
      if (only && !only.has(k)) continue;
      if (!(k in fields) && !forUpdate) {
        if (k === "fake_alerts") out[k] = 0;
        else if (k === "parking_included_in_ask") out[k] = null;
        else if (k === "has_parking") out[k] = null;
        else if (k === "fake_price_alt" || k === "community_name") out[k] = "";
        else out[k] = null;
        continue;
      }
      const r = normalizeValue("properties", k, fields[k]);
      if (r.state === "invalid") errors.push({ field: k, message: r.error });
      else if (k === "has_parking") out[k] = r.state === "ok" ? r.value : null;
      else if (k === "parking_included_in_ask") out[k] = r.state === "ok" ? r.value : null;
      else out[k] = r.state === "ok" ? r.value : (k === "fake_alerts" ? 0 : k === "fake_price_alt" || k === "community_name" ? "" : null);
    }
    // 第 13 輪：衛浴數只記錄，不放進 PROPERTY_EDIT_KEYS（那份清單也是評分輸入指紋，放進去會讓所有舊評分變成「待重評」）
    if ("baths" in fields && (!only || only.has("baths"))) {
      const b = normalizeValue("properties", "baths", fields.baths);
      if (b.state === "invalid") errors.push({ field: "baths", message: b.error });
      else out.baths = b.state === "ok" ? b.value : null;
    }
    if (fields.deal_breaker_hits && (!only || only.has("deal_breaker_hits"))) out.deal_breaker_hits = fields.deal_breaker_hits;
    if (fields.condition && (!only || only.has("condition"))) out.condition = fields.condition;
    if (fields.timing_score !== undefined && fields.timing_score !== null && fields.timing_score !== "" && (!only || only.has("timing_score"))) {
      const t = normalizeValue("properties", "timing_score", fields.timing_score);
      if (t.state === "invalid") errors.push({ field: "timing_score", message: "時間點只能是 0、1 或 2" });
    }
    // 假價格警訊與替代解釋是一組：只有這次動到其中一個才檢查
    const fake = out.fake_alerts ?? 0;
    if ((!only || only.has("fake_alerts") || only.has("fake_price_alt")) && fake > 0 && !String(fields.fake_price_alt ?? "").trim()) {
      errors.push({ field: "fake_price_alt", message: "假價格警訊須填替代解釋" });
    }
    const idRaw = fields.id;
    if ((!forUpdate || fields.id !== undefined) && (!only || only.has("id"))) {
      const rawId = idRaw === undefined || idRaw === null ? "" : String(idRaw).trim();
      if (!rawId) errors.push({ field: "id", message: "物件代號不可空白" });
      else {
        const pii = normalizeValue("properties", "id", rawId);
        if (pii.state === "invalid") errors.push({ field: "id", message: pii.error });
        else out.id = rawId;
      }
    }
    return { ok: errors.length === 0, errors, value: out };
  }

  function validatePropertyFields(fields) {
    return normalizePropertyFields(fields).errors;
  }

  function stopSpeechAndConsent() {
    session.sttConsented = false;
    session.sttViewingId = null;
    return { ok: true };
  }

  function gateContext(opts = {}) {
    const allowed = {};
    for (const k of ["reason", "typedB01", "confirmedSuggestions", "startCooling", "fileHash"]) {
      if (opts && Object.prototype.hasOwnProperty.call(opts, k)) allowed[k] = opts[k];
    }
    return {
      ...allowed,
      now: now(),
      cooling: committed.cooling,
      lastAuditAt: lastAuditAt()
    };
  }

  function handleRecordingStopped({ expected = false, saveError = null } = {}) {
    session.boundRecordingViewingId = null;
    const unexpected = !expected;
    return {
      unexpected,
      saveError,
      banner: saveError
        ? `錄音分片保存失敗：${saveError}`
        : unexpected
          ? "錄音非預期停止，已保存已錄分片。請回到畫面後再開始。"
          : null
    };
  }

  /**
   * 新增物件。預設同時開一筆看房紀錄（舊流程都靠這個）；withViewing 為 false 時只建物件、不開看房紀錄，
   * 「看一間」第一步新增物件用，要按「開始看這間」才建立看房紀錄（第 12 輪 U3）。
   */
  async function addProperty(fields = {}, { withViewing = true } = {}) {
    return command("addProperty", async (draft, tx) => {
      stopSpeechAndConsent();
      const norm = normalizePropertyFields(fields);
      if (!norm.ok) {
        return { ok: false, error: norm.errors[0]?.message, errors: norm.errors };
      }
      if (draft.properties.some((x) => x.id === norm.value.id)) {
        // 失敗的新增不留任何寫入（不設 commitOnFailure）
        return { ok: false, error: "物件代號重複", errors: [{ field: "id", message: "物件代號重複" }] };
      }
      if (fields.viewing_id && draft.viewings.some((x) => x.id === fields.viewing_id)) {
        return { ok: false, error: "看房代號重複", errors: [{ field: "viewing_id", message: "看房代號重複" }] };
      }
      const pack = draft.methodPack;
      const p = {
        ...norm.value,
        deal_breaker_hits: fields.deal_breaker_hits || [],
        condition: fields.condition || Object.fromEntries(CONDITION_KEYS.map((k) => [k, null]))
      };
      draft.properties.push(p);
      if (!withViewing) return { ok: true, property: p, viewing: null };
      const v = {
        id: fields.viewing_id || nid("v"),
        property_id: p.id,
        kind: fields.kind || "初看",
        start: new Date(now()).toISOString(),
        recorded_at: new Date(now()).toISOString(),
        responses: fields.responses || {},
        photos: [],
        post_saved: false,
        ...viewingPackFields(pack)
      };
      draft.viewings.push(v);
      draft.currentViewingId = v.id;
      return { ok: true, property: p, viewing: v };
    });
  }

  async function selectViewing(id) {
    return command("selectViewing", async (draft, tx) => {
      const v = draft.viewings.find((x) => x.id === id);
      if (!v) return { ok: false, error: "找不到看房紀錄" };
      draft.currentViewingId = id;
      stopSpeechAndConsent();
      return { ok: true, viewing: v };
    });
  }

  function currentViewing() {
    const v = committed.viewings.find((x) => x.id === committed.currentViewingId) || null;
    return v ? freezeDeep(cloneValue(v)) : null;
  }

  function currentProperty() {
    const v = committed.viewings.find((x) => x.id === committed.currentViewingId);
    if (!v) return null;
    const p = committed.properties.find((x) => x.id === v.property_id) || null;
    return p ? freezeDeep(cloneValue(p)) : null;
  }

  async function leaveViewing() {
    return command("leaveViewing", async (draft, tx) => {
      const leaving = draft.viewings.find((x) => x.id === draft.currentViewingId);
      if (leaving && !leaving.end) leaving.end = new Date(now()).toISOString();
      draft.currentViewingId = null;
      return { ok: true };
    });
  }

  function assessProperty(propertyId) {
    return assessPropertyFromState(committed, propertyId);
  }

  function lastAuditAt() {
    const times = (committed.audit || []).map((a) => Date.parse(a.at)).filter(Number.isFinite);
    return times.length ? Math.max(...times) : null;
  }

  function clockRolledBack() {
    const last = lastAuditAt();
    return last != null && now() < last;
  }

  function syncFinanceMeta(draft, extra = {}) {
    applyNextFinanceMeta(draft, {
      financeSheetSupplied: extra.financeSheetSupplied === true,
      incomingMeta: extra.incomingMeta,
      nextFinance: draft.finance,
      confirmVerified: extra.confirmVerified === true
    });
  }

  function retargetPropertyId(draft, oldId, newId) {
    // 帶物件代號的資料表由 PROPERTY_REF_TABLES 驅動，不再手寫逐表清單（F9-12）
    for (const k of PROPERTY_REF_TABLES) {
      for (const r of draft[k] || []) if (r && r.property_id === oldId) r.property_id = newId;
    }
    // 階段筆記記的物件代號跟著改（階段筆記放在教練狀態裡，不是獨立的資料表）
    if (draft.coach && Array.isArray(draft.coach.stage_notes)) {
      draft.coach.stage_notes = draft.coach.stage_notes.map((n) => (n && n.property_code === oldId ? { ...n, property_code: newId } : n));
    }
    for (const l of draft.listings) {
      if (l.property_id === oldId || l.id === oldId) {
        l.property_id = newId;
        if (l.id === oldId) l.id = newId;
      }
    }
  }

  async function updateProperty(id, patch, { changedKeys } = {}) {
    return command("updateProperty", async (draft, tx) => {
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { ok: false, error: "更新內容必須是物件" };
      const p = draft.properties.find((x) => x.id === id);
      if (!p) return { ok: false, error: "找不到物件" };
      const keys = changedKeys || Object.keys(patch || {});
      const filtered = {};
      for (const k of keys) if (k in patch) filtered[k] = patch[k];
      // 代號沒有改就不用再驗一次代號（舊資料的代號即使不合現行規則，也不擋其他欄位的修改）
      if ("id" in filtered && String(filtered.id ?? "").trim() === p.id) delete filtered.id;
      const norm = normalizePropertyFields({ ...p, ...filtered }, { forUpdate: true, only: new Set(Object.keys(filtered)) });
      if (!norm.ok) return { ok: false, errors: norm.errors, error: norm.errors[0]?.message };
      const oldId = p.id;
      const newId = patch.id !== undefined && keys.includes("id") ? String(patch.id).trim() : oldId;
      if (!newId) return { ok: false, error: "物件代號不可空白" };
      if (newId !== oldId && draft.properties.some((x) => x.id === newId && x !== p)) {
        return { ok: false, error: "物件代號重複" };
      }
      const target = draft.properties.find((x) => x.id === id);
      if (!target) return { ok: false, error: "找不到物件" };
      // 屋單的代號本身若等於舊物件代號，會跟著改成新代號；新代號已被別的屋單用掉就不能改
      if (newId !== oldId && (draft.listings || []).some((l) => l && l.id === oldId) && (draft.listings || []).some((l) => l && l.id === newId)) {
        return { ok: false, error: "屋單代號重複" };
      }
      Object.assign(target, norm.value);
      if (newId !== oldId) {
        retargetPropertyId(draft, oldId, newId);
        target.id = newId;
      }
      return { ok: true, property: target };
    });
  }

  async function saveFieldInputs(propertyId, patch) {
    return updateProperty(propertyId, patch);
  }

  /**
   * 寫一題清單回應。viewingId 有傳就寫到指定的那一間看房（畫面顯示的那一間），而且必須對得到看房；
   * 沒傳才用目前選定的看房（F9-08：不再因為切換看房的存檔還沒完成而寫到前一間）。
   */
  async function setChecklistResponse(itemId, value, viewingId) {
    return command("setChecklistResponse", async (draft, tx) => {
      const viewing = draft.viewings.find((x) => x.id === (viewingId || draft.currentViewingId));
      if (!viewing) return { ok: false, error: viewingId ? "找不到指定的看房紀錄" : "尚未選定看房" };
      viewing.responses = viewing.responses || {};
      if (value == null || value === "" || (typeof value === "object" && !value.status && (value.value === "" || value.value == null))) {
        delete viewing.responses[itemId];
      } else {
        viewing.responses[itemId] = typeof value === "object" ? value : { status: value, value };
      }
      return { ok: true };
    });
  }

  function checklistSource(viewing) {
    return itemsForViewing(committed, viewing);
  }

  async function takeVisitPhoto({ blob, name = "photo.jpg", visitId } = {}) {
    return command("takeVisitPhoto", async (draft, tx) => {
      const id = visitId || draft.currentVisitId;
      const visit = draft.visits.find((x) => x.id === id);
      if (!visit) return { ok: false, error: "尚未選定門市" };
      let bytes;
      try {
        bytes = await toUint8(blob);
      } catch {
        return { ok: false, error: "照片無法讀取，請重拍" };
      }
      if (!bytes || bytes.length === 0) return { ok: false, error: "照片是空的，請重拍" };
      const rec = {
        id: nid("m"),
        visit_id: visit.id,
        type: "photo",
        kind: "visit_doc",
        name,
        size: bytes?.length || 0,
        bytes
      };
      tx.mediaPuts.push(rec);
      visit.photos = visit.photos || [];
      visit.photos.push({ at: new Date(now()).toISOString(), name, bytes: rec.size, id: rec.id });
      visit.doc_photo = name;
      visit.doc_photo_id = rec.id;
      draft.media.push(stripBytes(rec));
      return { ok: true, media: stripBytes(rec) };
    });
  }

  async function takePhoto({ blob, name = "photo.jpg", viewingId, stationKey, itemId } = {}) {
    return command("takePhoto", async (draft, tx) => {
      const vid = viewingId || draft.currentViewingId;
      const viewing = draft.viewings.find((x) => x.id === vid);
      if (!viewing) return { ok: false, error: "尚未選定看房" };
      let bytes;
      try {
        bytes = await toUint8(blob);
      } catch {
        return { ok: false, error: "照片無法讀取，請重拍" };
      }
      if (!bytes || bytes.length === 0) return { ok: false, error: "照片是空的，請重拍" };
      const rec = {
        id: nid("m"),
        viewing_id: viewing.id,
        type: "photo",
        name,
        size: bytes?.length || 0,
        bytes,
        // 第 13 輪 E7：現場照片記下是哪一站（哪一間房、哪一間浴室）、哪一題；沒有指定就和以前一樣
        ...(stationKey ? { station_key: String(stationKey) } : {}),
        ...(itemId ? { item_id: String(itemId) } : {})
      };
      tx.mediaPuts.push(rec);
      viewing.photos = viewing.photos || [];
      viewing.photos.push({ at: new Date(now()).toISOString(), name, bytes: rec.size, id: rec.id, ...(stationKey ? { station_key: String(stationKey) } : {}), ...(itemId ? { item_id: String(itemId) } : {}) });
      draft.media.push(stripBytes(rec));
      return { ok: true, media: stripBytes(rec) };
    });
  }

  function startRecording(viewingId) {
    const vid = viewingId || committed.currentViewingId;
    session.boundRecordingViewingId = vid;
    return { ok: true, viewingId: vid };
  }

  async function addAudioChunk({ blob, viewingId } = {}) {
    return command("addAudioChunk", async (draft, tx) => {
      const vid = viewingId || session.boundRecordingViewingId || draft.currentViewingId;
      if (!draft.viewings.some((x) => x.id === vid)) return { ok: false, error: "錄音沒有對應的看房紀錄" };
      let bytes;
      try {
        bytes = await toUint8(blob);
      } catch {
        return { ok: false, error: "錄音分片無法讀取" };
      }
      if (!bytes || bytes.length === 0) return { ok: true, skipped: true };
      const rec = {
        id: nid("a"),
        viewing_id: vid,
        type: "audio",
        at: new Date(now()).toISOString(),
        size: bytes?.length || 0,
        bytes
      };
      tx.chunkPuts.push(rec);
      draft.audioChunks.push(stripBytes(rec));
      return { ok: true, chunk: stripBytes(rec) };
    });
  }

  function stopRecording() {
    session.boundRecordingViewingId = null;
    return { ok: true };
  }

  async function appendFinalTranscript(text, viewingId) {
    return command("appendFinalTranscript", async (draft, tx) => {
      const vid = viewingId || session.sttViewingId;
      if (!vid) return { ok: false, error: "逐字稿沒有對應的看房紀錄" };
      const viewing = draft.viewings.find((x) => x.id === vid);
      if (!viewing) return { ok: false, error: "逐字稿沒有對應的看房紀錄" };
      if (!String(text ?? "").trim()) return { ok: true, skipped: true };
      viewing.transcript = `${viewing.transcript || ""}${text || ""}`;
      draft.transcripts.push({ id: nid("t"), viewing_id: vid, text, at: new Date(now()).toISOString() });
      return { ok: true };
    });
  }

  /**
   * 在佇列內呼叫：資料庫的修訂號和這個分頁記的不同，代表另一個分頁已經改過資料，先重新讀取。
   * 白話：兩個分頁開著同一份資料時，這個分頁記憶體裡的內容可能是舊的；匯出與打包前先對一下，
   * 不同就重讀，才不會「資料檔是舊的、照片是新的」而讓備份還原不了（F9-04）。
   */
  async function resyncIfStale() {
    if (typeof db.readRev !== "function") return { ok: true, resynced: false };
    const dbRev = await db.readRev();
    if (dbRev === rev) return { ok: true, resynced: false };
    const r = await load();
    if (r?.ok === false) return { ok: false, error: "資料已被另一個分頁更新，重新讀取失敗，已鎖定寫入" };
    return { ok: true, resynced: true };
  }

  /**
   * 匯出備份是排在目前所有寫入之後的唯讀指令：資料檔與媒體檔一定來自同一個修訂號。
   *  1. 資料庫修訂號和這個分頁記的不同，先重新讀取，結果標 resynced: true
   *  2. 取完狀態與媒體後再讀一次修訂號；這段期間又變了就整個重來，最多 3 次，3 次都不一致就放棄
   *  3. 匯出前檢查「能不能還原」；有問題仍匯出，但附上提醒，不因舊資料裡的一個壞值就讓人備份不了。
   *     對不到看房的照片與錄音（資料本身有孤兒）不放進媒體包，只在資料檔留一份清單，並提醒
   */
  async function exportBackup(passphrase) {
    const snap = await readQuery(async () => {
      let resynced = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const sync = await resyncIfStale();
        if (!sync.ok) return sync;
        if (sync.resynced) resynced = true;
        const state = committed;
        const stateRev = rev;
        const payload = persistPayload(state);
        if (db.getAll) {
          try {
            payload.media = await db.getAll("media");
            payload.audioChunks = await db.getAll("audioChunks");
          } catch {
            return { ok: false, error: "讀取照片或錄音失敗，備份沒有產生" };
          }
        }
        if (typeof db.readRev === "function" && (await db.readRev()) !== stateRev) continue; // 讀取期間又被改過，整個重來
        const warnings = [];
        const orphans = findOrphanMedia(payload);
        if (orphans.length) {
          const orphanKeys = new Set(orphans.map((o) => `${o.kind}:${o.row.id}`));
          payload.orphanMedia = orphans.map((o) => {
            const meta = { ...o.row };
            delete meta.bytes;
            delete meta.blob;
            delete meta.bytesB64;
            return { ...meta, table: o.kind };
          });
          payload.media = (payload.media || []).filter((m) => !orphanKeys.has(`media:${m.id}`));
          payload.audioChunks = (payload.audioChunks || []).filter((m) => !orphanKeys.has(`audioChunks:${m.id}`));
          warnings.push(`有 ${orphans.length} 筆照片或錄音對不到看房紀錄，只留在備份的清單裡，還原時不會寫入`);
        }
        const closed = validateBackupPayload({ version: BACKUP_VERSION, ...payload });
        if (!closed.ok) warnings.push(`目前資料裡有不合規格的地方，備份可能無法完整還原：${closed.error}`);
        return { ok: true, payload, resynced, warning: warnings.length ? warnings.join("；") : null, orphanCount: orphans.length };
      }
      return { ok: false, error: "資料正在被另一個分頁修改，請稍後再匯出" };
    });
    if (!snap.ok) return snap;
    const packed = await encryptBackup(snap.payload, passphrase);
    if (!packed.ok) return packed;
    return {
      ...packed,
      ...(snap.resynced ? { resynced: true } : {}),
      ...(snap.orphanCount ? { orphanCount: snap.orphanCount } : {}),
      ...(snap.warning ? { restoreWarning: snap.warning } : {})
    };
  }

  /**
   * 還原備份。本機和備份只要有任何內容不同（本機獨有、備份獨有、兩邊都有但內容不同，涵蓋物件、看房、評分、
   * 訪視、屋單、媒體、錄音分片，以及設定、財務、輪廓、評分設定、區域、仲介、通勤表），沒有指定 mode 時
   * 不會默默處理，而是先回 needsChoice 與差異（diff），讓使用者二選一（F9-03）：
   *  - mode "replace"：完全取代。備份沒有的表就是空的，本機多出的照片與錄音分片在同一個交易內刪除
   *  - mode "merge"：合併。主鍵聯集、相同主鍵以本機為準；門檻一律以本機為準，所以不需要冷靜期
   * 例外：兩邊完全相同回 unchanged（不寫入）；本機是全新裝置（沒有任何資料）直接取代。
   * 備份裡的冷靜期紀錄一律不採用（F9-02）：本機有就保留本機的，本機沒有就是沒有。
   */
  async function applyBackupPayload(incomingRaw, opts = {}) {
    return command("applyBackupPayload", async (draft, tx) => {
      const ctx = gateContext(opts);
      const localCooling = draft.cooling;
      const incomingFull = incomingRaw && typeof incomingRaw === "object" ? { ...incomingRaw } : incomingRaw;
      const incoming = {};
      for (const k of PERSISTED_KEYS) {
        if (incomingFull && incomingFull[k] !== undefined) incoming[k] = incomingFull[k];
      }
      if (incomingFull?.version) incoming.version = incomingFull.version;
      if (incomingFull?.backup_version) incoming.backup_version = incomingFull.backup_version;
      for (const k of ["media", "audioChunks"]) {
        if (Array.isArray(incoming[k]) && incoming[k].some((r) => r === null || typeof r !== "object" || Array.isArray(r))) {
          return { ok: false, error: "備份內容損毀：媒體或錄音分片有資料列不是有效的資料" };
        }
      }
      const payloadCheck = validateBackupPayload({ ...incoming, version: incoming.version || incoming.backup_version || incomingFull?.version }, { schema: opts.schema, previous: thresholdsOf(draft) });
      if (!payloadCheck.ok) return payloadCheck;

      const diff = backupDiff(draft, incoming);
      let mode = opts.mode || null;
      if (!mode) {
        if (isFreshState(draft)) {
          mode = "replace";
        } else if (diff.total === 0) {
          return { ok: true, unchanged: true, message: "備份內容與目前相同" };
        } else {
          const localOnly = {};
          for (const k of ["viewings", "properties", "media", "audioChunks", "visits"]) localOnly[k] = diff.rows[k].localOnly;
          return {
            ok: false,
            needsChoice: true,
            diff,
            localOnly,
            message: "這台手機的資料和備份的內容不同",
            error: "這台手機的資料和備份的內容不同，請選「先另存現況再完全取代」或「合併」"
          };
        }
      }
      const restoreRec = {
        id: nid("au"),
        type: "backup_restore",
        at: new Date(ctx.now).toISOString(),
        reason: ctx.reason || "",
        mode
      };

      if (mode === "merge") {
        for (const k of ["properties", "viewings", "scores", "visits", "listings", "transcripts", "vetoReleases", "drafts", "priceLog"]) {
          draft[k] = mergeBackupKeepLocal(draft[k], incoming[k]);
        }
        draft.coach = mergeCoach(draft.coach, incoming.coach);
        const localMediaIds = new Set((draft.media || []).map((m) => m.id));
        const localChunkIds = new Set((draft.audioChunks || []).map((m) => m.id));
        for (const rec of incoming.media || []) {
          if (!localMediaIds.has(rec.id) && hasContent(rec)) tx.mediaPuts.push(toStoredMedia(rec));
        }
        for (const rec of incoming.audioChunks || []) {
          if (!localChunkIds.has(rec.id) && hasContent(rec)) tx.chunkPuts.push(toStoredMedia(rec));
        }
        draft.media = mergeBackupKeepLocal(draft.media, (incoming.media || []).map(stripBytes));
        draft.audioChunks = mergeBackupKeepLocal(draft.audioChunks, (incoming.audioChunks || []).map(stripBytes));
        draft.audit = mergeAuditLogs(draft.audit || [], [...(incoming.audit || []), restoreRec], { nextId: () => nid("au"), source: "backup" });
        migrateLoaded(draft);
        const orphanCount = Array.isArray(incomingFull?.orphanMedia) ? incomingFull.orphanMedia.length : 0;
        return { ok: true, mode, ...(orphanCount ? { orphanCount } : {}), data: incoming };
      }

      tx.replaceAll = true;
      const gated = applyGatedThresholdChange(
        thresholdsOf(draft),
        {
          finance: incoming.finance || {},
          profile: incoming.profile || {},
          scoring: incoming.scoring || {},
          settings: incoming.settings || {},
          areas: incoming.areas,
          agents: incoming.agents,
          travel: incoming.travel
        },
        { now: ctx.now, reason: ctx.reason, cooling: draft.cooling, lastAuditAt: ctx.lastAuditAt, fullReplace: true, b01Source: "backup", fullCross: looksLikeImportThresholds(incoming) }
      );
      if (!gated.ok) {
        if (ctx.startCooling && gated.requiresCooling && gated.cooling) {
          tx.commitOnFailure = true;
          draft.cooling = gated.cooling;
          return {
            ok: false,
            startedCooling: true,
            requiresCooling: true,
            cooling: gated.cooling,
            message: gated.message,
            error: gated.error
          };
        }
        return {
          ok: false,
          requiresCooling: Boolean(gated.requiresCooling),
          cooling: gated.cooling,
          message: gated.message,
          error: gated.error
        };
      }
      const mergedAudit = mergeAuditLogs(
        draft.audit || [],
        [...(incoming.audit || []), ...(gated.audit || []), restoreRec],
        { nextId: () => nid("au"), source: "backup" }
      );
      // 本機多出的照片與錄音分片：同一個交易內逐筆刪除
      const incomingMediaIds = new Set((incoming.media || []).map((m) => m.id));
      for (const m of draft.media || []) {
        if (m && !incomingMediaIds.has(m.id)) tx.deletes.push({ store: "media", id: m.id });
      }
      const incomingChunkIds = new Set((incoming.audioChunks || []).map((m) => m.id));
      for (const m of draft.audioChunks || []) {
        if (m && !incomingChunkIds.has(m.id)) tx.deletes.push({ store: "audioChunks", id: m.id });
      }
      // 備份沒有的表就是空的，不沿用本機舊資料
      const blank = emptyState();
      for (const k of PERSISTED_KEYS) {
        draft[k] = incoming[k] !== undefined ? incoming[k] : blank[k];
      }
      draft.audit = mergedAudit;
      // 備份裡的冷靜期紀錄一律不採用：冷靜期是「這台裝置上這個調鬆動作」的等待紀錄（F9-02）
      draft.cooling = gated.b13?.consumeCooling ? null : localCooling;
      migrateLoaded(draft);
      const bakMeta = incoming.finance_meta && typeof incoming.finance_meta === "object" ? incoming.finance_meta : incoming.finance || {};
      syncFinanceMeta(draft, {
        financeSheetSupplied: true,
        incomingMeta: { ...bakMeta, content_hash: bakMeta.content_hash || "__missing__" },
        nextFinance: draft.finance
      });
      for (const rec of incoming.media || []) {
        if (hasContent(rec)) tx.mediaPuts.push(toStoredMedia(rec));
      }
      draft.media = (incoming.media || []).map(stripBytes);
      for (const rec of incoming.audioChunks || []) {
        if (hasContent(rec)) tx.chunkPuts.push(toStoredMedia(rec));
      }
      draft.audioChunks = (incoming.audioChunks || []).map(stripBytes);
      const orphanCount = Array.isArray(incomingFull?.orphanMedia) ? incomingFull.orphanMedia.length : 0;
      return { ok: true, mode, ...(orphanCount ? { orphanCount } : {}), data: { ...incoming, audit: mergedAudit } };
    });
  }

  async function importBackupFiles(files, passphrase, opts = {}) {
    const r = await decryptDownloadedFiles(files, passphrase);
    if (!r.ok) return r;
    return applyBackupPayload(r.data, opts);
  }

  async function setScoringWeights(weights) {
    return command("setScoringWeights", async (draft, tx) => {
      const allowed = {};
      for (const k of ["w_screen", "w_condition", "w_price"]) {
        if (k in (weights || {})) allowed[k] = weights[k];
      }
      const extra = Object.keys(weights || {}).filter((k) => !["w_screen", "w_condition", "w_price"].includes(k));
      if (extra.length) {
        return { ok: false, error: "E04 到 E11 須走門檻變更與冷靜期" };
      }
      const next = { ...draft.scoring, ...allowed };
      const wParsed = ["w_screen", "w_condition", "w_price"].map((k) => toFiniteNumber(next[k]));
      if (wParsed.some((w) => w == null || w < 0)) {
        return { ok: false, error: "權重不得為負" };
      }
      const sum = wParsed[0] + wParsed[1] + wParsed[2];
      if (Math.abs(sum - 1) > 0.001) return { ok: false, error: "三組權重加總必須等於 1" };
      // 存解析後的數字（不存原字串）；版本字串加序號，同一毫秒也不會相同
      next.w_screen = wParsed[0];
      next.w_condition = wParsed[1];
      next.w_price = wParsed[2];
      seq += 1;
      next.version = `w-${new Date(now()).toISOString()}-${inst}${seq.toString(36)}`;
      draft.scoring = next;
      draft.audit.push({ type: "scoring_version", version: next.version, at: new Date(now()).toISOString(), id: nid("au") });
      return { ok: true, scoring: next };
    });
  }

  /**
   * 寫一筆評分紀錄。權重版本與輸入指紋都沒變就原地更新；有變就新增一筆並把舊的標成被取代，
   * 舊權重版本的紀錄因此不會被蓋掉。
   */
  function recordScore(draft, prop, viewing) {
    const live = assessPropertyFromState({ ...draft, scores: [] }, prop.id);
    const { stale: _stale, ...rest } = live;
    const stamp = new Date(now()).toISOString();
    const body = {
      property_id: prop.id,
      viewing_id: viewing.id,
      ...rest,
      decision: live.action === "淘汰" || live.veto_hits?.length ? live.action || "淘汰" : live.decision,
      scored_at: stamp,
      recorded_at: viewing.recorded_at
    };
    const last = latestScoreFor(draft.scores, { propertyId: prop.id, viewingId: viewing.id });
    const sameViewing = last && (last.viewing_id === viewing.id || last.id === viewing.id);
    if (sameViewing && last.weights_version === live.weights_version && last.input_fingerprint === live.input_fingerprint) {
      const idx = draft.scores.findIndex((s) => s === last);
      const rec = { ...body, id: last.id };
      draft.scores[idx] = rec;
      return rec;
    }
    if (sameViewing) last.superseded = true;
    const rec = { ...body, id: nid("sc") };
    draft.scores.push(rec);
    return rec;
  }

  async function scoreCurrent(viewingId) {
    return command("scoreCurrent", async (draft, tx) => {
      const v = draft.viewings.find((x) => x.id === (viewingId || draft.currentViewingId));
      if (!v) return { ok: false, error: "尚未選定看房" };
      const prop = draft.properties.find((p) => p.id === v.property_id);
      if (!prop) return { ok: false, error: "找不到物件" };
      const live = assessPropertyFromState(draft, prop.id);
      if (live.fake_price_need_alt) {
        return { ok: false, error: "假價格警訊須填替代解釋", score: live };
      }
      const viewing = draft.viewings.find((x) => x.id === v.id);
      viewing.post_saved = true;
      // 結束時間只寫一次真實時間；重評不改，也不再多加 1 分鐘
      if (!viewing.end) viewing.end = new Date(now()).toISOString();
      const rec = recordScore(draft, prop, viewing);
      return { ok: true, score: rec };
    });
  }

  /** 把所有「有評分但過期」的物件，用最新一次看房重評一次（舊紀錄保留）。 */
  async function rescoreAllStale() {
    return command("rescoreAllStale", async (draft, tx) => {
      let count = 0;
      for (const p of draft.properties) {
        const latest = latestViewingFor(draft, p.id);
        if (!latest) continue;
        const assessed = assessPropertyFromState(draft, p.id);
        if (!assessed.stale || assessed.fake_price_need_alt) continue;
        recordScore(draft, p, latest);
        count += 1;
      }
      return { ok: true, count };
    });
  }

  /** 解除一項一票否決：要寫理由；最新一次看房對那一題必須已經改答成非否決值。 */
  async function releaseVeto(propertyId, kind, reason) {
    return command("releaseVeto", async (draft, tx) => {
      const text = String(reason ?? "").trim();
      if (!text) return { ok: false, error: "請寫下解除否決的理由" };
      const p = draft.properties.find((x) => x.id === propertyId);
      if (!p) return { ok: false, error: "找不到物件" };
      if (!VETO_KINDS.includes(kind)) return { ok: false, error: "不認得這種否決" };
      const ev = mergedEvidenceFor(draft, propertyId);
      if (!ev.veto.some((e) => e.kind === kind && !e.released)) {
        return { ok: false, error: "這間物件目前沒有這項需要解除的否決" };
      }
      if (!latestAnswerClearsVeto(draft, propertyId, kind)) {
        return { ok: false, error: "最新一次看房仍是否決的答案，請先在最新看房改答，再來解除" };
      }
      const latest = ev.latest;
      const at = new Date(now()).toISOString();
      draft.vetoReleases = draft.vetoReleases || [];
      draft.vetoReleases.push({ id: nid("vr"), property_id: propertyId, kind, released_viewing_id: latest.id, reason: text, at });
      draft.audit.push({ id: nid("au"), type: "veto_release", property_id: propertyId, kind, reason: text, at });
      return { ok: true };
    });
  }

  async function applyThreshold(patch, opts = {}) {
    return command("applyThreshold", async (draft, tx) => {
      if (patch && typeof patch === "object" && ["areas", "agents", "travel"].some((k) => k in patch)) {
        return { ok: false, error: "區域、仲介與通勤表請用匯入修改" };
      }
      const ctx = gateContext(opts);
      const patchIn = { ...patch };
      if (patchIn.settings && "self_entered_cap" in patchIn.settings && !(patchIn.finance && "budget_cap_total" in patchIn.finance)) {
        const { self_entered_cap, ...rest } = patchIn.settings;
        patchIn.settings = rest;
      }
      const gated = applyGatedThresholdChange(
        thresholdsOf(draft),
        patchIn,
        {
          now: ctx.now,
          reason: ctx.reason,
          cooling: draft.cooling,
          coolingUntil: draft.cooling?.until,
          lastAuditAt: ctx.lastAuditAt,
          b01Source: "typed"
        }
      );
      if (!gated.ok) {
        if (ctx.startCooling && gated.cooling) {
          tx.commitOnFailure = true;
          draft.cooling = gated.cooling;
          return { ok: false, startedCooling: true, cooling: gated.cooling, message: gated.message };
        }
        return gated;
      }
      draft.settings = { ...gated.state.settings };
      // 只對這次有改的財務欄位報錯；舊資料裡本來就不合法、這次沒碰的欄位保留原值（F9-13）
      const finNorm = normalizeChanged("finance", stripFinanceMeta({ ...(draft.finance || {}) }), stripFinanceMeta({ ...gated.state.finance }));
      if (!finNorm.ok) {
        const first = finNorm.errors[0];
        return { ok: false, error: first.message, errors: finNorm.errors };
      }
      const fin = finNorm.value;
      draft.finance = fin;
      draft.profile = { ...gated.state.profile };
      if (gated.state.scoring) draft.scoring = gated.state.scoring;
      if (gated.audit) {
        for (const a of gated.audit) draft.audit.push({ ...a, id: a.id || nid("au") });
      }
      if (gated.cooling === null) draft.cooling = null;
      if (patchIn.finance && "budget_cap_total" in patchIn.finance) {
        const cap = normalizeValue("finance", "budget_cap_total", draft.finance.budget_cap_total);
        draft.settings.self_entered_cap = cap.state === "ok";
      }
      if (patchIn.settings && "commute_measured_min" in patchIn.settings) {
        const m = normalizeValue("settings", "commute_measured_min", patchIn.settings.commute_measured_min);
        draft.settings.commute_measured_min = m.state === "ok" ? m.value : null;
      }
      syncFinanceMeta(draft);
      return gated;
    });
  }

  async function startCoolingFromChange(patch, reason, extra = {}) {
    return applyThreshold(patch, { reason, startCooling: true, ...extra });
  }

  function thresholdsOf(s) {
    return {
      settings: s.settings,
      finance: s.finance,
      finance_meta: s.finance_meta,
      profile: s.profile,
      scoring: s.scoring,
      areas: s.areas,
      agents: s.agents,
      travel: s.travel
    };
  }

  function currentThresholds() {
    return thresholdsOf(committed);
  }

  /** 待看物件計畫給畫面看的樣子：不帶整份物件資料，只帶筆數、代號、衝突與待核清單。 */
  function notesView(plan) {
    return {
      summary: { ...plan.summary },
      created: plan.created.map((c) => c.id),
      updated: plan.updated.map((u) => ({ id: u.id, fields: [...u.fields] })),
      conflicts: plan.conflicts.map((c) => ({ ...c })),
      pending: plan.pending.map((p) => ({ index: p.index, code: p.code, errors: p.errors.map((e) => ({ ...e })) })),
      ignoredFields: [...plan.ignoredFields],
      changed: plan.changed
    };
  }

  function previewImport(data, schema, opts = {}) {
    const props = hasNotesProperties(data) ? data.properties : null;
    const notesPlan = props ? planNotesProperties(committed.properties, props, { choices: opts.notesChoices }) : null;
    // 只有待看物件、沒有任何匯入表的檔案，不走門檻檢查（沒有門檻資料要驗），也不會觸發冷靜期
    const base = hasThresholdTables(data) || !props ? previewThresholds(data, schema, opts) : emptyThresholdPreview();
    return {
      ...base,
      notesImport: notesPlan ? notesView(notesPlan) : null,
      notesChanged: notesPlan ? notesPlan.changed : false,
      plainSummary: plainImportSummary({
        plan: notesPlan,
        diff: base.diff,
        unknownAreaCodes: unknownAreaCodesOf(notesPlan, [...(base.merged?.areas || []), ...(Array.isArray(data?.areas) ? data.areas : [])])
      })
    };
  }

  function emptyThresholdPreview() {
    return {
      ok: true,
      errors: [],
      warnings: [],
      notes: [],
      pending: [],
      b01RequiresManual: false,
      b01Differs: false,
      canStartCooling: false,
      unchanged: true,
      diff: [],
      plan: null,
      merged: currentThresholds()
    };
  }

  function previewThresholds(data, schema, opts = {}) {
    const current = currentThresholds();
    const plan = planImport(current, data, {
      preview: true,
      now: now(),
      reason: opts.reason,
      cooling: committed.cooling,
      coolingUntil: committed.cooling?.until,
      schema: schema || getImportSchemaCached(),
      lastAuditAt: lastAuditAt()
    });
    const snapshot = plan.snapshot || current;
    // 與套用時同一種比對（涵蓋七張表）：只改區域行情、仲介或通勤表時不能被判成沒有變更。
    // 預覽時上限保留現值，所以檔案帶了不同的上限也要算有變更（F9-15）
    const b01Differs = plan.report?.b01Differs === true;
    const unchanged = thresholdFingerprint(current) === thresholdFingerprint(snapshot) && !b01Differs;
    const diff = diffDataset(current, snapshot);
    // 私密：差異清單只說「檔案內有新的值」，不帶任何數字
    if (b01Differs) diff.push({ table: "finance", key: "budget_cap_total", kind: "b01_pending" });
    return {
      ...plan.report,
      plan,
      merged: snapshot,
      unchanged,
      diff
    };
  }

  /**
   * 匯入表的門檻部分（設定、財務、輪廓、區域、評分、仲介、通勤）：和第 11 輪以前完全相同的寫入流程，
   * 只是抽成函式，讓同一份檔案裡的待看物件可以在同一個交易裡一起寫（要嘛全寫、要嘛全不寫）。
   */
  async function applyThresholdImport(draft, tx, data, opts) {
    const ctx = gateContext(opts);
    const current = thresholdsOf(draft);
    const recomputed = planImport(current, data, {
      preview: false,
      typedB01: ctx.typedB01,
      confirmedSuggestions: ctx.confirmedSuggestions,
      now: ctx.now,
      reason: ctx.reason,
      cooling: draft.cooling,
      coolingUntil: draft.cooling?.until,
      schema: getImportSchemaCached(),
      lastAuditAt: ctx.lastAuditAt
    });
    if (opts.plan) {
      if (opts.plan.baseFingerprint !== recomputed.baseFingerprint || opts.plan.incomingFingerprint !== recomputed.incomingFingerprint) {
        return { ok: false, error: "資料已變更，請重新預覽", message: "資料已變更，請重新預覽" };
      }
    }
    const last = (draft.importBatches || []).at(-1);
    const applied = applyImport(current, data, {
      typedB01: ctx.typedB01,
      confirmedSuggestions: ctx.confirmedSuggestions,
      now: ctx.now,
      reason: ctx.reason,
      cooling: draft.cooling,
      coolingUntil: draft.cooling?.until,
      lastImportHash: last?.hash,
      fileHash: ctx.fileHash,
      lastAuditAt: ctx.lastAuditAt
    });
    if (!applied.ok) {
      if (ctx.startCooling && applied.cooling) {
        tx.commitOnFailure = true;
        draft.cooling = applied.cooling;
        return { ok: false, startedCooling: true, cooling: applied.cooling, message: applied.message };
      }
      return applied;
    }
    const sameState = JSON.stringify(thresholdsOf(draft)) === JSON.stringify(thresholdsOf({
      ...draft,
      settings: applied.state?.settings || draft.settings,
      finance: applied.state?.finance || draft.finance,
      profile: applied.state?.profile || draft.profile,
      scoring: applied.state?.scoring || draft.scoring,
      areas: applied.state?.areas || draft.areas,
      agents: applied.state?.agents || draft.agents,
      travel: applied.state?.travel || draft.travel
    }));
    const importedKeys = data?._importedKeys;
    const financeSheetSupplied = Array.isArray(importedKeys) ? importedKeys.includes("finance") : true;
    const incomingMeta = {
      origin: data?.origin || data?.source_type,
      source: data?.source,
      as_of: data?.as_of || data?.finance_as_of || data?.finance?.finance_as_of || null,
      verified: data?.verified,
      source_type: data?.source_type
    };
    if (applied.unchanged || sameState) {
      syncFinanceMeta(draft, { financeSheetSupplied, incomingMeta, nextFinance: draft.finance });
      return { ...applied, unchanged: true };
    }
    if (!draft.importBatches.length) {
      draft.importBatches.push({
        id: "baseline",
        baseline: true,
        at: new Date(ctx.now).toISOString(),
        snapshot: cloneValue({
          settings: current.settings,
          finance: current.finance,
          finance_meta: current.finance_meta,
          profile: current.profile,
          scoring: current.scoring,
          areas: current.areas,
          agents: current.agents,
          travel: current.travel
        })
      });
    }
    draft.settings = applied.state.settings || {};
    draft.finance = stripFinanceMeta(applied.state.finance || {});
    syncFinanceMeta(draft, {
      financeSheetSupplied,
      incomingMeta,
      nextFinance: draft.finance
    });
    draft.profile = applied.state.profile || {};
    draft.scoring = applied.state.scoring || draft.scoring;
    draft.areas = applied.state.areas || [];
    draft.agents = applied.state.agents || [];
    draft.travel = applied.state.travel || [];
    if (applied.audit) {
      for (const a of applied.audit) draft.audit.push({ ...a, id: a.id || nid("au") });
    }
    if (applied.cooling === null) draft.cooling = null;
    draft.importBatches.push({
      id: ctx.fileHash ? String(ctx.fileHash).slice(0, 12) : nid("imp"),
      hash: ctx.fileHash,
      at: new Date(ctx.now).toISOString(),
      snapshot: cloneValue({
        settings: draft.settings,
        finance: draft.finance,
        finance_meta: draft.finance_meta,
        profile: draft.profile,
        scoring: draft.scoring,
        areas: draft.areas,
        agents: draft.agents,
        travel: draft.travel
      })
    });
    return applied;
  }

  async function confirmImport(data, opts = {}) {
    return command("confirmImport", async (draft, tx) => {
      const props = hasNotesProperties(data) ? data.properties : null;
      const notesPlan = props ? planNotesProperties(draft.properties, props, { choices: opts.notesChoices }) : null;
      const result = hasThresholdTables(data) || !props ? await applyThresholdImport(draft, tx, data, opts) : { ok: true, unchanged: true };
      if (result?.ok === false) return result;
      if (!notesPlan) return result;
      const view = notesView(notesPlan);
      if (!notesPlan.changed) return { ...result, notesImport: view };
      draft.properties = notesPlan.next;
      // 稽核只記筆數，不記任何欄位內容
      draft.audit.push({
        id: nid("au"),
        type: "notes_import",
        at: new Date(now()).toISOString(),
        created: notesPlan.created.length,
        updated: notesPlan.updated.length,
        conflicts: notesPlan.conflicts.length,
        pending: notesPlan.pending.length
      });
      return { ...result, unchanged: false, notesImport: view };
    });
  }

  /**
   * 匯出到筆記（S3）：唯讀入口。白名單組好內容後一定要過出口閘門（收件對象 notes），沒過就不交出任何內容。
   * 回傳 { ok, approved, prepared, text, filename, summary }；畫面只能把它交給 deliverNotesFile。
   */
  async function buildNotesExport() {
    return readQuery(async () => {
      const sync = await resyncIfStale();
      if (!sync.ok) return sync;
      const state = committed;
      const nowMs = toFiniteNumber(now()) ?? Date.now();
      const { payload, skippedStretch, skippedNotes } = buildNotesPayload(state, { nowMs });
      const prepared = prepareOutbound({ recipient: "notes", state, notesPayload: payload });
      if (!prepared.ok) {
        // 找出是哪些內容被擋（每一塊各自再過一次閘門，其他塊清空），讓使用者知道要改哪裡
        const bare = { ...payload, properties: [], areas: [], stage_notes: [], coach: { current_stage: null, stages: [], steps_done: [], custom_items: [] } };
        const hit = (part) => !prepareOutbound({ recipient: "notes", state, notesPayload: { ...bare, ...part } }).ok;
        const blocked = payload.properties.filter((row) => hit({ properties: [row] })).map((row) => row.property_code);
        const blockedNotes = payload.stage_notes.filter((n) => hit({ stage_notes: [n] }));
        const blockedCustom = payload.coach.custom_items.filter((c) => hit({ coach: { ...bare.coach, custom_items: [c] } })).map((c) => c.text);
        const blockedPriceLogs = priceLogProblems(payload, state.finance || {});
        const where = [
          blocked.length ? `物件 ${blocked.join("、")}` : "",
          blockedNotes.length ? `階段筆記（${blockedNotes.map((n) => `${n.stage_id} ${String(n.at).slice(0, 10)}`).join("、")}）` : "",
          blockedCustom.length ? `自訂題目（${blockedCustom.join("、")}）` : "",
          blockedPriceLogs.length ? `問價紀錄（${blockedPriceLogs.map((p) => `物件 ${p.property_code} ${p.date} ${p.kind}`).join("、")}）` : ""
        ].filter(Boolean);
        return {
          ok: false,
          error: where.length
            ? `匯出內容被擋下：${where.join("、")} 的文字含有不能送出的內容，請先改寫或刪掉再匯出`
            : "匯出內容被擋下：含有不能送出的內容",
          hits: prepared.hits,
          blockedProperties: blocked,
          blockedStageNotes: blockedNotes.map((n) => ({ stage_id: n.stage_id, at: n.at })),
          blockedCustomItems: blockedCustom,
          blockedPriceLogs: blockedPriceLogs.map((p) => ({ property_code: p.property_code, date: p.date, kind: p.kind }))
        };
      }
      return {
        ok: true,
        approved: true,
        prepared,
        text: prepared.text,
        filename: notesFileName(nowMs),
        summary: {
          properties: payload.properties.length,
          areas: payload.areas.length,
          counted: payload.counted_total,
          skippedStretch,
          skippedNotes,
          stageNotes: payload.stage_notes.length,
          priceLogs: payload.properties.reduce((n, p) => n + p.price_log.length, 0)
        }
      };
    });
  }

  async function restorePreviousBatch(opts = {}) {
    return command("restorePreviousBatch", async (draft, tx) => {
      const ctx = gateContext(opts);
      const prev = (draft.importBatches || []).at(-2);
      if (!prev) return { ok: false, error: "沒有上一批", message: "沒有上一批" };
      tx.replaceAll = true;
      const r = restoreBatch(
        thresholdsOf(draft),
        prev.snapshot,
        {
          now: ctx.now,
          reason: ctx.reason,
          cooling: draft.cooling,
          coolingUntil: draft.cooling?.until,
          lastAuditAt: ctx.lastAuditAt,
          allowIncomplete: !!prev.baseline
        }
      );
      if (!r.ok) {
        if (ctx.startCooling && r.cooling) {
          tx.commitOnFailure = true;
          draft.cooling = r.cooling;
          return { ...r, startedCooling: true, requiresCooling: true };
        }
        return r;
      }
      draft.settings = r.state.settings || {};
      draft.finance = stripFinanceMeta(r.state.finance || {});
      draft.profile = r.state.profile || {};
      draft.scoring = r.state.scoring || draft.scoring;
      draft.areas = r.state.areas || [];
      draft.agents = r.state.agents || [];
      draft.travel = r.state.travel || [];
      if (prev.snapshot?.finance_meta) {
        applyFinanceMeta(draft, prev.snapshot.finance_meta);
      } else {
        syncFinanceMeta(draft, { financeSheetSupplied: true, incomingMeta: prev.snapshot, nextFinance: draft.finance });
      }
      if (r.audit) {
        for (const a of r.audit) draft.audit.push({ ...a, id: a.id || nid("au") });
      }
      if (r.cooling === null) draft.cooling = null;
      draft.importBatches = draft.importBatches.slice(0, -1);
      return r;
    });
  }

  async function loadMethodPack(pack) {
    return command("loadMethodPack", async (draft, tx) => {
      const v = validateMethodPack(pack);
      if (!v.ok) return v;
      draft.methodPack = pack;
      const hash = packContentHash(pack);
      draft.methodPacks = Array.isArray(draft.methodPacks) ? draft.methodPacks : [];
      if (!draft.methodPacks.some((p) => p.hash === hash)) draft.methodPacks.push({ hash, pack });
      draft.audit.push({ type: "method_pack_load", version: pack.meta?.version || pack.version, at: new Date(now()).toISOString(), id: nid("au") });
      return { ok: true };
    });
  }

  function selectedSlotLabel() {
    return String(committed.selectedSlot?.text || committed.selectedSlotText || "").trim();
  }

  async function setSelectedSlot(text, date = null) {
    return command("setSelectedSlot", async (draft, tx) => {
      const t = String(text || "").trim();
      draft.selectedSlotText = t;
      draft.selectedSlot = { text: t, date };
      return { ok: true, selectedSlotText: t };
    });
  }

  function agentDraftText() {
    const prepared = prepareOutbound({ recipient: "agent", state: committed });
    return prepared.ok ? prepared.text : "";
  }

  function scanAgentDraft(userText) {
    const slots = selectedSlotLabel();
    const prepared = prepareOutbound({
      recipient: "agent",
      state: committed,
      userText: userText == null ? undefined : userText
    });
    return {
      text: prepared.ok ? prepared.text : "",
      copyable: !!slots && prepared.ok,
      scan: prepared,
      prepared
    };
  }

  function sharePack(property, viewing) {
    const p = property || currentProperty() || {};
    if (!p || !String(p.id || "").trim()) {
      return { ok: false, error: "物件代號不可空白", hits: [{ level: "block", field: "property_code", rule: "missing_property_id" }] };
    }
    if (isStretchProperty(p, committed.finance)) {
      return { ok: false, error: "延伸帶不進分享摘要" };
    }
    const v = viewing || currentViewing() || {};
    const packed = whitelistUploadPack(buildShareSummary(p, v));
    const prepared = prepareOutbound({
      recipient: "share",
      state: committed,
      property: p,
      viewing: v
    });
    // 被擋時只回 { ok: false, hits }，不帶任何摘要欄位
    if (!prepared.ok) return { ok: false, hits: prepared.hits };
    return { ...packed, ...prepared, ok: true };
  }

  /**
   * 上傳包由控制器的唯讀入口產生，畫面不得自己組檔：
   * 延伸帶物件不產生；只能選「這次看房」的現場照片；內容與清單都要過出口閘門；
   * 照片內容從資料庫讀出（狀態裡的媒體只是目錄），讀不到就失敗。
   */
  async function buildUploadPack({ propertyId, viewingId, mediaIds = [] } = {}) {
    return readQuery(async () => {
      // 另一個分頁改過資料就先重讀，用最新的資料打包（F9-04）
      const sync = await resyncIfStale();
      if (!sync.ok) return sync;
      const state = committed;
      const p = state.properties.find((x) => x.id === propertyId);
      const v = state.viewings.find((x) => x.id === viewingId && x.property_id === propertyId);
      if (!p || !v) return { ok: false, error: "請先選定物件與看房紀錄" };
      if (isStretchProperty(p, state.finance)) return { ok: false, error: "延伸帶物件不產生上傳包" };
      const gate = prepareOutbound({ recipient: "upload", state, property: p, viewing: v });
      if (!gate.ok) return { ok: false, error: "上傳內容被擋", hits: gate.hits };
      const picked = state.media.filter((m) => mediaIds.includes(m.id) && m.viewing_id === v.id && m.type === "photo" && m.kind !== "visit_doc");
      if (picked.length !== mediaIds.length) return { ok: false, error: "只能選這次看房的現場照片" };
      const files = [];
      for (const m of picked) {
        // 讀取當下出錯（例如資料庫忙線或裝置空間問題）與「資料庫裡本來就沒有內容」都回白話錯誤，不讓例外直接衝到畫面（F9-19 第 8 點）
        let bytes;
        try {
          bytes = await mediaBytes(m, db);
        } catch {
          return { ok: false, error: `照片 ${m.name || m.id} 內容讀不到（讀取失敗），請稍後重試；一直失敗請重新拍攝或還原備份` };
        }
        if (!bytes.length) return { ok: false, error: `照片 ${m.name || m.id} 內容讀不到，請重新拍攝或還原備份` };
        files.push({ id: m.id, name: m.name, viewing_id: m.viewing_id, property_id: v.property_id, type: m.type, kind: m.kind, bytes });
      }
      return buildUploadPackZip({ property: p, viewing: v, selectedMedia: files, gate, state });
    });
  }

  function countSelected() {
    const v = currentViewing();
    const p = currentProperty();
    return countViewing(v, p, committed.methodPack);
  }

  function homeCheckpoints(week, extra = {}) {
    const countedInfo = uniqueCounted(committed.viewings, committed.properties, committed.methodPack);
    const counted = countedInfo.count;
    const half = adoptedHalfDayHours(committed.settings);
    const state = committed;
    const onsiteFlags = w3OnsiteAudit(state.viewings, state.methodPack, state.properties);
    const retro = (committed.viewings || []).some((v) =>
      retroWriteVeto({
        paperMakeup: v.paper_makeup,
        makeupPhotoExists: !!v.makeup_photo_id && (committed.media || []).some((m) => m.id === v.makeup_photo_id),
        recordedAt: v.recorded_at || v.end,
        occurredAt: v.occurred_at || v.start
      })
    );
    // 是否類一律用 isFlagOn（只認 true 與「是」），「否」「待核」「空白」都不算完成
    const st = committed.settings || {};
    const w0 = w0PlanStartAllowed({
      httpsLive: (extra.secureContext ?? extra.httpsLive ?? false) === true,
      capFilled: !capIsBlank(committed.finance),
      methodPackLoaded: Boolean(committed.methodPack),
      imported: (committed.importBatches || []).length > 0,
      offlineVerified: isFlagOn(st.offline_verified),
      selfEnteredCap: isFlagOn(st.self_entered_cap),
      partnerConsent: isRealIsoDate(st.partner_consent_at) && String(st.partner_consent_how || "").trim() !== "",
      commuteMeasured: toFiniteNumber(st.commute_measured_min) != null && toFiniteNumber(st.commute_measured_min) > 0,
      agenciesSelected: isFlagOn(st.agencies_selected),
      slotPlanned: isFlagOn(st.slot_planned)
    });
    return {
      counted,
      minutes: minutesSplit(committed.viewings, committed.visits, countedInfo.ids),
      half,
      w0,
      w3: checkpointLabel(w3FullJudge(counted, half, {
        retroWrite: retro,
        onsiteShort: onsiteFlags.some((f) => f.wronglyCounted),
        agenciesVisited: uniqueAgencyCount(committed.visits),
        minutesMeasured: rowsHaveStartEnd(committed.viewings) && rowsHaveStartEnd(committed.visits),
        profileReady: profileIsReady(committed.profile),
        mainPartnersCount: mainPartnerSlotIds(committed.slots || [], committed.agents || []).size,
        remainingWeeksEstimate: committed.settings.remaining_weeks_estimate,
        goalCommitChoice: committed.settings.goal_commit_choice,
        courseBBlankRatio: committed.settings.course_b_blank_ratio
      }), { currentWeek: week, targetWeek: 3, actual: counted }),
      w6: checkpointLabel(w6FullJudge(counted, half, {
        retroWrite: retro,
        weightsVersioned: !!(committed.scoring?.version && committed.scoring.version !== "default"),
        overtimeUnconsented: (() => {
          const cap = toFiniteNumber(committed.settings.weekly_hour_cap);
          const used = toFiniteNumber(committed.settings.overtime_hours_used);
          if (cap == null || used == null) return false;
          if (used <= cap) return false;
          return !isFlagOn(committed.settings.overtime_consent);
        })(),
        s1Complete: isFlagOn(committed.settings.s1_complete),
        s2Complete: isFlagOn(committed.settings.s2_complete),
        courseBDrafts: committed.settings.course_b_drafts,
        w3GoalRechecked: isFlagOn(committed.settings.w3_goal_rechecked)
      }), { currentWeek: week, targetWeek: 6, actual: counted }),
      w10: checkpointLabel(w10FullJudge(counted, toFiniteNumber(committed.settings.goal_commit), {
        gapDocumented: isFlagOn(committed.settings.gap_documented),
        unknownAsPass: committed.settings.w10_unknown_as_pass,
        nonSelfAction: committed.settings.w10_nonself_action,
        sopV2: committed.settings.sop_v2_complete,
        profileFinal: committed.settings.profile_final,
        courseBComplete: committed.settings.course_b_complete,
        combatSelfAssess: committed.settings.combat_self_assess,
        s3Complete: committed.settings.s3_complete,
        courseBCoreUnknown: committed.settings.course_b_core_unknown
      }), { currentWeek: week, targetWeek: 10, actual: counted }),
      onsiteFlags,
      retro,
      clockRollback: clockRolledBack(),
      clockRollbackHint: clockRolledBack() ? "偵測到裝置時鐘倒退，冷靜期不會因此提前到期" : null,
      sameDay: sameDaySoftWarning(committed.viewings, { halfDayHours: half ?? 4 })
    };
  }

  function affordFor(property) {
    const total = normalizeValue("properties", "ask_total", property?.ask_total);
    const mgmt = normalizeValue("properties", "mgmt_fee_yuan", property?.mgmt_fee_yuan);
    const age = normalizeValue("properties", "age", property?.age);
    return runAffordability({
      total: total.state === "ok" ? total.value : null,
      finance: committed.finance,
      finance_meta: committed.finance_meta,
      mgmtFeeYuan: mgmt.state === "ok" ? mgmt.value : null,
      ageYears: age.state === "ok" ? age.value : null,
      capBlank: capIsBlank(committed.finance)
    });
  }

  async function confirmFinanceVerified() {
    return command("confirmFinanceVerified", async (draft, tx) => {
      syncFinanceMeta(draft, { confirmVerified: true, nextFinance: draft.finance });
      return { ok: true, finance: draft.finance, finance_meta: draft.finance_meta };
    });
  }

  async function startVisit(checkedGates, opts = {}) {
    return command("startVisit", async (draft, tx) => {
      const cap = capIsBlank(draft.finance);
      const r = canStartAgencyVisit(checkedGates, { capBlank: cap, askingStretch: opts.askingStretch });
      if (!r.ok) return { ok: false, error: `還缺：${r.missing.join("、")}`, missing: r.missing };
      const open = draft.visits.find((v) => v.id === draft.currentVisitId && !v.end)
        || draft.visits.find((v) => v.start && !v.end);
      if (open) {
        draft.currentVisitId = open.id;
        return { ok: true, visit: open, reused: true };
      }
      const vis = {
        id: nid("vis"),
        start: new Date(now()).toISOString(),
        gates: [...(checkedGates || [])]
      };
      draft.visits.push(vis);
      draft.currentVisitId = vis.id;
      return { ok: true, visit: vis };
    });
  }

  async function saveVisit(visitId, patch = {}, changedKeys) {
    return command("saveVisit", async (draft, tx) => {
      const id = visitId || draft.currentVisitId;
      const vis = draft.visits.find((x) => x.id === id);
      if (!vis) return { ok: false, error: "尚未開始門市" };
      if (vis.end) return { ok: false, error: "訪視已結束" };
      if (!vis.start) return { ok: false, error: "尚未開始門市" };
      let nextPatch = patch;
      // 格位代號先去空白、轉大寫再用，g1-1 與 G1-1 才不會變成兩個格位；有填但格式不對一律回錯誤，不論有沒有勾主要合作（F9-19 第 6 點）
      if (patch.slot_id !== undefined && patch.slot_id !== null) {
        const slot = String(patch.slot_id).trim().toUpperCase();
        if (slot !== "" && !SLOT_ID_RE.test(slot)) {
          return { ok: false, error: SLOT_FORMAT_ERROR, errors: [{ field: "slot_id", message: SLOT_FORMAT_ERROR }] };
        }
        nextPatch = { ...nextPatch, slot_id: slot };
      }
      let targetSlotId = nextPatch.slot_id ?? vis.slot_id;
      if (typeof targetSlotId === "string") targetSlotId = targetSlotId.trim().toUpperCase();
      if (patch.n_listings !== undefined) {
        const n = normalizeValue("visits", "n_listings", patch.n_listings);
        if (n.state === "invalid") return { ok: false, error: n.error, errors: [{ field: "n_listings", message: n.error }] };
        nextPatch = { ...nextPatch, n_listings: n.state === "ok" ? n.value : null };
      }
      if (isFlagOn(nextPatch.main_partner)) {
        if (!SLOT_ID_RE.test(String(targetSlotId ?? ""))) {
          return { ok: false, error: SLOT_FORMAT_ERROR };
        }
        const nextSlots = draft.slots.map((s) =>
          s.slot_id === targetSlotId || s.id === targetSlotId ? { ...s, status: "列為主要合作" } : s
        );
        const exists = nextSlots.some((s) => s.slot_id === targetSlotId || s.id === targetSlotId);
        const trial = exists ? nextSlots : [...nextSlots, { id: targetSlotId || vis.id, slot_id: targetSlotId, status: "列為主要合作" }];
        const chk = mainPartnersOk(trial, draft.agents);
        if (!chk.ok) return { ok: false, error: chk.message };
        if (chk.needConfirmG1 && (!isFlagOn(nextPatch.g1_partner_confirmed) || !(nextPatch.g1_partner_reason || "").trim())) {
          return { ok: false, error: "第一組列主要合作須勾確認並填理由" };
        }
      }
      const visit = draft.visits.find((x) => x.id === vis.id);
      const keys = changedKeys || Object.keys(nextPatch);
      for (const k of keys) {
        if (k in nextPatch) visit[k] = nextPatch[k];
      }
      visit.slot_id = targetSlotId;
      visit.end = nextPatch.end || visit.end || new Date(now()).toISOString();
      if (isFlagOn(nextPatch.main_partner)) {
        const nextSlots = draft.slots.map((s) =>
          s.slot_id === targetSlotId || s.id === targetSlotId ? { ...s, status: "列為主要合作" } : s
        );
        if (!nextSlots.some((s) => s.slot_id === targetSlotId || s.id === targetSlotId)) {
          nextSlots.push({ id: targetSlotId || visit.id, slot_id: targetSlotId, status: "列為主要合作" });
        }
        draft.slots = nextSlots;
        draft.agents = (draft.agents || []).map((a) => (a.slot_id === targetSlotId ? { ...a, status: "列為主要合作" } : a));
      }
      // 沒有（或格式不對的）格位就不算任何一組完成，不再默默當成第一組；規則集中在 visitGroupComplete
      visit.group_complete = visitGroupComplete(visit);
      draft.currentVisitId = visit.id;
      if (nextPatch.offered !== undefined) draft.offered = isFlagOn(nextPatch.offered);
      return { ok: true, visit };
    });
  }

  /**
   * 進行中訪視的草稿：畫面每次輸入變動就存，重繪、切分頁回來都能把已填的值帶回。
   * 只更新白名單欄位；已結束的訪視不接受草稿寫入（要修正走補登與稽核流程）。
   */
  async function saveVisitDraft(visitId, patch = {}) {
    return command("saveVisitDraft", async (draft) => {
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { ok: false, error: "草稿內容必須是物件" };
      const id = visitId || draft.currentVisitId;
      const vis = draft.visits.find((x) => x.id === id);
      if (!vis) return { ok: false, error: "尚未開始門市" };
      if (vis.end) return { ok: false, error: "訪視已結束，不接受草稿寫入" };
      for (const k of VISIT_DRAFT_KEYS) {
        if (!(k in patch)) continue;
        if (k === "n_listings") {
          // 草稿裡打到一半的數字（例如只打了負號）先略過，不讓整份草稿存不進去
          if (patch[k] === "" || patch[k] === null) vis[k] = null;
          else {
            const n = normalizeValue("visits", "n_listings", patch[k]);
            if (n.state === "ok") vis[k] = n.value;
          }
        } else {
          vis[k] = patch[k];
        }
      }
      return { ok: true, visit: vis };
    });
  }

  /** 紙本補登可以帶進紀錄的門市欄位（白名單）；其他欄位一律丟掉。 */
  const BACKFILL_VISIT_KEYS = ["brand", "branch_label", "agent_alias", "slot_id", "n_listings", "chain_or_local"];

  /**
   * 紙本補登（共用實作）：理由、發生時間、照片內容都要齊全。照片真的寫進媒體表，
   * 紀錄只記「對得到的照片代號」，不再由程式自己填「已附時間戳照片」。
   */
  async function doBackfill(draft, tx, { target = "visit", reason, occurredAt, photoBlob, photoName = "paper.jpg", propertyId, fields = {} } = {}) {
    const text = String(reason ?? "").trim();
    if (!text) return { ok: false, error: "紙本補登須填理由" };
    if (target !== "visit" && target !== "viewing") return { ok: false, error: "補登對象必須是門市訪視或看房" };
    const occ = Date.parse(occurredAt);
    const nowMs = new Date(now()).getTime();
    if (!Number.isFinite(occ)) return { ok: false, error: "發生時間格式不對" };
    if (occ > nowMs) return { ok: false, error: "發生時間不可晚於現在" };
    if (nowMs - occ > 24 * 3600 * 1000) return { ok: false, error: "紙本補登須在 24 小時內並附時間戳照片" };
    const bytes = photoBlob === undefined || photoBlob === null ? null : await toUint8(photoBlob);
    if (!bytes || bytes.length === 0) return { ok: false, error: "紙本補登須附時間戳照片（照片內容不可為空）" };
    const atIso = new Date(occ).toISOString();
    const recordedAt = new Date(nowMs).toISOString();
    const media = { id: nid("m"), type: "photo", kind: "paper_makeup", name: String(photoName || "paper.jpg"), size: bytes.length, bytes };
    let record;
    if (target === "viewing") {
      const prop = draft.properties.find((p) => p.id === propertyId);
      if (!prop) return { ok: false, error: "紙本補登看房須指定既有物件" };
      const prior = draft.viewings.some((v) => v.property_id === prop.id);
      record = {
        id: nid("v"),
        property_id: prop.id,
        kind: prior ? "複看" : "初看",
        start: atIso,
        responses: {},
        photos: [],
        post_saved: false,
        ...viewingPackFields(draft.methodPack)
      };
      media.viewing_id = record.id;
    } else {
      const picked = {};
      for (const k of BACKFILL_VISIT_KEYS) if (k in (fields || {})) picked[k] = fields[k];
      const endMs = Date.parse(fields?.end);
      record = {
        ...picked,
        id: nid("vis"),
        kind: "紙本補登",
        start: atIso,
        end: Number.isFinite(endMs) && endMs >= occ && endMs <= nowMs ? new Date(endMs).toISOString() : recordedAt
      };
      media.visit_id = record.id;
    }
    Object.assign(record, { paper_makeup: true, occurred_at: atIso, recorded_at: recordedAt, makeup_photo_id: media.id, paper_makeup_reason: text });
    tx.mediaPuts.push(media);
    draft.media.push(stripBytes(media));
    if (target === "viewing") {
      draft.viewings.push(record);
      draft.currentViewingId = record.id;
    } else {
      draft.visits.push(record);
      draft.currentVisitId = record.id;
    }
    return { ok: true, record, visit: target === "visit" ? record : undefined, viewing: target === "viewing" ? record : undefined, media: stripBytes(media) };
  }

  async function backfillRecord(args = {}) {
    return command("backfillRecord", async (draft, tx) => doBackfill(draft, tx, args || {}));
  }

  /** 舊入口：轉成同一個實作；沒有照片內容一律拒絕（只傳旗標或空陣列不算有照片）。 */
  async function backfillVisit(reason, patch = {}) {
    return command("backfillVisit", async (draft, tx) =>
      doBackfill(draft, tx, {
        target: "visit",
        reason,
        occurredAt: patch?.start ?? patch?.occurredAt,
        photoBlob: patch?.photoBlob,
        photoName: patch?.photoName,
        fields: patch || {}
      })
    );
  }

  async function listingToProperty(listing) {
    return command("listingToProperty", async (draft, tx) => {
      const mapped = listingToPropertyFn(listing, draft.profile);
      const id = mapped.property.id;
      if (!id) return { ok: false, error: "物件代號不可空白" };
      if (draft.properties.some((p) => p.id === id)) {
        return { ok: false, error: "物件代號重複" };
      }
      const norm = normalizePropertyFields(mapped.property);
      if (!norm.ok) return { ok: false, error: norm.errors[0]?.message, errors: norm.errors };
      const docsRed = listingDocsRedFlag(listing);
      const lst = { ...listing, id, eliminated: mapped.eliminated, docs_red: docsRed };
      draft.listings.push(lst);
      draft.properties.push({
        ...norm.value,
        from_listing: true,
        docs_red: docsRed,
        eliminated: mapped.eliminated,
        agent_alias: listing.agent_alias || "",
        slot_id: listing.slot_id || "",
        condition: Object.fromEntries(CONDITION_KEYS.map((k) => [k, null]))
      });
      if (docsRed && draft.currentVisitId) {
        const vis = draft.visits.find((x) => x.id === draft.currentVisitId);
        if (vis) {
          vis.vis14 = vis.vis14 || vis14Score({});
          vis.vis14.detail = vis.vis14.detail || {};
          vis.vis14.detail.docs = 0;
          vis.vis14.score = Object.values(vis.vis14.detail).reduce((s, n) => s + (toFiniteNumber(n) || 0), 0);
        }
      }
      return { ok: true, property: draft.properties.at(-1), listing: lst };
    });
  }

  const SLOT_ID_RE = /^G[1-3]-[1-3]$/;
  const SLOT_FORMAT_ERROR = "格位代號格式不對，要像 G1-1（組別 1 到 3，第幾位 1 到 3）";

  async function setMainPartner(rawSlotId, { confirmG1 = false, reason = "" } = {}) {
    return command("setMainPartner", async (draft, tx) => {
      const slotId = String(rawSlotId ?? "").trim().toUpperCase();
      if (!SLOT_ID_RE.test(slotId)) return { ok: false, error: SLOT_FORMAT_ERROR };
      const nextSlots = draft.slots.map((s) =>
        s.slot_id === slotId || s.id === slotId ? { ...s, status: "列為主要合作" } : s
      );
      if (!nextSlots.some((s) => s.slot_id === slotId || s.id === slotId)) {
        nextSlots.push({ id: slotId, slot_id: slotId, status: "列為主要合作" });
      }
      const chk = mainPartnersOk(nextSlots, draft.agents);
      if (!chk.ok) return { ok: false, error: chk.message };
      if (chk.needConfirmG1 && (!confirmG1 || !String(reason).trim())) {
        return { ok: false, error: "第一組列主要合作須勾確認並填理由" };
      }
      draft.slots = nextSlots;
      draft.agents = (draft.agents || []).map((a) => (a.slot_id === slotId ? { ...a, status: "列為主要合作" } : a));
      return { ok: true, slots: nextSlots };
    });
  }

  /** 取消主要合作：格位狀態改回「已完成該組目的」，仲介表同步。取消後人數減一，可以再選別人。 */
  async function unsetMainPartner(rawSlotId) {
    return command("unsetMainPartner", async (draft, tx) => {
      const slotId = String(rawSlotId ?? "").trim().toUpperCase();
      if (!SLOT_ID_RE.test(slotId)) return { ok: false, error: SLOT_FORMAT_ERROR };
      if (!mainPartnerSlotIds(draft.slots, draft.agents).has(slotId)) return { ok: false, error: "這個格位目前不是主要合作" };
      draft.slots = draft.slots.map((s) => ((s.slot_id || s.id) === slotId ? { ...s, status: "已完成該組目的" } : s));
      draft.agents = (draft.agents || []).map((a) => (a.slot_id === slotId ? { ...a, status: "已完成該組目的" } : a));
      return { ok: true, slots: draft.slots };
    });
  }

  async function transferAgent(agentId, { oldSlotId, newSlotId, newBranch } = {}) {
    return command("transferAgent", async (draft, tx) => {
      const agent = draft.agents.find((a) => a.id === agentId);
      if (!agent) return { ok: false, error: "找不到指定仲介" };
      if (!agent) return { ok: false, error: "資料不足：尚未有仲介紀錄" };
      const r = transferAgentFn(draft.slots, draft.agents, {
        agentId: agent.id,
        oldSlotId: oldSlotId || agent.slot_id,
        newSlotId,
        newBranch
      });
      if (r.ok === false) return r;
      draft.slots = r.slots;
      draft.agents = r.agents;
      return { ok: true, slots: r.slots, agents: r.agents };
    });
  }

  /**
   * 現場先確認帶進來的開價、登記總坪、車位（已帶入的值可直接按「對」）：只記「這次看房確認過哪幾項」，不改物件資料（第 12 輪 U3）。
   */
  async function confirmOnsiteFields(viewingId, keys = []) {
    return command("confirmOnsiteFields", async (draft) => {
      const v = draft.viewings.find((x) => x.id === (viewingId || draft.currentViewingId));
      if (!v) return { ok: false, error: "尚未選定看房" };
      const allowed = ["ask_total", "ping_total", "parking"];
      const list = (Array.isArray(keys) ? keys : [keys]).filter((k) => allowed.includes(k));
      if (!list.length) return { ok: false, error: "不認得要確認的項目" };
      v.onsite_confirmed = { ...(v.onsite_confirmed || {}), ...Object.fromEntries(list.map((k) => [k, true])) };
      return { ok: true, confirmed: v.onsite_confirmed };
    });
  }

  async function addViewing(propertyId, kind = "複看") {
    return command("addViewing", async (draft, tx) => {
      const p = draft.properties.find((x) => x.id === propertyId);
      if (!p) return { ok: false, error: "找不到物件" };
      const pack = draft.methodPack;
      const v = {
        id: nid("v"),
        property_id: propertyId,
        kind,
        start: new Date(now()).toISOString(),
        recorded_at: new Date(now()).toISOString(),
        responses: {},
        photos: [],
        post_saved: false,
        ...viewingPackFields(pack)
      };
      draft.viewings.push(v);
      draft.currentViewingId = v.id;
      return { ok: true, viewing: v };
    });
  }

  // -------------------------------------------------------------------------
  // 第 13 輪：口袋教練（C2、C4）與問價紀錄（C5）。全部經 command() 寫入，畫面不得直接改狀態。
  // -------------------------------------------------------------------------

  /**
   * 使用者打的文字之後會進「匯出到筆記」，所以存之前先過和匯出同一道出口閘門：
   * 含可承受上限、財務數字、延伸帶物件或個資的文字不給存，才不會存了卻永遠匯不出去。
   */
  function notesTextProblem(state, payload) {
    const gate = prepareOutbound({ recipient: "notes", state, notesPayload: payload });
    return gate.ok ? null : "這段文字含有不能送出的內容（可承受上限、財務數字、延伸帶物件或個資），請改寫後再存";
  }

  /** 切換目前階段（使用者手動切換）。 */
  async function setCoachStage(stageId) {
    return command("setCoachStage", async (draft) => {
      const info = stagesInfo(draft.methodPack);
      if (!info.enabled) return { ok: false, error: "這個方法包沒有教練內容" };
      const st = info.stages.find((s) => s.id === stageId);
      if (!st) return { ok: false, error: "找不到這個階段" };
      draft.coach = { ...normalizeCoach(draft.coach), current_stage: st.id };
      return { ok: true, stage: st.id };
    });
  }

  /** 勾選或取消勾選一個步驟；勾選時記下今天的日期（手機的本地日期）。步驟代號必須是目前方法包裡有的。 */
  async function setCoachStepDone(stepId, done = true) {
    return command("setCoachStepDone", async (draft) => {
      const info = stagesInfo(draft.methodPack);
      if (!info.enabled) return { ok: false, error: "這個方法包沒有教練內容" };
      if (!info.stages.some((s) => s.steps.some((st) => st.id === stepId))) return { ok: false, error: "找不到這個步驟" };
      const coach = normalizeCoach(draft.coach);
      const steps = { ...coach.steps_done };
      if (done) steps[stepId] = localDate(now());
      else delete steps[stepId];
      draft.coach = { ...coach, steps_done: steps };
      return { ok: true, done: Boolean(done), date: steps[stepId] || null };
    });
  }

  /** 完成這個階段：必要步驟都勾完才行；成功後目前階段換成下一階段（最後一個階段就留在原地）。 */
  async function completeCoachStage(stageId) {
    return command("completeCoachStage", async (draft) => {
      const info = stagesInfo(draft.methodPack);
      if (!info.enabled) return { ok: false, error: "這個方法包沒有教練內容" };
      const st = info.stages.find((s) => s.id === stageId);
      if (!st) return { ok: false, error: "找不到這個階段" };
      const coach = normalizeCoach(draft.coach);
      if (!stageProgress(st, coach).allRequiredDone) return { ok: false, error: "這個階段還有必要步驟沒勾完" };
      const next = info.stages.find((s) => s.order > st.order) || null;
      draft.coach = { ...coach, current_stage: (next || st).id };
      return { ok: true, next: next ? next.id : null };
    });
  }

  /** 存一則階段筆記。可以關聯一間物件；文字過個資與出口閘門的檢查。延伸帶物件的筆記只留在手機，不會匯出。 */
  async function addStageNote({ stage_id, property_code, text } = {}) {
    return command("addStageNote", async (draft) => {
      const info = stagesInfo(draft.methodPack);
      if (!info.enabled) return { ok: false, error: "這個方法包沒有教練內容" };
      if (!info.stages.some((s) => s.id === stage_id)) return { ok: false, error: "找不到這個階段" };
      const body = String(text ?? "").trim();
      if (!body) return { ok: false, error: "請先寫下要記的內容" };
      const norm = normalizeValue("stage_note", "text", body);
      if (norm.state !== "ok") return { ok: false, error: norm.error || "這段文字不能存" };
      const code = String(property_code ?? "").trim();
      const prop = code ? draft.properties.find((p) => p.id === code) : null;
      if (code && !prop) return { ok: false, error: "找不到這間物件" };
      const localOnly = prop ? isStretchProperty(prop, draft.finance) : false;
      if (!localOnly) {
        const problem = notesTextProblem(draft, { stage_notes: [{ stage_id, text: body }] });
        if (problem) return { ok: false, error: problem };
      }
      const coach = normalizeCoach(draft.coach);
      const note = { id: nid("sn"), stage_id, ...(code ? { property_code: code } : {}), at: new Date(now()).toISOString(), text: norm.value };
      draft.coach = { ...coach, stage_notes: [...coach.stage_notes, note] };
      return { ok: true, note, localOnly };
    });
  }

  async function removeStageNote(id) {
    return command("removeStageNote", async (draft) => {
      const coach = normalizeCoach(draft.coach);
      if (!coach.stage_notes.some((n) => n.id === id)) return { ok: false, error: "找不到這則筆記" };
      draft.coach = { ...coach, stage_notes: coach.stage_notes.filter((n) => n.id !== id) };
      return { ok: true };
    });
  }

  /**
   * 新增一筆問價紀錄（C5）：日期、類型、金額（萬，選填）、誰說的、備註。金額照欄位規格表的規則解析；
   * 文字過個資與出口閘門的檢查（問價紀錄會進匯出到筆記）。紀錄不會出現在任何系統產生的草稿裡。
   */
  async function addPriceLog({ property_id, date, kind, amount, who, note } = {}) {
    return command("addPriceLog", async (draft) => {
      const prop = draft.properties.find((p) => p.id === property_id);
      if (!prop) return { ok: false, error: "找不到這間物件" };
      const at = new Date(now()).toISOString();
      const dateRaw = date === undefined || date === null || String(date).trim() === "" ? localDate(now()) : date;
      const fields = { date: dateRaw, kind, amount, who, note };
      const out = {};
      for (const [k, v] of Object.entries(fields)) {
        const r = normalizeValue("price_log", k, v);
        if (r.state === "invalid") return { ok: false, error: `${k === "date" ? "日期" : k === "kind" ? "類型" : k === "amount" ? "金額" : k === "who" ? "誰說的" : "備註"}：${r.error}`, errors: [{ field: k, message: r.error }] };
        out[k] = r.state === "ok" ? r.value : null;
      }
      const localOnly = isStretchProperty(prop, draft.finance);
      if (!localOnly) {
        // 保存與匯出共用同一個判斷（scanPriceLogEntry）：金額當成「萬」的數字，和私密財務數字比對（F-R14-02）
        const entry = { property_code: prop.id, date: out.date, kind: out.kind, amount: out.amount, who: out.who || "", note: out.note || "" };
        const scanned = scanPriceLogEntry(entry, draft.finance);
        if (scanned.amountHit) return { ok: false, error: PRICE_LOG_AMOUNT_MESSAGE, errors: [{ field: "amount", message: PRICE_LOG_AMOUNT_MESSAGE }] };
        const problem = notesTextProblem(draft, { price_log: [entry] });
        if (problem) return { ok: false, error: problem };
      }
      const row = { id: nid("pl"), property_id: prop.id, date: out.date, kind: out.kind, amount: out.amount, who: out.who || "", note: out.note || "", at };
      draft.priceLog = [...(draft.priceLog || []), row];
      return { ok: true, entry: row, localOnly };
    });
  }

  async function removePriceLog(id) {
    return command("removePriceLog", async (draft) => {
      if (!(draft.priceLog || []).some((r) => r.id === id)) return { ok: false, error: "找不到這筆問價紀錄" };
      draft.priceLog = draft.priceLog.filter((r) => r.id !== id);
      return { ok: true };
    });
  }

  // -------------------------------------------------------------------------
  // 第 13 輪 E2 到 E7：現場路線分站。全部經 command() 寫入；站的設定與每一間的答案都存在看房紀錄裡（viewing.sites、viewing.responses）。
  // -------------------------------------------------------------------------

  /** 這次看房的路線站材料：題目、站的定義、物件。方法包沒有路線站時 defs 是空的。 */
  function siteContext(draft, viewing) {
    const items = itemsForViewing(draft, viewing);
    const hidden = normalizeCoach(draft.coach).hidden_items;
    const defs = routeStations(draft.methodPack, items, hidden);
    const property = draft.properties.find((p) => p.id === viewing.property_id) || {};
    return { items, defs, property };
  }

  /** 看房紀錄還沒有站的設定就依方法包與物件的房數、衛浴數建立；方法包沒有路線站就什麼都不建。 */
  function ensureSitesIn(draft, viewing) {
    if (viewing.sites && Array.isArray(viewing.sites.stations)) return true;
    const { defs, property } = siteContext(draft, viewing);
    if (!defs.length) return false;
    viewing.sites = buildSites(defs, property);
    return true;
  }

  function siteView(draft, viewingId) {
    const viewing = draft.viewings.find((x) => x.id === (viewingId || draft.currentViewingId));
    if (!viewing) return { error: "尚未選定看房" };
    ensureSitesIn(draft, viewing);
    const ctx = siteContext(draft, viewing);
    const stations = ctx.defs.length ? resolveStations(viewing.sites, ctx.defs, ctx.property) : [];
    return { viewing, ...ctx, stations };
  }

  /** 使用者自己加的題目（以後每間都問的在教練狀態裡，只這間的在這次看房裡）。 */
  function customItemsOf(draft, viewing) {
    return [...normalizeCoach(draft.coach).custom_items, ...(Array.isArray(viewing?.sites?.custom) ? viewing.sites.custom : [])];
  }

  function recordValue(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "object") {
      const rec = { ...value };
      if (rec.status === undefined && rec.value !== undefined) rec.status = rec.value;
      if (rec.value === undefined && rec.status !== undefined) rec.value = rec.status;
      return rec.status === "" || rec.status === undefined ? null : rec;
    }
    return { status: String(value), value: String(value) };
  }

  /** 建立這次看房的路線站（開始現場時，依物件的房數與衛浴數；沒有數字就先建 1 個）。 */
  async function ensureSites(viewingId) {
    return command("ensureSites", async (draft) => {
      const viewing = draft.viewings.find((x) => x.id === (viewingId || draft.currentViewingId));
      if (!viewing) return { ok: false, error: "尚未選定看房" };
      const made = ensureSitesIn(draft, viewing);
      return { ok: true, none: !made, stations: viewing.sites?.stations?.length || 0 };
    });
  }

  /**
   * 寫一題在某一站的答案（那一間）。可重複的站（房間、浴室）答案存在「題目代號@站代號」，整題的答案（計分與計入一間看的那一格）重算成最嚴重的那一間；
   * 使用者自己加的題目不計分、不影響計入一間，另外存。
   */
  async function setSiteResponse(viewingId, itemId, stationKey, value) {
    return command("setSiteResponse", async (draft) => {
      const view = siteView(draft, viewingId);
      if (view.error) return { ok: false, error: view.error };
      const { viewing, stations } = view;
      const custom = customItemsOf(draft, viewing).find((c) => c.id === itemId);
      const station = stations.find((s) => s.key === stationKey) || (!custom ? stations.find((s) => s.def.itemIds.includes(itemId)) : null);
      if (!custom && !(view.items.some((i) => i.id === itemId))) return { ok: false, error: "找不到這一題" };
      const key = responseKeyOf(itemId, station);
      const rec = recordValue(value);
      const bag = custom ? "custom_answers" : "responses";
      viewing[bag] = { ...(viewing[bag] || {}) };
      if (rec) viewing[bag][key] = rec;
      else delete viewing[bag][key];
      if (!custom && station?.def.repeatable) viewing.responses = recomputeAggregates(viewing.responses || {}, stations);
      return { ok: true, key };
    });
  }

  /** 可重複的站再加一間（例如多一間房）。 */
  async function addStation(viewingId, stepId) {
    return command("addStation", async (draft) => {
      const view = siteView(draft, viewingId);
      if (view.error) return { ok: false, error: view.error };
      const { viewing, defs, stations, property } = view;
      const def = defs.find((d) => d.stepId === stepId);
      if (!def || !def.repeatable) return { ok: false, error: "這一站不能再加一間" };
      const mine = stations.filter((s) => s.stepId === stepId);
      if (mine.length >= MAX_INSTANCES) return { ok: false, error: `最多 ${MAX_INSTANCES} 間` };
      const sites = viewing.sites;
      const n = Math.max(toFiniteNumber(sites.next_n?.[stepId]) || 1, ...mine.map((s) => s.n + 1));
      const added = { key: stationKeyOf(def, n), step_id: stepId, n, name: stationNameOf(def, n) };
      const at = sites.stations.map((s) => s.step_id).lastIndexOf(stepId);
      const next = [...sites.stations];
      next.splice(at < 0 ? next.length : at + 1, 0, added);
      viewing.sites = { ...sites, stations: next, next_n: { ...(sites.next_n || {}), [stepId]: n + 1 } };
      const all = resolveStations(viewing.sites, defs, property);
      viewing.responses = recomputeAggregates(viewing.responses || {}, all);
      return { ok: true, key: added.key, name: added.name };
    });
  }

  /**
   * 刪掉可重複站的一間。刪之前要確認：沒有 confirmed 就只回傳「會一起刪掉哪些答案與照片」，什麼都不改。
   * 至少要留一間；這一間的答案與照片（含照片檔）一起刪掉，整題的答案重算。
   */
  async function removeStation(viewingId, stationKey, { confirmed = false } = {}) {
    return command("removeStation", async (draft, tx) => {
      const view = siteView(draft, viewingId);
      if (view.error) return { ok: false, error: view.error };
      const { viewing, defs, stations, property } = view;
      const station = stations.find((s) => s.key === stationKey);
      if (!station || !station.def.repeatable) return { ok: false, error: "只有房間、浴室這種有好幾間的站可以刪掉一間" };
      if (stations.filter((s) => s.stepId === station.stepId).length <= 1) return { ok: false, error: "至少要留一間；這間不需要的話，請把題目標成不適用" };
      const impact = stationImpact(viewing, station);
      if (confirmed !== true) return { ok: false, needsConfirm: true, impact: { ...impact, name: station.name }, error: "刪掉之前請先確認" };
      const suffix = `@${station.key}`;
      viewing.responses = Object.fromEntries(Object.entries(viewing.responses || {}).filter(([k]) => !k.endsWith(suffix)));
      viewing.custom_answers = Object.fromEntries(Object.entries(viewing.custom_answers || {}).filter(([k]) => !k.endsWith(suffix)));
      const gone = new Set((viewing.photos || []).filter((p) => p.station_key === station.key).map((p) => p.id));
      for (const m of draft.media || []) if (m && m.viewing_id === viewing.id && m.station_key === station.key) gone.add(m.id);
      viewing.photos = (viewing.photos || []).filter((p) => p.station_key !== station.key);
      draft.media = (draft.media || []).filter((m) => !gone.has(m.id));
      for (const id of gone) tx.deletes.push({ store: "media", id });
      viewing.sites = { ...viewing.sites, stations: viewing.sites.stations.filter((s) => s.key !== station.key) };
      viewing.responses = recomputeAggregates(viewing.responses || {}, resolveStations(viewing.sites, defs, property));
      return { ok: true, removed: station.name, impact };
    });
  }

  async function renameStation(viewingId, stationKey, name) {
    return command("renameStation", async (draft) => {
      const view = siteView(draft, viewingId);
      if (view.error) return { ok: false, error: view.error };
      const text = String(name ?? "").trim();
      if (!text) return { ok: false, error: "站名不能空白" };
      if (text.length > 20) return { ok: false, error: "站名最多 20 個字" };
      const norm = normalizeValue("coach_custom_item", "text", text);
      if (norm.state !== "ok") return { ok: false, error: norm.error || "這個站名不能用" };
      const at = view.viewing.sites.stations.findIndex((s) => s.key === stationKey);
      if (at < 0) return { ok: false, error: "找不到這一站" };
      const stations = [...view.viewing.sites.stations];
      stations[at] = { ...stations[at], name: norm.value };
      view.viewing.sites = { ...view.viewing.sites, stations };
      return { ok: true, name: norm.value };
    });
  }

  /** 站的順序上下移動（只影響這次與之後的顯示順序，不影響答案）。 */
  async function moveStation(viewingId, stationKey, delta) {
    return command("moveStation", async (draft) => {
      const view = siteView(draft, viewingId);
      if (view.error) return { ok: false, error: view.error };
      const list = [...view.viewing.sites.stations];
      const at = list.findIndex((s) => s.key === stationKey);
      const to = at + (delta < 0 ? -1 : 1);
      if (at < 0 || to < 0 || to >= list.length) return { ok: false, error: "已經在最上面或最下面了" };
      [list[at], list[to]] = [list[to], list[at]];
      view.viewing.sites = { ...view.viewing.sites, stations: list };
      return { ok: true };
    });
  }

  /** 「這站都正常」：只把這一站（那一間）還沒作答、選項含正常、無問題或符合的題目一次填好；一票否決類的題目不帶過。 */
  async function markStationNormal(viewingId, stationKey) {
    return command("markStationNormal", async (draft) => {
      const view = siteView(draft, viewingId);
      if (view.error) return { ok: false, error: view.error };
      const { viewing, stations } = view;
      const station = stations.find((s) => s.key === stationKey);
      if (!station) return { ok: false, error: "找不到這一站" };
      const items = stationItems(station, { customAll: normalizeCoach(draft.coach).custom_items, customHere: viewing.sites?.custom || [], hiddenIds: normalizeCoach(draft.coach).hidden_items });
      const plan = normalFillPlan(viewing, station, items);
      for (const f of plan.fill) {
        const bag = f.item.custom ? "custom_answers" : "responses";
        viewing[bag] = { ...(viewing[bag] || {}), [f.key]: { status: f.value, value: f.value } };
      }
      if (station.def.repeatable) viewing.responses = recomputeAggregates(viewing.responses || {}, stations);
      return { ok: true, filled: plan.fill.length, skippedVeto: plan.skippedVeto };
    });
  }

  /**
   * 加一題自訂題目（文字加選項，預設 正常、有問題、待查）。scope 是 "this"（只這間）或 "all"（以後每間都問，存進使用者自訂清單）。
   * 自訂題目不計分、不影響計入一間；文字過個資與出口閘門（以後每間都問的會進匯出到筆記）。
   */
  async function addCustomItem({ viewingId, stepId, text, options, scope = "this" } = {}) {
    return command("addCustomItem", async (draft) => {
      const view = siteView(draft, viewingId);
      if (view.error) return { ok: false, error: view.error };
      if (!view.defs.some((d) => d.stepId === stepId)) return { ok: false, error: "找不到這一站" };
      const body = String(text ?? "").trim();
      if (!body) return { ok: false, error: "請先寫下要問的題目" };
      const norm = normalizeValue("coach_custom_item", "text", body);
      if (norm.state !== "ok") return { ok: false, error: norm.error || "這段文字不能存" };
      const rawOpts = Array.isArray(options) ? options : String(options ?? "").split(/[,，、\s]+/);
      const opts = [...new Set(rawOpts.map((o) => String(o).trim()).filter(Boolean))];
      const finalOpts = opts.length ? opts : [...DEFAULT_CUSTOM_OPTIONS];
      if (finalOpts.length < 2 || finalOpts.length > 6) return { ok: false, error: "選項要有 2 到 6 個" };
      for (const o of finalOpts) {
        const r = normalizeValue("coach_custom_item", "text", o);
        if (r.state !== "ok" || o.length > 12) return { ok: false, error: "每個選項最多 12 個字，而且不能放個資" };
      }
      if (scope !== "this" && scope !== "all") return { ok: false, error: "請選「只這間」或「以後每間都問」" };
      const item = { id: nid("ci"), text: norm.value, options: finalOpts, step_id: stepId };
      if (scope === "all") {
        const problem = notesTextProblem(draft, { coach: { custom_items: [{ text: item.text, options: item.options, step_id: stepId }] } });
        if (problem) return { ok: false, error: problem };
        const coach = normalizeCoach(draft.coach);
        draft.coach = { ...coach, custom_items: [...coach.custom_items, item] };
      } else {
        view.viewing.sites = { ...view.viewing.sites, custom: [...(view.viewing.sites.custom || []), item] };
      }
      return { ok: true, item, scope };
    });
  }

  async function removeCustomItem({ id } = {}) {
    return command("removeCustomItem", async (draft) => {
      const coach = normalizeCoach(draft.coach);
      let found = false;
      if (coach.custom_items.some((c) => c.id === id)) {
        draft.coach = { ...coach, custom_items: coach.custom_items.filter((c) => c.id !== id) };
        found = true;
      }
      for (const v of draft.viewings) {
        if (Array.isArray(v.sites?.custom) && v.sites.custom.some((c) => c.id === id)) {
          v.sites = { ...v.sites, custom: v.sites.custom.filter((c) => c.id !== id) };
          found = true;
        }
        if (v.custom_answers) v.custom_answers = Object.fromEntries(Object.entries(v.custom_answers).filter(([k]) => k !== id && !k.startsWith(`${id}@`)));
      }
      return found ? { ok: true } : { ok: false, error: "找不到這個自訂題目" };
    });
  }

  /** 選做題可隱藏（使用者偏好，存在教練狀態裡）；必做題不能隱藏，只能標「不適用」並寫一句原因。 */
  async function setItemHidden(itemId, hidden = true) {
    return command("setItemHidden", async (draft) => {
      const item = packChecklist(draft).find((i) => i && i.id === itemId);
      if (!item) return { ok: false, error: "找不到這一題" };
      if (item.core === true) return { ok: false, error: "必做題不能隱藏，只能標「不適用」並寫一句原因" };
      const coach = normalizeCoach(draft.coach);
      const set = new Set(coach.hidden_items);
      if (hidden) set.add(itemId);
      else set.delete(itemId);
      draft.coach = { ...coach, hidden_items: [...set] };
      return { ok: true, hidden: Boolean(hidden) };
    });
  }

  /** 把一題標成「不適用」並寫一句原因（必做題一定要寫原因；仍受現場不適用最多 2 項的計入規則）。 */
  async function markItemNotApplicable({ viewingId, itemId, stationKey, reason } = {}) {
    return command("markItemNotApplicable", async (draft) => {
      const view = siteView(draft, viewingId);
      if (view.error) return { ok: false, error: view.error };
      const { viewing, stations } = view;
      const custom = customItemsOf(draft, viewing).find((c) => c.id === itemId);
      const item = custom || view.items.find((i) => i.id === itemId);
      if (!item) return { ok: false, error: "找不到這一題" };
      const why = String(reason ?? "").trim();
      if (item.core === true && !why) return { ok: false, error: "必做題標不適用，要寫一句原因" };
      if (why.length > 60) return { ok: false, error: "原因請寫在 60 個字以內" };
      const norm = why ? normalizeValue("coach_custom_item", "text", why) : { state: "ok", value: "" };
      if (norm.state !== "ok") return { ok: false, error: norm.error || "這段原因不能存" };
      const station = stations.find((s) => s.key === stationKey) || (!custom ? stations.find((s) => s.def.itemIds.includes(itemId)) : null);
      const key = responseKeyOf(itemId, station);
      const bag = custom ? "custom_answers" : "responses";
      viewing[bag] = { ...(viewing[bag] || {}), [key]: { status: "不適用", value: "不適用", reason: norm.value } };
      if (!custom && station?.def.repeatable) viewing.responses = recomputeAggregates(viewing.responses || {}, stations);
      return { ok: true };
    });
  }

  /** 「先跳過，標待核」：把遺漏清單裡的題目一次標成待核（已經有答案的不動）。 */
  async function markMissingPending(viewingId, targets = []) {
    return command("markMissingPending", async (draft) => {
      const view = siteView(draft, viewingId);
      if (view.error) return { ok: false, error: view.error };
      const { viewing, stations } = view;
      let n = 0;
      for (const t of Array.isArray(targets) ? targets : []) {
        if (!view.items.some((i) => i.id === t.itemId)) continue;
        const station = stations.find((s) => s.key === t.stationKey) || null;
        const key = station ? responseKeyOf(t.itemId, station) : t.itemId;
        if (responseValue(viewing.responses?.[key]).filled) continue;
        viewing.responses = { ...(viewing.responses || {}), [key]: { status: "待核", value: "待核" } };
        n += 1;
      }
      if (stations.length) viewing.responses = recomputeAggregates(viewing.responses || {}, stations);
      return { ok: true, marked: n };
    });
  }

  const api = {
    getState: () => viewState(),
    getLoadStatus: () => loadStatus,
    getLoadIssues,
    load,
    reload,
    addProperty,
    selectViewing,
    currentViewing,
    currentProperty,
    leaveViewing,
    assessProperty,
    updateProperty,
    saveFieldInputs,
    setChecklistResponse,
    checklistSource,
    takePhoto,
    takeVisitPhoto,
    startRecording,
    addAudioChunk,
    stopRecording,
    appendFinalTranscript,
    exportBackup,
    importBackupFiles,
    applyBackupPayload,
    setScoringWeights,
    scoreCurrent,
    rescoreAllStale,
    releaseVeto,
    applyThreshold,
    startCoolingFromChange,
    previewImport,
    confirmImport,
    buildNotesExport,
    restorePreviousBatch,
    setSelectedSlot,
    loadMethodPack,
    agentDraftText,
    scanAgentDraft,
    sharePack,
    buildUploadPack,
    countSelected,
    homeCheckpoints,
    affordFor,
    confirmFinanceVerified,
    appendAudit,
    validatePropertyFields,
    stopSpeechAndConsent,
    handleRecordingStopped,
    startVisit,
    saveVisit,
    saveVisitDraft,
    backfillVisit,
    backfillRecord,
    unsetMainPartner,
    listingToProperty,
    setMainPartner,
    transferAgent,
    addViewing,
    confirmOnsiteFields,
    setCoachStage,
    setCoachStepDone,
    completeCoachStage,
    addStageNote,
    removeStageNote,
    addPriceLog,
    removePriceLog,
    ensureSites,
    setSiteResponse,
    addStation,
    removeStation,
    renameStation,
    moveStation,
    markStationNormal,
    addCustomItem,
    removeCustomItem,
    setItemHidden,
    markItemNotApplicable,
    markMissingPending
  };
  if (inTest) api.seedForTest = seedForTest;
  return api;
}
