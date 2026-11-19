/**
 * Single entry for changing budget or profile thresholds.
 * Settings, import and restore-previous-batch all call this.
 */
import { checkB13, coolingDeadline } from "./b13.js";
import { FIELD_LABELS, WEIGHT_SUM_TOLERANCE, DEFAULT_SCORING } from "./defaults.js";
import { splitList } from "./lists.js";
import { mergeDataset } from "./merge.js";
import { parseNumericRaw, parseAmountWan, capIsBlank as fieldCapIsBlank, normalizeValue, FIELD_TABLES, META_FINANCE_KEYS } from "./fields.js";

function isBlank(v) {
  return v === undefined || v === null || v === "";
}

/**
 * Accept 1500, 1,500, 1500萬, 1.5千萬. Blank, NaN or <= 0 => 上限待填.
 */
export function parseThresholdNumber(raw) {
  const parsed = parseAmountWan(raw);
  if (parsed.state === "blank") return { blank: true, value: null };
  if (parsed.state !== "ok" || parsed.value <= 0) return { blank: true, value: null, invalid: true };
  return { blank: false, value: parsed.value };
}

export function capIsBlank(finance) {
  return fieldCapIsBlank(finance);
}

export function startCoolingRecord({ field, from, to, reason, now, hits }) {
  let started = now ? new Date(now) : new Date();
  if (Number.isNaN(started.getTime())) started = new Date(); // 傳入的時間無效就改用目前時間
  const recHits = hits && hits.length ? hits : [{ field, from, to }];
  const first = recHits[0] || {};
  return {
    field: first.field || field || "threshold",
    from: first.from,
    to: first.to,
    hits: recHits,
    reason: (reason || "").trim(),
    startedAt: started.toISOString(),
    until: coolingDeadline(started.getTime())
  };
}

function cloneState(current) {
  return {
    settings: { ...(current?.settings || {}) },
    finance: { ...(current?.finance || {}) },
    profile: { ...(current?.profile || {}) },
    scoring: { ...(current?.scoring || {}) },
    areas: current?.areas || [],
    agents: current?.agents || [],
    travel: current?.travel || []
  };
}

function collectAudit(prev, next, opts) {
  const audit = [];
  const at = new Date(opts.now || Date.now()).toISOString();
  for (const group of ["finance", "profile", "scoring", "settings"]) {
    const a = prev[group] || {};
    const b = next[group] || {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const same = JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null);
      if (!same) {
        audit.push({
          type: "threshold_change",
          field: k,
          fieldLabel: FIELD_LABELS[k] || k,
          from: a[k],
          to: b[k],
          at,
          reason: opts.reason || ""
        });
      }
    }
  }
  return audit;
}

/** 這些欄位的值由別處另外檢查，不在這裡逐欄正規化。 */
const SKIP_NORMALIZE = new Set(["staged_offer_steps", "version"]);

/**
 * 把財務、設定、評分三組每個有規格的欄位先正規化再比（布林值 false 變「否」、"1,500萬" 變 1500），
 * 讓門檻保護看到的值，等於之後存進去的值。
 * 舊資料本來就不合規格、而且這次沒碰那一格的，放過去（不鎖死，交給首頁待修正清單）。
 */
function normalizeGroups(current, next) {
  for (const group of ["finance", "profile", "settings", "scoring"]) {
    const obj = next[group];
    if (!obj || typeof obj !== "object") continue;
    for (const [k, v] of Object.entries(obj)) {
      if (SKIP_NORMALIZE.has(k)) continue;
      if (group === "finance" && META_FINANCE_KEYS.has(k)) continue;
      if (!FIELD_TABLES[group]?.[k]) continue;
      const r = normalizeValue(group, k, v);
      if (r.state === "ok") {
        obj[k] = r.value;
      } else if (r.state === "invalid") {
        const before = current?.[group]?.[k];
        if (JSON.stringify(v ?? null) === JSON.stringify(before ?? null)) continue;
        return {
          ok: false,
          error: `${FIELD_LABELS[k] || k} ${r.error}`,
          message: `${FIELD_LABELS[k] || k} ${r.error}`,
          errors: [{ field: k, message: r.error }]
        };
      }
    }
  }
  return null;
}

/**
 * Apply a threshold patch. Format check, B03 < B01, B13 cooling, audit.
 */
export function applyThresholdChange(current, patch = {}, opts = {}) {
  const next = opts.fullReplace
    ? (() => {
        const replaced = mergeDataset({}, patch, { mode: "replace" });
        delete replaced._importedKeys;
        delete replaced._mode;
        return replaced;
      })()
    : cloneState(current);
  if (!opts.fullReplace) {
    if (patch.settings) Object.assign(next.settings, patch.settings);
    if (patch.finance) Object.assign(next.finance, patch.finance);
    if (patch.profile) Object.assign(next.profile, patch.profile);
    if (patch.scoring) Object.assign(next.scoring, patch.scoring);
    if (patch.areas) next.areas = patch.areas;
    if (patch.agents) next.agents = patch.agents;
    if (patch.travel) next.travel = patch.travel;
  }

  const warnings = [];
  if (!opts.fullReplace && patch.scoring) {
    for (const k of Object.keys(patch.scoring)) {
      const v = patch.scoring[k];
      if (v === "" || v === null) {
        return {
          ok: false,
          error: "這一格不能留空",
          message: `評分設定「${FIELD_LABELS[k] || k}」這一格不能留空（要恢復預設請填預設值）`
        };
      }
    }
  }
  if (patch.finance && "budget_cap_total" in patch.finance) {
    const p = parseThresholdNumber(patch.finance.budget_cap_total);
    if (p.invalid) {
      return { ok: false, error: "上限格式錯誤", message: "上限格式錯誤，已擋下" };
    }
    // 上限只能由本人手打（"typed"）、匯入時手打核對通過（"import-gated"）或整份還原備份（"backup"）寫入；沒標來源一律擋
    const cur = parseThresholdNumber(current?.finance?.budget_cap_total);
    const unchanged = p.blank === cur.blank && p.value === cur.value;
    const src = opts.b01Source;
    const allowed = src === "typed" || src === "import-gated" || (src === "backup" && opts.fullReplace === true);
    if (!unchanged && !allowed) {
      return { ok: false, error: "上限須本人手打", message: "上限須本人手打，匯入檔不得直接寫入" };
    }
    next.finance.budget_cap_total = p.blank ? "" : p.value;
  }
  const normalizeError = normalizeGroups(current, next);
  if (normalizeError) return normalizeError;
  if (patch.finance && "search_range_high" in patch.finance) {
    const p = parseThresholdNumber(patch.finance.search_range_high);
    if (p.invalid) {
      return { ok: false, error: "對外說的上緣格式錯誤", message: "對外說的上緣格式錯誤，已擋下" };
    }
    if (!p.blank) next.finance.search_range_high = p.value;
  }

  const b01 = parseThresholdNumber(next.finance.budget_cap_total);
  const b02 = parseThresholdNumber(next.finance.search_range_low);
  const b03 = parseThresholdNumber(next.finance.search_range_high);
  if (!b02.blank && !b03.blank && b02.value >= b03.value) {
    return {
      ok: false,
      error: "下緣必須小於上緣",
      message: "下緣必須小於上緣"
    };
  }
  if (!b01.blank && !b03.blank && b03.value >= b01.value) {
    return {
      ok: false,
      error: "對外說的上緣必須小於可承受上限",
      message: "對外說的上緣必須小於可承受上限"
    };
  }
  const stepsRaw = next.finance?.staged_offer_steps;
  if (stepsRaw !== undefined && stepsRaw !== null && stepsRaw !== "") {
    const rawParts = Array.isArray(stepsRaw) ? stepsRaw : splitList(stepsRaw);
    const steps = [];
    for (const part of rawParts) {
      const parsed = parseAmountWan(part);
      if (parsed.state !== "ok" || !Number.isFinite(parsed.value) || parsed.value <= 0) {
        return { ok: false, error: "分段出價含非正數或非數字", message: "分段出價必須是正數，已擋下" };
      }
      steps.push(parsed.value);
    }
    for (let i = 1; i < steps.length; i++) {
      if (!(steps[i] > steps[i - 1])) {
        return { ok: false, error: "分段出價必須嚴格遞增", message: "分段出價必須嚴格遞增" };
      }
    }
    if (steps.length && !b01.blank && Math.max(...steps) > b01.value) {
      return {
        ok: false,
        error: "分段出價最大值不得超過上限",
        message: "分段出價最大值不得超過上限"
      };
    }
    if (b01.blank && steps.length) {
      warnings.push({ field: "staged_offer_steps", message: "上限待填時分段出價僅供預覽，尚未生效" });
    }
  }
  const bandRaw = next.profile?.price_band;
  if (bandRaw) {
    const bandChanged = opts.fullReplace || bandRaw !== current?.profile?.price_band;
    const m = String(bandRaw).match(/^\s*(\d+(?:\.\d+)?)\s*[-~～到至]\s*(\d+(?:\.\d+)?)\s*$/);
    if (bandChanged && !m) {
      return {
        ok: false,
        error: "合理總價帶格式錯誤",
        message: "合理總價帶格式錯誤，請填 下限-上限"
      };
    }
    if (m) {
      const lowBand = parseNumericRaw(m[1]).value;
      const highBand = parseNumericRaw(m[2]).value;
      if (bandChanged && (lowBand <= 0 || highBand <= 0 || lowBand > highBand)) {
        return {
          ok: false,
          error: "合理總價帶區間錯誤",
          message: "合理總價帶下緣與上緣必須為正數且下緣小於等於上緣"
        };
      }
      if (!b01.blank && highBand > b01.value) {
        return {
          ok: false,
          error: "合理總價帶上緣必須小於等於上限",
          message: "合理總價帶上緣必須小於等於上限"
        };
      }
    }
  }

  const w1 = parseNumericRaw(next.scoring?.w_screen ?? DEFAULT_SCORING.w_screen);
  const w2 = parseNumericRaw(next.scoring?.w_condition ?? DEFAULT_SCORING.w_condition);
  const w3 = parseNumericRaw(next.scoring?.w_price ?? DEFAULT_SCORING.w_price);
  const touchedWeight = opts.fullReplace && next.scoring && ("w_screen" in next.scoring || "w_condition" in next.scoring || "w_price" in next.scoring);
  const weightInput = patch.scoring && ("w_screen" in patch.scoring || "w_condition" in patch.scoring || "w_price" in patch.scoring);
  if (touchedWeight || weightInput) {
    if (w1.state !== "ok" || w2.state !== "ok" || w3.state !== "ok") {
      return { ok: false, error: "三組權重不得空白且必須為 0 到 1 的數字", message: "三組權重不得空白且必須為 0 到 1 的數字" };
    }
  }
  if (w1.state === "ok" && w2.state === "ok" && w3.state === "ok") {
    const sum = w1.value + w2.value + w3.value;
    if (Math.abs(sum - 1) > WEIGHT_SUM_TOLERANCE) {
      return { ok: false, error: "三組權重加總必須等於 1", message: "三組權重加總必須等於 1" };
    }
  }
  // R10-02：評分欄位已由 normalizeGroups 只針對本次有改的欄位驗證，舊不合法值留給首頁待辦清單，不擋無關修改。
  if (!b03.blank) {
    const b04 = parseNumericRaw(next.finance?.search_ratio_max);
    if (b01.blank || b04.state !== "ok") {
      warnings.push({ field: "search_range_high", message: "對外說的上緣請核對上限與建議比例" });
    } else if (b03.value > b01.value * b04.value) {
      warnings.push({ field: "search_range_high", message: "對外說的上緣高於上限乘建議比例" });
    }
  }
  if (b01.blank && bandRaw) {
    warnings.push({ field: "price_band", message: "上限待填時合理總價帶僅供預覽" });
  }

  const b13 = checkB13(current, next, {
    now: opts.now,
    reason: opts.reason,
    coolingUntil: opts.coolingUntil || opts.cooling?.until,
    cooling: opts.cooling,
    snapshotExemptFunds: opts.snapshotExemptFunds,
    lastAuditAt: opts.lastAuditAt
  });
  if (!b13.ok) {
    const hit = (b13.hits || [])[0] || {};
    return {
      ok: false,
      requiresCooling: true,
      b13,
      cooling: startCoolingRecord({
        field: hit.field || "threshold",
        from: hit.from,
        to: hit.to,
        hits: b13.hits,
        reason: opts.reason,
        now: opts.now
      }),
      message: b13.message,
      error: b13.message
    };
  }

  return {
    ok: true,
    state: next,
    audit: collectAudit(current, next, opts),
    b13,
    cooling: b13.consumeCooling ? null : opts.cooling || current?.cooling || null,
    capBlank: b01.blank,
    warnings
  };
}

export function fieldLabel(code) {
  return FIELD_LABELS[code] || code;
}

export { isBlank };
