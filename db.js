/**
 * IndexedDB wrapper with schema version and migrations.
 */
import { DB_VERSION } from "./js/defaults.js";
import { STORES as PERSISTED_STORES, LEGACY_UNUSED_STORES } from "./js/persisted.js";
import { parseNumericRaw } from "./js/fields.js";

/** 讀出整數計數，讀不到就是 0（修訂號、筆數用）。 */
function toCount(v) {
  const r = parseNumericRaw(v);
  return r.state === "ok" ? r.value : 0;
}

const DB_NAME = "house-viewing-app";

export const STORES = PERSISTED_STORES;
export { LEGACY_UNUSED_STORES };

/** 這三張表的內容只能走專用通道（mediaPuts、chunkPuts、auditPuts），一般提交永遠不含。 */
export const NEVER_IN_SPLIT = ["media", "audioChunks", "auditLog"];
/** 帶有大塊內容的表：啟動時只讀目錄，不讀內容。 */
export const CONTENT_STORES = ["media", "audioChunks"];
const SKIP_CLEAR_ON_SAVE = new Set(NEVER_IN_SPLIT);

let cachedDb = null;

/** 系統自己產生的識別碼：不含 12 位以上連續數字。 */
function dbId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 去掉媒體內容，只留目錄資訊。 */
export function stripContent(rec) {
  if (!rec || typeof rec !== "object") return rec;
  const out = { ...rec };
  delete out.bytes;
  delete out.blob;
  delete out.bytesB64;
  return out;
}

/** 這一筆媒體或錄音分片有沒有真正的內容。 */
export function hasContent(rec) {
  if (!rec || typeof rec !== "object") return false;
  if (rec.bytes instanceof Uint8Array) return rec.bytes.length > 0;
  if (rec.bytes && typeof rec.bytes.byteLength === "number") return rec.bytes.byteLength > 0;
  if (typeof rec.bytesB64 === "string" && rec.bytesB64.length > 0) return true;
  if (rec.blob) return typeof rec.blob.size === "number" ? rec.blob.size > 0 : true;
  return false;
}

/**
 * 提交計畫（純函式）：正式資料庫與記憶體替身共用同一份「要寫哪些表、怎麼寫、先檢查什麼」。
 * 所有前置檢查都在這裡完成，交易內只做寫入，不再拋自訂例外。
 * diff.split：只放有變動的一般表；diff.prevCounts：上一版每張表的筆數（用來抓「沒宣告就清空」）。
 * 刪除約定：{ store, id } 刪一筆；{ store, clear: true } 整表清空。
 */
export function planCommit(diff = {}, extras = {}) {
  const fail = (error) => ({ ok: false, error });
  const puts = [...(diff.puts || []), ...(extras.puts || [])];
  const rawDeletes = [...(diff.deletes || []), ...(extras.deletes || [])];
  const mediaPuts = extras.mediaPuts || [];
  const chunkPuts = extras.chunkPuts || [];
  const auditPuts = extras.auditPuts || [];
  const tables = {};
  for (const [name, rows] of Object.entries(diff.split || {})) {
    if (NEVER_IN_SPLIT.includes(name)) continue; // 第二道防線：媒體與稽核不走一般提交
    if (!STORES.includes(name)) continue;
    tables[name] = rows || [];
  }
  for (const rec of puts) {
    if (!rec || !STORES.includes(rec.store) || rec.value == null) return fail("寫入指令缺少資料表或內容");
  }
  for (const rec of mediaPuts) {
    if (!hasContent(rec)) return fail(`媒體 ${rec?.id || ""} 沒有內容，拒絕寫入`);
  }
  for (const rec of chunkPuts) {
    if (!hasContent(rec)) return fail(`錄音分片 ${rec?.id || ""} 沒有內容，拒絕寫入`);
  }
  const deletes = [];
  const clears = [];
  for (const d of rawDeletes) {
    if (!d || !d.store || !STORES.includes(d.store)) return fail("刪除指令缺少資料表");
    if (d.clear === true) {
      clears.push(d.store);
      continue;
    }
    if (d.id === undefined || d.id === null) return fail(`刪除 ${d.store} 缺少主鍵`);
    deletes.push({ store: d.store, id: d.id });
  }
  const declared = new Set([...clears, ...deletes.map((d) => d.store)]);
  for (const [name, rows] of Object.entries(tables)) {
    const prev = toCount(diff.prevCounts?.[name]);
    if (prev > 0 && rows.length === 0 && !declared.has(name)) {
      return fail(`未宣告刪除卻清空資料表 ${name}`);
    }
  }
  return { ok: true, tables, puts, mediaPuts, chunkPuts, auditPuts, deletes, clears };
}

export function splitStateToStores(payload = {}) {
  const row = (id, data) => ({ ...data, id });
  return {
    settings: payload.settings ? [row("current", payload.settings)] : [],
    finance: payload.finance ? [row("current", payload.finance)] : [],
    profile: payload.profile ? [row("current", payload.profile)] : [],
    areas: (payload.areas || []).map((a, i) => ({
      ...a,
      id: a.id && String(a.id) !== String(a.area_code) ? a.id : `area-${a.area_code || i}`
    })),
    properties: (payload.properties || []).map((p, i) => ({ ...p, id: p.id || `p-${i}` })),
    viewings: (payload.viewings || []).map((v, i) => ({ ...v, id: v.id || `v-${i}` })),
    scores: (payload.scores || []).map((s, i) => ({ ...s, id: s.id || `s-${i}` })),
    media: (payload.media || []).map((m, i) => ({ ...m, id: m.id || `m-${i}` })),
    audioChunks: (payload.audioChunks || []).map((c, i) => ({ ...c, id: c.id || `a-${i}` })),
    transcripts: (payload.transcripts || []).map((t, i) => ({ ...t, id: t.id || `t-${i}` })),
    vetoReleases: (payload.vetoReleases || []).map((r, i) => ({ ...r, id: r.id || `vr-${i}` })),
    priceLog: (payload.priceLog || []).map((r, i) => ({ ...r, id: r.id || `pl-${i}` })),
    coach: payload.coach ? [row("current", payload.coach)] : [],
    agents: (payload.agents || []).map((a, i) => ({ ...a, id: a.id || a.slot_id || `ag-${i}` })),
    slots333: (payload.slots || []).map((s, i) => ({ ...s, id: s.id || s.slot_id || `slot-${i}` })),
    agencyVisits: (payload.visits || []).map((v, i) => ({ ...v, id: v.id || `vis-${i}` })),
    listingSheets: (payload.listings || []).map((l, i) => ({ ...l, id: l.id || `lst-${i}` })),
    messageDrafts: (payload.drafts || []).map((d, i) => ({ ...d, id: d.id || `d-${i}` })),
    travelTable: (payload.travel || []).map((t, i) => ({ ...t, id: t.id || t.place_alias || `tr-${i}` })),
    importBatches: (payload.importBatches || []).map((b, i) => ({ ...b, id: b.id || `b-${i}` })),
    auditLog: (payload.audit || []).map((a, i) => ({ ...a, id: a.id || `au-${i}` })),
    methodPack: [
      ...(payload.methodPack ? [row("current", payload.methodPack)] : []),
      ...((payload.methodPacks || []).map((p) => row(p.hash || p.id, p.pack || p)))
    ],
    cooling: payload.cooling ? [row("current", payload.cooling)] : [],
    scoring: payload.scoring ? [row("current", payload.scoring)] : [],
    financeMeta: payload.finance_meta ? [row("current", payload.finance_meta)] : [],
    session: [
      row("current", {
        currentVisitId: payload.currentVisitId ?? null,
        currentViewingId: payload.currentViewingId ?? null,
        selectedSlot: payload.selectedSlot ?? null,
        selectedSlotText: payload.selectedSlotText ?? "",
        offered: payload.offered === true
      })
    ]
  };
}

function upsertById(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const id = row?.id;
    if (id === undefined || id === null || id === "") continue;
    map.set(id, row);
  }
  return [...map.values()];
}

export function storesToState(stores) {
  const settings = stores.settings?.[0] ? { ...stores.settings[0] } : {};
  delete settings.id;
  const finance = stores.finance?.[0] ? { ...stores.finance[0] } : {};
  delete finance.id;
  const profile = stores.profile?.[0] ? { ...stores.profile[0] } : {};
  delete profile.id;
  const packRows = stores.methodPack || [];
  const currentPackRow = packRows.find((r) => r.id === "current") || packRows[0];
  let methodPack = null;
  if (currentPackRow) {
    methodPack = { ...currentPackRow };
    delete methodPack.id;
  }
  const methodPacks = packRows
    .filter((r) => r.id && r.id !== "current")
    .map((r) => {
      const pack = { ...r };
      const hash = pack.id;
      delete pack.id;
      return { hash, pack: pack.pack || pack };
    });
  const sessionRows = stores.session || [];
  const sessionCur = sessionRows.find((r) => r?.id === "current");
  const revRow = sessionRows.find((r) => r?.id === "rev");
  const out = {
    settings,
    finance,
    profile,
    areas: stores.areas || [],
    properties: stores.properties || [],
    viewings: stores.viewings || [],
    scores: stores.scores || [],
    media: stores.media || [],
    audioChunks: stores.audioChunks || [],
    transcripts: stores.transcripts || [],
    vetoReleases: stores.vetoReleases || [],
    priceLog: stores.priceLog || [],
    coach: (() => {
      const row = stores.coach?.[0];
      if (!row) return undefined; // 舊資料庫沒有這一列：交給控制器補成空的教練狀態
      const c = { ...row };
      delete c.id;
      return c;
    })(),
    agents: stores.agents || [],
    slots: stores.slots333 || [],
    visits: stores.agencyVisits || [],
    listings: stores.listingSheets || [],
    drafts: stores.messageDrafts || [],
    travel: stores.travelTable || [],
    importBatches: stores.importBatches || [],
    audit: stores.auditLog || [],
    methodPack,
    methodPacks,
    cooling: stores.cooling?.[0] ? (() => {
      const c = { ...stores.cooling[0] };
      delete c.id;
      return c;
    })() : null,
    scoring: (() => {
      const row = stores.scoring?.[0];
      if (row) {
        const s = { ...row };
        delete s.id;
        return s;
      }
      return undefined;
    })(),
    finance_meta: (() => {
      const row = stores.financeMeta?.[0];
      if (row) {
        const s = { ...row };
        delete s.id;
        return s;
      }
      return { source_type: null, verified: false, content_hash: null };
    })(),
    ...(sessionCur
      ? (() => {
          const s = { ...sessionCur };
          delete s.id;
          return {
            currentVisitId: s.currentVisitId ?? null,
            currentViewingId: s.currentViewingId ?? null,
            selectedSlot: s.selectedSlot ?? null,
            selectedSlotText: s.selectedSlotText ?? "",
            offered: s.offered === true
          };
        })()
      : {})
  };
  // 修訂號（資料庫裡的版本計數）：不可列舉，避免被當成一般資料欄位複製。
  Object.defineProperty(out, "__rev", { value: toCount(revRow?.value), enumerable: false });
  return out;
}

export function migrateV1Flags(payload) {
  return splitStateToStores(payload || {});
}

/**
 * 把交易包成 Promise。work 若拋例外，一定先中止交易再拒絕（避免前面排入的寫入照樣生效）。
 * work(tx, abortWith)：abortWith(err) 讓交易以指定的錯誤中止。
 */
function txPromise(tx, work) {
  return new Promise((resolve, reject) => {
    let result;
    let reason = null;
    const abortWith = (err) => {
      reason = err;
      try {
        tx.abort();
      } catch {
        /* 已結束 */
      }
    };
    tx.onabort = () => reject(reason || tx.error || new Error("交易中止"));
    tx.onerror = () => reject(tx.error || new Error("交易失敗"));
    tx.oncomplete = () => resolve(result);
    try {
      result = work(tx, abortWith);
    } catch (err) {
      abortWith(err);
      reject(err);
    }
  });
}

export function openDb() {
  if (cachedDb) return Promise.resolve(cachedDb);
  return new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const from = e.oldVersion || 0;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: "id", autoIncrement: name === "auditLog" });
        }
      }
      if (from < 5) {
        const tx = req.transaction;
        let remain = 1;
        const dropLegacy = () => {
          remain -= 1;
          if (remain > 0) return;
          for (const name of LEGACY_UNUSED_STORES) {
            if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
          }
        };
        try {
          if (db.objectStoreNames.contains("idealProfile")) {
            remain += 1;
            const getReq = tx.objectStore("idealProfile").get("current");
            getReq.onsuccess = () => {
              const row = getReq.result;
              if (row && db.objectStoreNames.contains("profile")) {
                const existing = tx.objectStore("profile");
                const peek = existing.get("current");
                peek.onsuccess = () => {
                  if (!peek.result) {
                    const { id, ...rest } = row;
                    existing.put({ ...rest, id: "current" });
                  }
                  dropLegacy();
                };
                peek.onerror = () => dropLegacy();
                return;
              }
              dropLegacy();
            };
            getReq.onerror = () => dropLegacy();
          }
          if (db.objectStoreNames.contains("checklistResponses")) {
            remain += 1;
            const allReq = tx.objectStore("checklistResponses").getAll();
            allReq.onsuccess = () => {
              const rows = allReq.result || [];
              let inner = rows.length || 1;
              const innerDone = () => {
                inner -= 1;
                if (inner <= 0) dropLegacy();
              };
              if (db.objectStoreNames.contains("viewings") && rows.length) {
                for (const rec of rows) {
                  if (rec.viewing_id && rec.responses) {
                    const getV = tx.objectStore("viewings").get(rec.viewing_id);
                    getV.onsuccess = () => {
                      const v = getV.result;
                      if (v) {
                        tx.objectStore("viewings").put({
                          ...v,
                          responses: { ...(v.responses || {}), ...rec.responses }
                        });
                      }
                      innerDone();
                    };
                    getV.onerror = () => innerDone();
                  } else innerDone();
                }
              } else {
                innerDone();
              }
            };
            allReq.onerror = () => dropLegacy();
          }
        } catch {
          remain = 1;
        }
        dropLegacy();
      }
      if (from < 2 && db.objectStoreNames.contains("flags")) {
        const tx = req.transaction;
        try {
          const flags = tx.objectStore("flags");
          const getReq = flags.get("state");
          getReq.onsuccess = () => {
            const saved = getReq.result;
            if (!saved?.payload) return;
            const split = migrateV1Flags(saved.payload);
            for (const [store, rows] of Object.entries(split)) {
              if (!db.objectStoreNames.contains(store)) continue;
              const os = tx.objectStore(store);
              for (const row of rows) os.put(row);
            }
          };
        } catch {
          /* first run */
        }
      }
    };
    req.onsuccess = () => {
      cachedDb = req.result;
      cachedDb.onclose = () => {
        cachedDb = null;
      };
      cachedDb.onversionchange = () => {
        cachedDb.close();
        cachedDb = null;
      };
      resolve(cachedDb);
    };
    req.onblocked = () => reject(new Error("資料庫被其他分頁佔用，請關閉其他分頁後重試"));
    req.onerror = () => reject(req.error);
  });
}

export async function put(store, value) {
  const db = await openDb();
  return txPromise(db.transaction(store, "readwrite"), (tx) => {
    tx.objectStore(store).put(value);
    return value;
  });
}

export async function get(store, id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    tx.onabort = () => reject(tx.error || new Error("交易中止"));
    const r = tx.objectStore(store).get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function getAll(store) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    tx.onabort = () => reject(tx.error || new Error("交易中止"));
    const r = tx.objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}

export async function del(store, id) {
  const db = await openDb();
  return txPromise(db.transaction(store, "readwrite"), (tx) => {
    tx.objectStore(store).delete(id);
  });
}

export async function clearStore(store) {
  const db = await openDb();
  return txPromise(db.transaction(store, "readwrite"), (tx) => {
    tx.objectStore(store).clear();
  });
}

export async function saveAppState(state) {
  const split = splitStateToStores(state);
  const names = Object.keys(split).filter((n) => STORES.includes(n) && !SKIP_CLEAR_ON_SAVE.has(n));
  const db = await openDb();
  return txPromise(db.transaction(names, "readwrite"), (tx) => {
    for (const name of names) {
      const os = tx.objectStore(name);
      if (name !== "session") os.clear();
      for (const row of split[name]) os.put(row);
    }
  });
}

/**
 * 讀出資料庫目前的修訂號（每次成功存檔加 1 的計數）。
 * 白話：兩個分頁開著同一份資料時，別的分頁存過檔，這個數字就會變；匯出備份與產生上傳包前先對一下，
 * 就知道自己手上的資料是不是已經過期（F9-04）。
 */
export async function readRev() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("session", "readonly");
    tx.onabort = () => reject(tx.error || new Error("交易中止"));
    const r = tx.objectStore("session").get("rev");
    r.onsuccess = () => resolve(toCount(r.result?.value));
    r.onerror = () => reject(r.error);
  });
}

/** 啟動讀取：一般表整張讀，媒體與錄音分片的內容不讀（改由 getAllMeta 只取目錄）。 */
export async function loadAppState() {
  const db = await openDb();
  const names = STORES.filter((n) => db.objectStoreNames.contains(n) && !CONTENT_STORES.includes(n));
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, "readonly");
    const stores = {};
    tx.onabort = () => reject(tx.error || new Error("讀取中止"));
    tx.onerror = () => reject(tx.error || new Error("讀取失敗"));
    tx.oncomplete = () => resolve(storesToState(stores));
    for (const name of names) {
      const r = tx.objectStore(name).getAll();
      r.onsuccess = () => {
        stores[name] = r.result || [];
      };
      r.onerror = () => reject(r.error);
    }
  });
}

/** 只取目錄：用游標逐筆走訪並去掉內容，避免把所有照片與錄音一次讀進記憶體。 */
export async function getAllMeta(store) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const out = [];
    tx.onabort = () => reject(tx.error || new Error("交易中止"));
    tx.onerror = () => reject(tx.error || new Error("讀取失敗"));
    tx.oncomplete = () => resolve(out);
    const req = tx.objectStore(store).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      out.push(stripContent(cur.value));
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * 一筆提交 = 一個交易。先用 planCommit 做完所有檢查（此時還沒開交易），再落盤。
 * expectedRev 不是空值時，交易一開始先讀修訂號；不相符就中止並以 STALE 拒絕（另一個分頁已更新）。
 */
export async function commitTx(diff = {}, extras = {}, token = null, expectedRev = null) {
  if (liveGeneration != null && token !== liveGeneration) {
    throw new Error("世代不符，拒絕寫入");
  }
  const plan = planCommit(diff, extras);
  if (!plan.ok) throw new Error(plan.error);
  const useRev = expectedRev !== null && expectedRev !== undefined;
  const names = new Set(Object.keys(plan.tables));
  for (const rec of plan.puts) names.add(rec.store);
  if (plan.mediaPuts.length) names.add("media");
  if (plan.chunkPuts.length) names.add("audioChunks");
  if (plan.auditPuts.length) names.add("auditLog");
  for (const d of plan.deletes) names.add(d.store);
  for (const s of plan.clears) names.add(s);
  if (useRev) names.add("session");
  const storeNames = [...names].filter((n) => STORES.includes(n));
  if (!storeNames.length) return;
  const db = await openDb();
  return txPromise(db.transaction(storeNames, "readwrite"), (tx, abortWith) => {
    const apply = () => {
      for (const store of plan.clears) tx.objectStore(store).clear();
      for (const [name, rows] of Object.entries(plan.tables)) {
        const os = tx.objectStore(name);
        if (name !== "session") os.clear(); // session 表不整表清空，修訂號那一列要留著
        for (const row of rows) os.put(row);
      }
      for (const rec of plan.puts) tx.objectStore(rec.store).put(rec.value);
      for (const rec of plan.mediaPuts) tx.objectStore("media").put(rec);
      for (const rec of plan.chunkPuts) tx.objectStore("audioChunks").put(rec);
      for (const rec of plan.auditPuts) tx.objectStore("auditLog").put(rec);
      for (const rec of plan.deletes) tx.objectStore(rec.store).delete(rec.id);
      if (useRev) tx.objectStore("session").put({ id: "rev", value: expectedRev + 1 });
    };
    if (!useRev) {
      apply();
      return;
    }
    const req = tx.objectStore("session").get("rev");
    req.onsuccess = () => {
      const cur = toCount(req.result?.value);
      if (cur !== expectedRev) {
        abortWith(Object.assign(new Error("資料已被其他分頁更新"), { code: "STALE" }));
        return;
      }
      try {
        apply();
      } catch (err) {
        abortWith(err);
      }
    };
  });
}

let liveGeneration = null;
export function bindGeneration(token) {
  liveGeneration = token;
}

export function migrateLegacyFourStores(data = {}) {
  const next = { ...data };
  if (Array.isArray(data.idealProfile) && data.idealProfile[0] && (!data.profile || !Object.keys(data.profile).length)) {
    const { id, ...rest } = data.idealProfile[0];
    next.profile = rest;
  }
  if (Array.isArray(data.checklistResponses) && data.checklistResponses.length) {
    const viewings = [...(data.viewings || [])];
    for (const rec of data.checklistResponses) {
      const v = viewings.find((x) => x.id === rec.viewing_id);
      if (v) v.responses = { ...(v.responses || {}), ...(rec.responses || {}) };
    }
    next.viewings = viewings;
  }
  delete next.checklistResponses;
  delete next.checklistTemplates;
  delete next.idealProfile;
  delete next.privateVault;
  return next;
}

export async function appendAudit(entry) {
  const rec = { ...entry, id: dbId(), at: entry.at || new Date().toISOString() };
  await put("auditLog", rec);
  return rec;
}

export function createMemoryDb() {
  const data = {};
  for (const s of STORES) data[s] = [];
  let generation = null;
  function cloneStores() {
    const next = {};
    for (const k of Object.keys(data)) next[k] = data[k].map((row) => ({ ...row }));
    return next;
  }
  function swap(next) {
    for (const k of Object.keys(data)) delete data[k];
    for (const k of Object.keys(next)) data[k] = next[k];
  }
  const api = {
    async put(store, value) {
      data[store] = data[store] || [];
      const i = data[store].findIndex((x) => x.id === value.id);
      if (i >= 0) data[store][i] = value;
      else data[store].push(value);
      return value;
    },
    async getAll(store) {
      return [...(data[store] || [])];
    },
    async get(store, id) {
      return (data[store] || []).find((x) => x.id === id);
    },
    async del(store, id) {
      data[store] = (data[store] || []).filter((x) => x.id !== id);
    },
    async saveAppState(state) {
      const split = splitStateToStores(state);
      for (const [k, rows] of Object.entries(split)) {
        if (SKIP_CLEAR_ON_SAVE.has(k)) continue;
        data[k] = k === "session" ? upsertById([...(data[k] || []), ...rows]) : upsertById(rows);
      }
    },
    async loadAppState() {
      return storesToState(data);
    },
    /** 只取目錄（去掉內容）。用 this.getAll，包裝過 getAll 的替身會一起受影響。 */
    async getAllMeta(store) {
      return ((await this.getAll(store)) || []).map(stripContent);
    },
    bindGeneration(token) {
      generation = token;
    },
    async readRev() {
      return toCount((data.session || []).find((r) => r.id === "rev")?.value);
    },
    async commitTx(diff = {}, extras = {}, token = null, expectedRev = null) {
      if (generation != null && token !== generation) {
        throw new Error("世代不符，拒絕寫入");
      }
      const split = diff.split || (diff.state ? splitStateToStores(diff.state) : undefined);
      const prevCounts = diff.prevCounts
        || Object.fromEntries(Object.keys(split || {}).map((n) => [n, (data[n] || []).length]));
      const plan = planCommit({ ...diff, split, prevCounts }, extras);
      if (!plan.ok) throw new Error(plan.error);
      const useRev = expectedRev !== null && expectedRev !== undefined;
      if (useRev) {
        const cur = toCount((data.session || []).find((r) => r.id === "rev")?.value);
        if (cur !== expectedRev) {
          throw Object.assign(new Error("資料已被其他分頁更新"), { code: "STALE" });
        }
      }
      const snap = cloneStores();
      try {
        const next = cloneStores();
        for (const store of plan.clears) next[store] = [];
        for (const [name, rows] of Object.entries(plan.tables)) {
          if (name === "session") next.session = upsertById([...(next.session || []), ...rows]);
          else next[name] = upsertById(rows);
        }
        for (const rec of plan.puts) {
          next[rec.store] = upsertById([...(next[rec.store] || []), rec.value]);
        }
        for (const rec of plan.mediaPuts) next.media = upsertById([...(next.media || []), rec]);
        for (const rec of plan.chunkPuts) next.audioChunks = upsertById([...(next.audioChunks || []), rec]);
        for (const rec of plan.auditPuts) next.auditLog = upsertById([...(next.auditLog || []), rec]);
        for (const rec of plan.deletes) {
          next[rec.store] = (next[rec.store] || []).filter((x) => x.id !== rec.id);
        }
        if (useRev) next.session = upsertById([...(next.session || []), { id: "rev", value: expectedRev + 1 }]);
        swap(next);
      } catch (err) {
        swap(snap);
        throw err;
      }
    },
    async appendAudit(entry) {
      const rec = { ...entry, id: entry.id || dbId() };
      data.auditLog = data.auditLog || [];
      data.auditLog.push(rec);
      return rec;
    },
    migrateV1(payload) {
      const split = migrateV1Flags(payload);
      for (const [k, rows] of Object.entries(split)) data[k] = rows;
      return split;
    },
    _data: data
  };
  return api;
}
