/**
 * One merge rule for single-page import, restore-previous-batch, and backup restore.
 * 單頁匯入、還原上一批、備份還原共用這份合併。
 */

export const TABLE_IDS = {
  areas: "area_code",
  agents: "slot_id",
  travel: "place_alias"
};

export const SCALAR_TABLES = ["settings", "finance", "profile", "scoring"];
export const ARRAY_TABLES = ["areas", "agents", "travel"];
export const CORE_TABLES = [...SCALAR_TABLES, ...ARRAY_TABLES];

export function cloneValue(v) {
  if (v === undefined) return undefined;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(v);
    } catch {
      /* fall through */
    }
  }
  return JSON.parse(JSON.stringify(v));
}

export function cloneDataset(data = {}) {
  const out = {};
  for (const key of CORE_TABLES) {
    if (data[key] !== undefined) out[key] = cloneValue(data[key]);
  }
  return out;
}

export function importedKeysOf(incoming = {}) {
  if (Array.isArray(incoming._importedKeys)) return [...incoming._importedKeys];
  return CORE_TABLES.filter((k) => incoming[k] !== undefined && incoming[k] !== null);
}

export function upsertRows(currentRows, incomingRows, idKey) {
  const cur = Array.isArray(currentRows) ? currentRows : [];
  const inc = Array.isArray(incomingRows) ? incomingRows : [];
  if (!inc.length) return cur.map((row) => ({ ...row }));
  const map = new Map();
  let n = 0;
  for (const row of cur) {
    const id = row?.[idKey];
    map.set(id || `cur-${n++}`, { ...row });
  }
  for (const row of inc) {
    const id = row?.[idKey];
    if (id && map.has(id)) map.set(id, { ...map.get(id), ...row });
    else map.set(id || `inc-${n++}`, { ...row });
  }
  return [...map.values()];
}

/**
 * @param {"upsert"|"replace"} mode upsert = single-page import; replace = restore / backup
 */
export function mergeDataset(current = {}, incoming = {}, { mode = "upsert" } = {}) {
  const importedKeys = importedKeysOf(incoming);
  if (mode === "replace") {
    return {
      settings: { ...(incoming.settings || {}) },
      finance: { ...(incoming.finance || {}) },
      profile: { ...(incoming.profile || {}) },
      scoring: { ...(incoming.scoring || {}) },
      areas: Array.isArray(incoming.areas) ? incoming.areas.map((r) => ({ ...r })) : [],
      agents: Array.isArray(incoming.agents) ? incoming.agents.map((r) => ({ ...r })) : [],
      travel: Array.isArray(incoming.travel) ? incoming.travel.map((r) => ({ ...r })) : [],
      _importedKeys: importedKeys,
      _mode: "replace"
    };
  }
  const out = {
    settings: { ...(current.settings || {}) },
    finance: { ...(current.finance || {}) },
    profile: { ...(current.profile || {}) },
    scoring: { ...(current.scoring || {}) },
    areas: Array.isArray(current.areas) ? current.areas.map((r) => ({ ...r })) : [],
    agents: Array.isArray(current.agents) ? current.agents.map((r) => ({ ...r })) : [],
    travel: Array.isArray(current.travel) ? current.travel.map((r) => ({ ...r })) : [],
    _importedKeys: importedKeys,
    _mode: "upsert"
  };
  if (incoming.settings) Object.assign(out.settings, incoming.settings);
  if (incoming.finance) Object.assign(out.finance, incoming.finance);
  if (incoming.profile) Object.assign(out.profile, incoming.profile);
  if (incoming.scoring) Object.assign(out.scoring, incoming.scoring);
  if (incoming.areas) out.areas = upsertRows(current.areas, incoming.areas, TABLE_IDS.areas);
  if (incoming.agents) out.agents = upsertRows(current.agents, incoming.agents, TABLE_IDS.agents);
  if (incoming.travel) out.travel = upsertRows(current.travel, incoming.travel, TABLE_IDS.travel);
  return out;
}

export function stableAuditKey(entry) {
  if (!entry || typeof entry !== "object") return String(entry);
  const { id: _id, source: _s, replaced_id: _r, ...rest } = entry;
  return JSON.stringify(rest);
}

function sameAuditContent(a, b) {
  if (!a || !b) return false;
  return stableAuditKey(a) === stableAuditKey(b);
}

/**
 * Audit is append-only. Same id + different content: keep local, append incoming with a new id.
 */
export function mergeAuditLogs(local = [], incoming = [], { nextId, source = "backup" } = {}) {
  let n = 0;
  const gen = () => {
    n += 1;
    const base = typeof nextId === "function" ? nextId() : `au-${Date.now()}`;
    return `${base}-${n}-${Math.random().toString(16).slice(2, 10)}`;
  };
  const out = [];
  const used = new Set();
  for (const a of local || []) {
    const rec = { ...a, id: a?.id || gen() };
    if (used.has(rec.id)) rec.id = gen();
    used.add(rec.id);
    out.push(rec);
  }
  const localById = new Map(out.map((r) => [r.id, r]));
  for (const a of incoming || []) {
    if (!a || typeof a !== "object") continue;
    const rawId = a.id;
    const existing = rawId ? localById.get(rawId) : null;
    if (existing && sameAuditContent(existing, a)) continue;
    if (existing && !sameAuditContent(existing, a)) {
      let nid = gen();
      while (used.has(nid)) nid = gen();
      const rec = { ...a, id: nid, source, replaced_id: rawId };
      used.add(rec.id);
      out.push(rec);
      continue;
    }
    let nid = rawId || gen();
    if (used.has(nid)) nid = gen();
    while (used.has(nid)) nid = gen();
    const rec = { ...a, id: nid };
    used.add(rec.id);
    out.push(rec);
    localById.set(rec.id, rec);
  }
  return out;
}

function stable(v) {
  if (v === undefined) return "（空）";
  if (v === null) return "（空）";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function scalarDiff(group, key, fromVal, toVal, out) {
  if (stable(fromVal) === stable(toVal)) return;
  out.push({
    table: group,
    key,
    kind: "change",
    field: `${group}.${key}`,
    from: fromVal ?? "（空）",
    to: toVal ?? "（空）",
    text: `${group}.${key}：${stable(fromVal)} → ${stable(toVal)}`,
    tableName: group
  });
}

/**
 * Row and field diffs from the final merged dataset, the same object that will be written.
 * 每筆差異都是結構化的：{ table, rowKey, rowIndex, key, from, to, kind }，kind 是 change、add_row、remove_row。
 * 比對前去掉系統補的 id（匯入檔的列沒有 id，目前狀態的列有，不然每次預覽都會出現假差異）。
 */
export function diffDataset(prev = {}, next = {}) {
  const changes = [];
  for (const group of SCALAR_TABLES) {
    const a = prev[group] || {};
    const b = next[group] || {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (k.startsWith("_")) continue;
      scalarDiff(group, k, a[k], b[k], changes);
    }
  }
  for (const group of ARRAY_TABLES) {
    const idKey = TABLE_IDS[group];
    const aRows = Array.isArray(prev[group]) ? prev[group] : [];
    const bRows = Array.isArray(next[group]) ? next[group] : [];
    const aMap = new Map(aRows.map((r, i) => [r?.[idKey] || `a-${i}`, { row: r, index: i }]));
    const bMap = new Map(bRows.map((r, i) => [r?.[idKey] || `b-${i}`, { row: r, index: i }]));
    for (const [id, { row, index }] of bMap) {
      if (!aMap.has(id)) {
        changes.push({
          table: group,
          rowKey: id,
          rowIndex: index,
          kind: "add_row",
          field: `${group}[${index + 1}]`,
          from: "（無此列）",
          to: id,
          text: `${group} 新增 ${id}`
        });
        continue;
      }
      const prevRow = aMap.get(id).row || {};
      const keys = new Set([...Object.keys(prevRow), ...Object.keys(row || {})]);
      for (const k of keys) {
        if (k === "id") continue;
        if (stable(prevRow[k]) !== stable(row[k])) {
          changes.push({
            table: group,
            rowKey: id,
            rowIndex: index,
            key: k,
            kind: "change",
            field: `${group}[${index + 1}].${k}`,
            from: prevRow[k] ?? "（空）",
            to: row[k] ?? "（空）",
            text: `${group} ${id}.${k}：${prevRow[k] ?? "（空）"} → ${row[k] ?? "（空）"}`
          });
        }
      }
    }
    for (const [id, { index }] of aMap) {
      if (!bMap.has(id)) {
        changes.push({
          table: group,
          rowKey: id,
          rowIndex: index,
          kind: "remove_row",
          field: `${group}[${index + 1}]`,
          from: id,
          to: "（刪）",
          text: `${group} 移除 ${id}`
        });
      }
    }
  }
  return changes;
}
