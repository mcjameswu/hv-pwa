/**
 * 從筆記匯入：讀檔並自動判斷是哪一種檔（第 12 輪 S4）。純函式加讀檔，不寫資料、不連網。
 * 白話：以前匯入頁只有「選檔」，使用者要自己知道選的是匯入表、方法包還是備份。現在只有一個「從筆記匯入」按鈕，
 * 選好檔案後這裡自動判斷是三種之一（匯入表含待看物件、方法包、加密備份），都不是就請使用者去雲端硬碟「看房同步」資料夾找。
 */
import { readXlsx } from "./xlsx.js";
import { parseSheetCsv, sheetsToImportJson, mergeWithCurrent } from "./csv.js";
import { sheetRowsToCsvText } from "./ui-logic.js";
import { validateBackupEnvelope, sha256hex } from "./backup.js";
import { classifyImportData, hasNotesProperties, UNKNOWN_FILE_MESSAGE } from "./notes-import.js";

/** Excel 分頁名稱對應的資料表（H 是第 12 輪新增的待看物件）。 */
export const XLSX_SHEET_KEYS = {
  A設定: "settings",
  B財務: "finance",
  C輪廓: "profile",
  D區域: "areas",
  E評分: "scoring",
  F仲介: "agents",
  G自住適配: "travel",
  G通勤: "travel",
  H待看物件: "properties"
};

const CSV_KEYS = ["settings", "finance", "profile", "areas", "scoring", "agents", "travel", "properties"];
const FULL_TABLES = ["settings", "finance", "profile", "areas"];

const unknown = (error = UNKNOWN_FILE_MESSAGE) => ({ ok: false, kind: "unknown", error });

function decode(buf) {
  return new TextDecoder().decode(buf);
}

/**
 * 讀一份或多份檔案，回傳：
 *  { ok: true, kind: "import_table", data, hash, name }  匯入表（已和手機上現有的資料合併成可預覽的樣子）
 *  { ok: true, kind: "method_pack", data, hash, name }   方法包
 *  { ok: true, kind: "backup", files: [備份封包...] }    加密備份（資料檔加媒體包可以一次選多個）
 *  { ok: false, kind: "unknown", error }                 看不懂（錯誤訊息是白話文字）
 * files 是任何有 name 與 arrayBuffer() 的物件（瀏覽器的 File 或測試用的假檔案）。state 是目前的資料（合併用）。
 */
export async function readImportFiles(files, state = {}) {
  const list = Array.from(files || []).filter(Boolean);
  if (!list.length) return unknown();

  // 全部都是 JSON 而且全部都是備份封包：加密備份（可多個檔一起）
  const jsons = [];
  for (const f of list) {
    if (!/\.json$/i.test(String(f.name || ""))) break;
    try {
      jsons.push({ f, obj: JSON.parse(decode(await f.arrayBuffer())) });
    } catch {
      return unknown("這個檔案不是正確的 JSON 格式，" + UNKNOWN_FILE_MESSAGE);
    }
  }
  if (jsons.length === list.length && jsons.every((x) => classifyImportData(x.obj) === "backup")) {
    for (const x of jsons) {
      const env = validateBackupEnvelope(x.obj);
      if (!env.ok) return unknown(env.error);
    }
    return { ok: true, kind: "backup", files: jsons.map((x) => x.obj) };
  }
  if (list.length > 1) return unknown("一次只能選一個匯入檔（加密備份可以一次選好幾個備份檔）");

  const file = list[0];
  const name = String(file.name || "");
  const buf = await file.arrayBuffer();
  const hash = await sha256hex(new Uint8Array(buf));

  if (/\.json$/i.test(name)) {
    const obj = jsons[0]?.obj;
    const kind = classifyImportData(obj);
    if (kind === "method_pack") return { ok: true, kind, data: obj, hash, name };
    if (kind === "import_table") {
      // 只帶部分表格、或帶了待看物件的檔案，不能把手機上本來有的區域、仲介整張換掉：照 CSV 的做法依主鍵合併
      const partial = !FULL_TABLES.every((k) => obj[k] !== undefined && obj[k] !== null);
      const data = partial || hasNotesProperties(obj) ? mergeWithCurrent(obj, state) : obj;
      return { ok: true, kind, data, hash, name };
    }
    return unknown();
  }

  if (/\.xlsx$/i.test(name)) {
    let parsed;
    try {
      const { sheets } = await readXlsx(buf);
      parsed = {};
      let matched = 0;
      for (const [sheetName, rows] of Object.entries(sheets)) {
        const key = XLSX_SHEET_KEYS[sheetName];
        if (!key) continue;
        matched += 1;
        const p = parseSheetCsv(key, sheetRowsToCsvText(rows));
        if (!p.ok) return unknown(`${sheetName}分頁：${p.errors[0].message}`);
        parsed[key] = p.records;
      }
      if (!matched) return unknown();
    } catch {
      return unknown();
    }
    return { ok: true, kind: "import_table", data: mergeWithCurrent(sheetsToImportJson(parsed), state), hash, name };
  }

  if (/\.csv$/i.test(name)) {
    const text = decode(buf);
    for (const key of CSV_KEYS) {
      const p = parseSheetCsv(key, text);
      if (p.ok) {
        return { ok: true, kind: "import_table", data: mergeWithCurrent(sheetsToImportJson({ [key]: p.records }), state), hash, name };
      }
    }
    return unknown();
  }

  return unknown();
}
