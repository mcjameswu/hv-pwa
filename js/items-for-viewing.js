/**
 * Single reader for checklist items of a viewing.
 * 看房題目只准從這裡讀：有完整快照用完整快照，其次必做快照，再來登錄表，
 * 找不到當時那一版就當未知（不退回「代號與版本字串相同」的目前方法包）。
 */

function fnv(payload) {
  let h = 2166136261;
  for (let i = 0; i < payload.length; i += 1) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `pk-${(h >>> 0).toString(16)}`;
}

/** 舊算法（v1.11.0 以前）：不含題型。登錄表查找時兩種算法都試。 */
export function packContentHashV1(pack) {
  return fnv(
    JSON.stringify({
      id: pack?.meta?.id || pack?.id || "",
      version: pack?.meta?.version || pack?.version || "",
      checklist: (pack?.checklist || []).map((i) => ({
        id: i.id,
        text: i.text,
        phase: i.phase,
        core: i.core === true,
        condition_key: i.condition_key || null,
        screen_key: i.screen_key || null,
        options: i.options || null,
        veto: i.veto || null
      }))
    })
  );
}

/** 新算法：納入題型 input_type（與 snapshotItems 一致）。 */
export function packContentHash(pack) {
  return fnv(
    JSON.stringify({
      id: pack?.meta?.id || pack?.id || "",
      version: pack?.meta?.version || pack?.version || "",
      checklist: (pack?.checklist || []).map((i) => ({
        id: i.id,
        text: i.text,
        phase: i.phase,
        core: i.core === true,
        condition_key: i.condition_key || null,
        screen_key: i.screen_key || null,
        input_type: i.input_type || null,
        options: i.options || null,
        veto: i.veto || null
      }))
    })
  );
}

export function snapshotItems(pack) {
  return (pack?.checklist || []).map((i) => ({
    id: i.id,
    text: i.text,
    phase: i.phase,
    core: i.core === true,
    options: i.options ? [...i.options] : undefined,
    condition_key: i.condition_key || null,
    screen_key: i.screen_key || null,
    veto: i.veto || null,
    input_type: i.input_type || null
  }));
}

function hashMatches(pack, hash) {
  return packContentHash(pack) === hash || packContentHashV1(pack) === hash;
}

function packFromRegistry(state, hash) {
  const packs = state?.methodPacks || [];
  const hit = packs.find((p) => p?.hash === hash) || packs.find((p) => p?.pack && hashMatches(p.pack, hash));
  return hit?.pack || null;
}

export function itemsForViewing(state, viewing) {
  if (!viewing) return [];
  if (Array.isArray(viewing.items_snapshot) && viewing.items_snapshot.length) {
    return viewing.items_snapshot;
  }
  if (Array.isArray(viewing.core_snapshot) && viewing.core_snapshot.length) {
    return viewing.core_snapshot;
  }
  const current = state?.methodPack;
  if (viewing.pack_hash) {
    const stored = packFromRegistry(state, viewing.pack_hash);
    if (stored?.checklist?.length) return stored.checklist;
    // 登錄表找不到那一版：只有目前方法包的內容雜湊正好等於當時的雜湊才用目前的，否則當未知
    if (current?.checklist?.length && hashMatches(current, viewing.pack_hash)) return current.checklist;
    return [];
  }
  const curId = current?.meta?.id || current?.id;
  const curVer = current?.meta?.version || current?.version;
  const sameId = viewing.method_pack_id && curId && viewing.method_pack_id === curId;
  const sameVer = viewing.method_pack_version && curVer && String(viewing.method_pack_version) === String(curVer);
  if (sameId && sameVer && current?.checklist) return current.checklist;
  // 只記了版本、沒有方法包代號的舊紀錄：版本和目前方法包相同，就視為同一套題目（F-R11-05）；版本不同仍當未知
  if (!viewing.method_pack_id && sameVer && current?.checklist) return current.checklist;
  if (!viewing.method_pack_id && !viewing.method_pack_version && current?.checklist) return current.checklist;
  return [];
}

/** 完全沒有任何版本資訊的舊紀錄：以目前方法包解讀，必須讓使用者知道。 */
export function itemsAssumed(state, viewing) {
  if (!viewing) return false;
  if (Array.isArray(viewing.items_snapshot) && viewing.items_snapshot.length) return false;
  if (Array.isArray(viewing.core_snapshot) && viewing.core_snapshot.length) return false;
  if (viewing.pack_hash || viewing.method_pack_id || viewing.method_pack_version) return false;
  return Boolean(state?.methodPack?.checklist?.length);
}

export function itemsUnknown(state, viewing) {
  if (!viewing) return false;
  return itemsForViewing(state, viewing).length === 0;
}
