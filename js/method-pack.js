/**
 * Method pack loader. Accepts the fixture format (checklist, profile_fields,
 * key_point_cards, scoring) without baking any course item ids into the app.
 */

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
    return { ok: false, errors, phases: {}, cores: {}, meta: pack.meta || {} };
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
    if (item.input_type && !["text", "number", "select", "boolean", "photo", "check", "voice", "rating"].includes(item.input_type)) {
      errors.push({ message: `項目 ${item.id} 的輸入型態不支援` });
    }
  }
  for (const ph of PHASES) {
    if (cores[ph] < MIN_CORE[ph]) {
      errors.push({ message: `${ph}必做須至少 ${MIN_CORE[ph]} 項，目前 ${cores[ph]}` });
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    phases,
    cores,
    meta: pack.meta || {}
  };
}

export function packStats(pack) {
  const v = validateMethodPack(pack);
  return v;
}
