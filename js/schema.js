/**
 * Small JSON Schema subset validator (draft 2020-12 features used by import_v1).
 * No external dependency.
 */
import { parseNumericRaw } from "./fields.js";

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function addError(errors, path, message) {
  errors.push({ path: path || "$", message });
}

export function isRealIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const parts = String(s).split("-");
  const y = parseNumericRaw(parts[0]).value;
  const m = parseNumericRaw(parts[1]).value;
  const d = parseNumericRaw(parts[2]).value;
  if (y == null || m == null || d == null) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function validateKeyword(value, schema, path, errors) {
  if (schema.const !== undefined && value !== schema.const) {
    addError(errors, path, `必須是 ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    addError(errors, path, `必須是 ${schema.enum.join("、")} 之一`);
  }
  if (schema.type) {
    const t = schema.type;
    const actual = typeOf(value);
    if (t === "integer") {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        addError(errors, path, "必須是整數");
      }
    } else if (t === "number") {
      if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
        addError(errors, path, "必須是有限數字");
      }
    } else if (t !== actual) {
      addError(errors, path, `型態必須是 ${t}`);
    }
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      addError(errors, path, `不可小於 ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      addError(errors, path, `不可大於 ${schema.maximum}`);
    }
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      addError(errors, path, `必須大於 ${schema.exclusiveMinimum}`);
    }
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
      addError(errors, path, `必須小於 ${schema.exclusiveMaximum}`);
    }
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      addError(errors, path, `長度不可少於 ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      addError(errors, path, `長度不可超過 ${schema.maxLength}`);
    }
    if (schema.pattern) {
      const re = new RegExp(schema.pattern);
        if (!re.test(value)) {
          addError(errors, path, "格式不符");
        }
      }
      if (schema.format === "date") {
        if (!isRealIsoDate(value)) addError(errors, path, "日期不存在");
      } else if (schema.pattern === "^\\d{4}-\\d{2}-\\d{2}$" && !schema.format) {
        if (!isRealIsoDate(value)) addError(errors, path, "日期不存在");
      }
    }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      addError(errors, path, `至少需要 ${schema.minItems} 筆`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      addError(errors, path, `最多 ${schema.maxItems} 筆`);
    }
    if (schema.items) {
      value.forEach((item, i) => {
        validateNode(item, schema.items, `${path}/${i}`, errors);
      });
    }
  }
  if (isObject(value) && schema.properties) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (value[key] === undefined || value[key] === null || value[key] === "") {
          addError(errors, `${path}/${key}`, "必填欄空白，已擋下");
        }
      }
    }
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (value[key] !== undefined && value[key] !== null && value[key] !== "") {
        validateNode(value[key], sub, `${path}/${key}`, errors);
      }
    }
  }
}

function validateNode(value, schema, path, errors) {
  if (!schema || typeof schema !== "object") return;
  validateKeyword(value, schema, path, errors);
}

/**
 * @param {unknown} data
 * @param {object} schema
 * @returns {{ ok: boolean, errors: {path:string, message:string}[] }}
 */
export function validateSchema(data, schema) {
  if (!schema || typeof schema !== "object") {
    return { ok: false, errors: [{ path: "schema", message: "缺少匯入規格，已擋下" }] };
  }
  const errors = [];
  validateNode(data, schema, "$", errors);
  return { ok: errors.length === 0, errors };
}

let cachedImportSchema = null;

export function setImportSchema(schema) {
  cachedImportSchema = schema || null;
  return cachedImportSchema;
}

export function getImportSchemaCached() {
  return cachedImportSchema;
}

const SCALAR_TABLES = ["settings", "finance", "profile", "scoring"];
const ARRAY_TABLES = ["areas", "agents", "travel"];

/**
 * Validate only fields that are present, using the same import schema.
 * Missing optional tables do not fail; illegal values name the field.
 */
export function validatePresentTables(data, schema = cachedImportSchema) {
  const errors = [];
  // 規格缺漏、資料不是物件、表的型別不對，一律不通過（不再故障放行）
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, errors: [{ path: "", message: "資料不是物件" }] };
  }
  if (!schema?.properties) {
    return { ok: false, errors: [{ path: "", message: "匯入規格缺漏，無法驗證" }] };
  }
  for (const key of SCALAR_TABLES) {
    const obj = data[key];
    if (obj !== undefined && obj !== null && (typeof obj !== "object" || Array.isArray(obj))) {
      errors.push({ path: key, message: "資料表型別不對，必須是物件" });
    }
  }
  for (const key of ARRAY_TABLES) {
    const rows = data[key];
    if (rows !== undefined && rows !== null && !Array.isArray(rows)) {
      errors.push({ path: key, message: "資料表型別不對，必須是清單" });
    }
  }
  if (errors.length) return { ok: false, errors };
  for (const key of SCALAR_TABLES) {
    const obj = data[key];
    const sub = schema.properties[key];
    if (!obj || typeof obj !== "object" || Array.isArray(obj) || !sub) continue;
    for (const [field, val] of Object.entries(obj)) {
      if (val === undefined || val === null || val === "") continue;
      const fs = sub.properties?.[field];
      if (!fs) continue;
      validateNode(val, fs, `${key}.${field}`, errors);
    }
  }
  for (const key of ARRAY_TABLES) {
    const rows = data[key];
    const sub = schema.properties[key];
    if (!Array.isArray(rows) || !sub) continue;
    rows.forEach((row, i) => {
      if (row && typeof row === "object") validateNode(row, sub.items || sub, `${key}.${i}`, errors);
    });
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Same required-plus-type checks as import for settings, finance, profile, areas.
 * Missing any required field (for example B06 down_has_borrowed) is an error.
 */
export function validateRequiredTables(data, schema = cachedImportSchema) {
  if (!schema?.properties) {
    return { ok: false, errors: [{ path: "schema", message: "缺少匯入規格，已擋下" }] };
  }
  const shaped = {
    schema_version: "import_v1",
    settings: data?.settings && typeof data.settings === "object" && !Array.isArray(data.settings) ? data.settings : {},
    finance: data?.finance && typeof data.finance === "object" && !Array.isArray(data.finance) ? data.finance : {},
    profile: data?.profile && typeof data.profile === "object" && !Array.isArray(data.profile) ? data.profile : {},
    areas: Array.isArray(data?.areas) ? data.areas : []
  };
  const subset = {
    type: "object",
    required: ["schema_version", "settings", "finance", "profile", "areas"],
    properties: {
      schema_version: schema.properties.schema_version || { const: "import_v1" },
      settings: schema.properties.settings,
      finance: schema.properties.finance,
      profile: schema.properties.profile,
      areas: schema.properties.areas
    }
  };
  const result = validateSchema(shaped, subset);
  return {
    ok: result.ok,
    errors: result.errors.map((e) => ({
      ...e,
      path: String(e.path || "").replace(/^\$\/?/, "").replace(/\//g, ".") || e.path
    }))
  };
}

export async function loadImportSchema() {
  if (typeof window === "undefined") {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const p = join(here, "../../schema/import_v1.schema.json");
    return JSON.parse(readFileSync(p, "utf8"));
  }
  const res = await fetch("schema/import_v1.schema.json");
  return res.json();
}
