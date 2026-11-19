/**
 * Method pack loader. Accepts the fixture format (checklist, profile_fields,
 * key_point_cards, scoring) without baking any course item ids into the app.
 */

import { FIELD_TABLES, toFiniteNumber } from "./fields.js";
import { validateStages } from "./coach.js";

export const REQUIRED_KEYS = ["checklist"];
const PHASES = ["看房前", "現場", "看房後"];
const MIN_CORE = { 看房前: 11, 現場: 21, 看房後: 6 };

export function validateMethodPack(pack) {
  const errors = [];
  if (!pack || typeof pack !== "object") {
    return { ok: false, errors: [{ message: "方法包必須是 JSON 物件" }] };
  }
  if (!Array.isArray(pack.checklist) || pack.checklist.length < 10) {
    errors.push({ message: "方法包須含 checklist 陣列（建議至少 10 項）" });
    return { ok: false, errors, phases: {}, cores: {}, meta: pack.meta || {}, stagesPresent: false, stagesEnabled: false, stages: [], stageErrors: [], stageWarnings: [] };
  }
  const phases = { 看房前: 0, 現場: 0, 看房後: 0 };
  const cores = { 看房前: 0, 現場: 0, 看房後: 0 };
  const ids = new Set();
  for (const item of pack.checklist) {
    if (!item || typeof item !== "object") {
      errors.push({ message: "清單項目須為物件" });
      continue;
    }
    if (!item.id || !item.phase || !item.text) {
      errors.push({ message: "清單項目須有 id、phase、text" });
      continue;
    }
    if (!PHASES.includes(item.phase)) {
      errors.push({ message: `階段必須是看房前、現場或看房後：${item.phase}` });
    }
    if (ids.has(item.id)) errors.push({ message: `重複項目 ${item.id}` });
    ids.add(item.id);
    if (phases[item.phase] !== undefined) phases[item.phase] += 1;
    if (item.core === true && cores[item.phase] !== undefined) cores[item.phase] += 1;
    if (item.core && item.options && !Array.isArray(item.options)) {
      errors.push({ message: `項目 ${item.id} 的選項必須是陣列` });
    }
    // 看房前畫面要把區域資料顯示成提示的來源（第 12 輪 S5）：只認 area.區域欄位（欄位定義看 fields.js），寫別的就擋下，不默默略過
    if (item.prefill_from !== undefined && !isKnownPrefill(item.prefill_from)) {
      errors.push({ message: `項目 ${item.id} 的區域資料提示來源不認得：${String(item.prefill_from)}（只認 area. 加區域欄位名稱）` });
    }
    if (item.input_type && !["text", "number", "select", "boolean", "photo", "check", "voice", "rating"].includes(item.input_type)) {
      errors.push({ message: `項目 ${item.id} 的輸入型態不支援` });
    }
  }
  for (const ph of PHASES) {
    if (cores[ph] < MIN_CORE[ph]) {
      errors.push({ message: `${ph}必做須至少 ${MIN_CORE[ph]} 項，目前 ${cores[ph]}` });
    }
  }
  // 第 13 輪 C1：教練階段 stages 是選填的。結構有缺就列出錯誤（stageErrors）、教練不啟用，但不讓整個方法包失敗，
  // 方法包的清單照樣能用。白話：教練內容壞了，不能連帶讓看房清單也用不了。
  const stageInfo = validateStages(pack.stages, { checklist: pack.checklist });
  return {
    ok: errors.length === 0,
    errors,
    phases,
    cores,
    meta: pack.meta || {},
    stagesPresent: stageInfo.present,
    stagesEnabled: stageInfo.enabled,
    stages: stageInfo.stages,
    stageErrors: stageInfo.errors,
    stageWarnings: stageInfo.warnings
  };
}

/** prefill_from 只准寫 area.欄位名稱，欄位要是區域表真的有的（區域代號除外）。 */
export function isKnownPrefill(v) {
  const m = /^area.([a-z_]+)$/.exec(String(v));
  return Boolean(m && m[1] !== "area_code" && FIELD_TABLES.areas[m[1]]);
}

export function packVersionOf(pack) {
  return String(pack?.meta?.version ?? pack?.version ?? "");
}

/** 版本字串（例如 1.0、1.1、1.10）逐段比大小：前者大回 1、後者大回 -1、相同回 0。 */
export function compareVersions(a, b) {
  const pa = String(a ?? "").split(".").map((x) => toFiniteNumber(x) ?? 0);
  const pb = String(b ?? "").split(".").map((x) => toFiniteNumber(x) ?? 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** 是不是產品內建的通用方法包（來源是「通用」、代號以 method-generic 開頭）。使用者自己匯入的方法包不是。 */
export function isGenericPack(pack) {
  return String(pack?.meta?.origin ?? pack?.origin ?? "") === "通用" && /^method-generic/.test(String(pack?.meta?.id ?? pack?.id ?? ""));
}

/**
 * 手機上存的是舊版通用方法包、這次出貨的通用方法包版本比較新，才需要升級。
 * 白話：App 更新後，通用方法包多了三項區域功課，要讓手機換成新版；但使用者自己匯入的方法包一律不動，
 * 舊的看房紀錄用自己存的清單快照，不受影響。
 */
export function shouldUpgradeGenericPack(stored, shipped) {
  return isGenericPack(stored) && isGenericPack(shipped) && compareVersions(packVersionOf(shipped), packVersionOf(stored)) > 0;
}

export function packStats(pack) {
  const v = validateMethodPack(pack);
  return v;
}
