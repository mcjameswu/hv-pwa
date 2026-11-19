/**
 * Single source of finance trust: verified / unverified / manual.
 * 財務信任只准從這裡寫入 finance_meta。
 */
import { financeContentHash, legacyFinanceContentText, stripFinanceMeta } from "./fields.js";
import { isRealIsoDate } from "./schema.js";

function independentSource(meta = {}) {
  return typeof meta.source === "string" && meta.source.trim() !== "";
}

/** v1.13.0 以前存的內容指紋是明文 JSON（以「{」開頭）；現在是 SHA-256。兩種格式都要認得（F-R11-04）。 */
export function isLegacyPlainHash(stored) {
  return typeof stored === "string" && stored.trimStart().startsWith("{");
}

/**
 * 已存的內容指紋和「目前這份財務內容」是不是同一份。
 * 新格式直接比 SHA-256；舊格式（明文 JSON）拿舊式明文比對，內容沒變就算相符。
 */
function storedHashMatches(stored, finance, hash) {
  if (typeof stored !== "string" || stored === "") return false;
  if (isLegacyPlainHash(stored)) return stored === legacyFinanceContentText(finance);
  return stored === hash;
}

/** 裝置本地日期 YYYY-MM-DD（用本地的年月日組，不經時區轉換）。 */
function localDateIso(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function asOfOk(asOf, now) {
  if (!isRealIsoDate(asOf)) return false;
  const n = typeof now === "number" ? now : Date.parse(now) || Date.now();
  // 比較日期字串：台灣時間凌晨 0 到 8 點，當天日期的快照不會被當成未來日期
  return asOf <= localDateIso(n);
}

export function defaultFinanceMeta() {
  return {
    origin: "manual",
    source: null,
    as_of: null,
    verified: false,
    content_hash: null,
    source_type: "manual_table"
  };
}

export function migrateFinanceMeta(state = {}) {
  const rawFinance = state.finance && typeof state.finance === "object" ? state.finance : {};
  const finance = stripFinanceMeta(rawFinance);
  const prev = state.finance_meta && typeof state.finance_meta === "object" ? { ...state.finance_meta } : {};
  const oldType = prev.origin || prev.source_type || rawFinance.origin || rawFinance.source_type || null;
  const origin = oldType === "housing_snapshot" ? "housing_snapshot" : "manual";
  const hasSource = independentSource(prev) || independentSource(rawFinance);
  const hash = financeContentHash(finance);
  // 舊格式（明文 JSON）一律改存新指紋，不再把財務明文留在 finance_meta；
  // 舊資料內容沒變就維持已核實，內容變了就清掉核實（F-R11-04）
  const legacyHash = isLegacyPlainHash(prev.content_hash);
  const meta = {
    origin,
    source: hasSource ? String(prev.source || rawFinance.source || "").trim() : null,
    as_of: prev.as_of || rawFinance.as_of || finance.finance_as_of || null,
    verified: false,
    content_hash: legacyHash ? hash : prev.content_hash || hash,
    source_type: origin === "housing_snapshot" ? "housing_snapshot" : "manual_table"
  };
  const hashMatches = storedHashMatches(prev.content_hash, finance, hash);
  if (prev.verified === true && hashMatches) {
    if (origin === "housing_snapshot") {
      if (hasSource) meta.verified = true;
    } else {
      meta.verified = true;
    }
  }
  applyFinanceMeta(state, meta);
  state.finance = finance;
  return state;
}

export function financeTrust(finance, meta, now = Date.now()) {
  const m = meta && typeof meta === "object" ? meta : {};
  // 只讀來源資訊（meta），不再退回財務表裡的同名欄位；舊資料由 migrateFinanceMeta 搬過來
  const originRaw = m.origin || m.source_type;
  const origin = originRaw === "housing_snapshot" ? "housing_snapshot" : "manual";
  if (origin !== "housing_snapshot") return "manual";
  const hash = financeContentHash(finance || {});
  const metaHash = typeof m.content_hash === "string" ? m.content_hash : null;
  const hashOk = !metaHash || storedHashMatches(metaHash, finance || {}, hash);
  const asOf = m.as_of || m.finance_as_of;
  const verifiedFlag = m.verified === true;
  const sourceMeta = independentSource(m);
  if (verifiedFlag && hashOk && asOfOk(asOf, now) && sourceMeta) {
    return "verified";
  }
  return "unverified";
}

export function nextFinanceMeta(prevMeta, { financeSheetSupplied, incomingMeta, nextFinance, confirmVerified = false } = {}) {
  const prev = prevMeta && typeof prevMeta === "object" ? { ...prevMeta } : defaultFinanceMeta();
  const hash = financeContentHash(nextFinance || {});
  if (confirmVerified) {
    return withType({
      ...prev,
      origin: prev.origin === "housing_snapshot" ? "housing_snapshot" : (prev.origin || "housing_snapshot"),
      source: independentSource(prev) ? String(prev.source).trim() : "本人確認",
      as_of: isRealIsoDate(prev.as_of) ? prev.as_of : (nextFinance?.finance_as_of || prev.as_of || null),
      verified: true,
      content_hash: hash
    });
  }
  if (!financeSheetSupplied) {
    const same = storedHashMatches(prev.content_hash, nextFinance || {}, hash);
    return withType({
      ...prev,
      verified: same ? prev.verified === true : false,
      content_hash: hash
    });
  }
  const inc = incomingMeta && typeof incomingMeta === "object" ? incomingMeta : {};
  const originRaw = inc.origin || inc.source_type || "manual_table";
  const origin = originRaw === "housing_snapshot" ? "housing_snapshot" : "manual";
  const source = independentSource(inc) ? String(inc.source).trim() : null;
  const asOf = inc.as_of || inc.finance_as_of || nextFinance?.finance_as_of || null;
  const incomingHash = typeof inc.content_hash === "string" ? inc.content_hash : null;
  const hashOk = incomingHash == null || storedHashMatches(incomingHash, nextFinance || {}, hash);
  return withType({
    origin,
    source,
    as_of: asOf,
    verified: origin === "housing_snapshot" && inc.verified === true && !!source && hashOk,
    content_hash: hash
  });
}

function withType(meta) {
  const origin = meta.origin || (meta.source_type === "housing_snapshot" ? "housing_snapshot" : meta.origin);
  return {
    ...meta,
    origin,
    source_type: origin === "housing_snapshot" ? "housing_snapshot" : "manual_table"
  };
}

export function applyFinanceMeta(target, meta) {
  target.finance_meta = meta && typeof meta === "object" ? { ...meta } : defaultFinanceMeta();
  return target.finance_meta;
}

export function applyNextFinanceMeta(target, opts) {
  return applyFinanceMeta(target, nextFinanceMeta(target.finance_meta, opts));
}

export function financeUnverified(finance, meta, now = Date.now()) {
  return financeTrust(finance, meta, now) === "unverified";
}

export function housingSnapshotExempt(incoming = {}, now = Date.now()) {
  const finance = incoming.finance || incoming;
  const meta = {
    origin: incoming.origin || incoming.source_type,
    source: incoming.source,
    as_of: incoming.as_of || incoming.finance_as_of || incoming.finance?.finance_as_of,
    verified: incoming.verified,
    content_hash: incoming.content_hash || financeContentHash(finance)
  };
  return financeTrust(finance, meta, now) === "verified";
}
