/**
 * One splitter for list fields: half-width comma, full-width comma, enumeration comma.
 * 半形逗號、全形逗號、頓號只在這裡切一次。
 */

export const LIST_SPLIT_RE = /[,，、]/;

export function splitList(value) {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((x) => splitList(x))
      .map((x) => String(x).trim())
      .filter(Boolean);
  }
  return String(value)
    .split(LIST_SPLIT_RE)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function joinList(values, sep = "、") {
  if (values === undefined || valueIsEmpty(values)) return "";
  if (!Array.isArray(values)) return splitList(values).join(sep);
  return values.filter((x) => !valueIsEmpty(x)).map((x) => String(x).trim()).filter(Boolean).join(sep);
}

function valueIsEmpty(v) {
  return v === undefined || v === null || v === "";
}

export function listsEqual(a, b) {
  const x = splitList(a);
  const y = splitList(b);
  if (x.length !== y.length) return false;
  return x.every((item, i) => item === y[i]);
}
