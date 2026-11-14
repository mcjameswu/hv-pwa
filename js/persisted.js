/**
 * Single list of keys that survive save, load, snapshot, export and backup.
 * STORES、PERSISTED_KEYS、備份表由這一份對照表推導。
 */

export const SCALAR_PERSISTED = [
  "settings",
  "finance",
  "finance_meta",
  "profile",
  "scoring",
  "methodPack",
  "methodPacks",
  "cooling",
  "selectedSlot",
  "selectedSlotText",
  "currentVisitId",
  "currentViewingId",
  "offered",
  "coach"
];

export const ARRAY_PERSISTED = [
  "areas",
  "agents",
  "slots",
  "travel",
  "properties",
  "viewings",
  "visits",
  "listings",
  "drafts",
  "importBatches",
  "scores",
  "audit",
  "media",
  "audioChunks",
  "transcripts",
  "vetoReleases",
  "priceLog"
];

export const PERSISTED_KEYS = [...SCALAR_PERSISTED, ...ARRAY_PERSISTED];

/**
 * 帶有 property_id（物件代號）欄位的清單型資料表（F9-12）。
 * 改物件代號時控制器逐一改這些表，不變條件的關聯檢查也由這份清單驅動，兩邊不會再不同步。
 * 屋單的代號本身也可能等於物件代號，改代號時另外處理，所以不在這份清單裡。
 */
export const PROPERTY_REF_TABLES = ["viewings", "scores", "media", "audioChunks", "transcripts", "vetoReleases", "drafts", "priceLog"];

export const SESSION_KEYS = [
  "currentVisitId",
  "currentViewingId",
  "selectedSlot",
  "selectedSlotText",
  "offered"
];

/** State key → IndexedDB object store. Session keys share one store. */
export const STATE_STORE_MAP = {
  settings: "settings",
  finance: "finance",
  finance_meta: "financeMeta",
  profile: "profile",
  areas: "areas",
  scoring: "scoring",
  methodPack: "methodPack",
  methodPacks: "methodPack",
  cooling: "cooling",
  agents: "agents",
  slots: "slots333",
  travel: "travelTable",
  properties: "properties",
  viewings: "viewings",
  visits: "agencyVisits",
  listings: "listingSheets",
  drafts: "messageDrafts",
  importBatches: "importBatches",
  scores: "scores",
  audit: "auditLog",
  media: "media",
  audioChunks: "audioChunks",
  transcripts: "transcripts",
  vetoReleases: "vetoReleases",
  coach: "coach",
  priceLog: "priceLog"
};

export const SESSION_STORE = "session";
export const FLAGS_STORE = "flags";

export const LEGACY_UNUSED_STORES = [
  "checklistResponses",
  "checklistTemplates",
  "idealProfile",
  "privateVault"
];

export const STORES = [...new Set([...Object.values(STATE_STORE_MAP), SESSION_STORE, FLAGS_STORE])];

export const BACKUP_TABLES = PERSISTED_KEYS.filter(
  (k) => !["media", "audioChunks"].includes(k)
);

/**
 * 口袋教練的持久狀態（第 13 輪 C2）：目前階段、各步驟完成日期、階段筆記，加上第 13 輪 E7 的自訂題目與隱藏的選做題。
 * 白話：教練做到哪、勾了哪些步驟、記了哪些筆記，都存在這一份，和設定、財務一樣是單筆資料。
 */
export function emptyCoach() {
  return { current_stage: null, steps_done: {}, stage_notes: [], custom_items: [], hidden_items: [] };
}

export function emptyPersisted() {
  return {
    settings: {},
    finance: {},
    finance_meta: { source_type: null, verified: false, content_hash: null },
    profile: {},
    areas: [],
    scoring: null,
    agents: [],
    slots: [],
    travel: [],
    properties: [],
    viewings: [],
    visits: [],
    listings: [],
    drafts: [],
    methodPack: null,
    methodPacks: [],
    importBatches: [],
    scores: [],
    audit: [],
    media: [],
    audioChunks: [],
    transcripts: [],
    vetoReleases: [],
    priceLog: [],
    coach: emptyCoach(),
    cooling: null,
    selectedSlot: null,
    selectedSlotText: "",
    currentVisitId: null,
    currentViewingId: null,
    offered: false
  };
}

export function pickPersisted(state = {}) {
  const out = {};
  for (const k of PERSISTED_KEYS) {
    if (state[k] !== undefined) out[k] = state[k];
  }
  return out;
}

export function isArrayPersisted(key) {
  return ARRAY_PERSISTED.includes(key);
}

export function listsAligned() {
  const mapped = new Set(Object.keys(STATE_STORE_MAP));
  const persistedData = PERSISTED_KEYS.filter((k) => !SESSION_KEYS.includes(k));
  const missing = persistedData.filter((k) => !mapped.has(k));
  const extra = [...mapped].filter((k) => !PERSISTED_KEYS.includes(k));
  const backupOk = BACKUP_TABLES.every((k) => PERSISTED_KEYS.includes(k));
  return { ok: missing.length === 0 && extra.length === 0 && backupOk, missing, extra };
}
