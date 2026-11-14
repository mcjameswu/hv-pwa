import { SHEET_COLUMNS, NUMBER_FIELDS, LEGACY_SHEET_TITLES } from "./defaults.js";
import { mergeDataset } from "./merge.js";
import { parseNumberForKey } from "./fields.js";

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;
  const s = String(text).replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n") {
      if (cur.endsWith("\r")) cur = cur.slice(0, -1);
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += c;
  }
  if (cur.length || row.length) {
    if (cur.endsWith("\r")) cur = cur.slice(0, -1);
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ""));
}

export function csvEscape(v) {
  const s = v === undefined || v === null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows) {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n") + "\n";
}

/**
 * Fail-safe: row 1 titles and row 2 codes must match expected order exactly.
 */
export function parseSheetCsv(sheetKey, text) {
  const spec = SHEET_COLUMNS[sheetKey];
  if (!spec) return { ok: false, errors: [{ message: `未知分頁 ${sheetKey}` }] };
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return { ok: false, errors: [{ message: "缺少標題列或欄位代號列，已拒收" }] };
  }
  const titles = rows[0].map((c) => String(c).trim());
  const codes = rows[1].map((c) => String(c).trim());
  const expectedTitles = spec.map((x) => x[0]);
  const expectedCodes = spec.map((x) => x[1]);
  if (titles.length !== expectedTitles.length || codes.length !== expectedCodes.length) {
    return {
      ok: false,
      errors: [{ message: "第 1 列標題被刪或欄位順序被改，程式拒收而不是錯位匯入" }]
    };
  }
  for (let i = 0; i < expectedTitles.length; i++) {
    const legacyOk = (LEGACY_SHEET_TITLES[expectedCodes[i]] || []).includes(titles[i]);
    if ((titles[i] !== expectedTitles[i] && !legacyOk) || codes[i] !== expectedCodes[i]) {
      return {
        ok: false,
        errors: [{ message: "第 1 列標題被刪或欄位順序被改，程式拒收而不是錯位匯入" }]
      };
    }
  }
  // 單列型分頁（設定、財務、輪廓、評分）只能有一列資料；多的列不能默默丟掉
  const SINGLE_ROW = new Set(["settings", "finance", "profile", "scoring"]);
  const dataRows = rows.slice(2);
  if (SINGLE_ROW.has(sheetKey) && dataRows.length > 1) {
    return { ok: false, errors: [{ message: "這個分頁只能有一列資料，第 2 列以後的資料沒有地方放，已拒收" }] };
  }
  // 任何資料列在預期欄數之後還有內容，表示欄位順序或欄數被改過，安全失敗
  for (let r = 2; r < rows.length; r++) {
    const extra = rows[r].slice(expectedCodes.length).some((cell) => String(cell).trim() !== "");
    if (extra) {
      return { ok: false, errors: [{ message: `第 ${r + 1} 列多出欄位，請確認沒有改動欄位順序，已拒收` }] };
    }
  }
  const records = [];
  for (let r = 2; r < rows.length; r++) {
    const obj = {};
    for (let c = 0; c < expectedCodes.length; c++) {
      const key = expectedCodes[c];
      let val = rows[r][c] === undefined ? "" : String(rows[r][c]).trim();
      if (val === "") {
        obj[key] = undefined;
        continue;
      }
      if (NUMBER_FIELDS.has(key)) {
        // 依欄位的單位解析：萬元金額收「1500萬」，元金額收「3千」，其餘欄位只收純數字（F9-05）
        const parsed = parseNumberForKey(key, val);
        if (parsed.state !== "ok" || !Number.isFinite(parsed.value)) {
          return {
            ok: false,
            errors: [{ message: parsed.reason === "unit" || parsed.reason === "range" ? `${key} ${parsed.error}` : `${key} 格式錯誤`, field: key }]
          };
        }
        obj[key] = parsed.value;
      } else obj[key] = val;
    }
    records.push(obj);
  }
  return { ok: true, records };
}

export function buildTemplateCsv(sheetKey, exampleRow) {
  const spec = SHEET_COLUMNS[sheetKey];
  const header = spec.map((x) => x[0]);
  const codes = spec.map((x) => x[1]);
  const rows = Array.isArray(exampleRow) ? exampleRow : exampleRow ? [exampleRow] : [{}];
  const dataRows = rows.map((row) =>
    spec.map((x) => {
      const v = row ? row[x[1]] : "";
      return v === undefined || v === null ? "" : String(v);
    })
  );
  return toCsv([header, codes, ...dataRows]);
}

export function sheetsToImportJson(parsed) {
  const data = {
    schema_version: "import_v1"
  };
  if (parsed.finance) {
    data.source_type = "manual_table";
    data.finance = parsed.finance[0] || {};
  }
  if (parsed.settings) data.settings = parsed.settings[0] || {};
  if (parsed.profile) data.profile = parsed.profile[0] || {};
  if (parsed.areas) data.areas = parsed.areas;
  if (parsed.scoring) data.scoring = parsed.scoring[0] || {};
  if (parsed.agents) data.agents = parsed.agents;
  if (parsed.travel) data.travel = parsed.travel;
  return data;
}

/** Single-tab CSV merges with current state before validation. */
export function mergeWithCurrent(partial, current = {}) {
  const merged = mergeDataset(current, partial, { mode: "upsert" });
  const financeSheet = Array.isArray(merged._importedKeys) && merged._importedKeys.includes("finance");
  return {
    schema_version: partial.schema_version || "import_v1",
    source_type: financeSheet ? (partial.source_type || "manual_table") : current.source_type,
    origin: financeSheet ? (partial.origin || partial.source_type) : (current.origin || current.finance_meta?.origin),
    source: financeSheet ? partial.source : (current.source || current.finance_meta?.source),
    as_of: financeSheet ? (partial.as_of || partial.finance_as_of) : (current.as_of || current.finance_meta?.as_of),
    verified: financeSheet ? partial.verified : (current.verified ?? current.finance_meta?.verified),
    settings: merged.settings,
    finance: merged.finance,
    profile: merged.profile,
    areas: merged.areas,
    scoring: merged.scoring,
    agents: merged.agents,
    travel: merged.travel,
    _importedKeys: merged._importedKeys
  };
}
