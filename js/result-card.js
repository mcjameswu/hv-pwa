/**
 * 第 16 輪 F-R16-31：看房結果卡（一張直式圖，傳給共同決策人看）。
 * 白話：把這間物件的結果畫成一張圖：抬頭、總分三段橫條、一票否決、屋況 7 燈號、區段、複盤與下一步、頁尾。
 * 畫圖之前，要畫的字先整理成一份「資料物件」（buildResultCardModel，純函式），這份資料先過出口閘門
 * （和匯出到筆記同一套白名單與私密數字、個資掃描）；照片、記憶備註、地址、可承受上限與財務數字一律不在裡面。
 * 畫圖（canvas，瀏覽器內建的畫圖功能）在沒有 canvas 的環境（例如測試）會直接略過，不出錯。
 * 「下一步」與「大叔說」一律從目前載入的方法包讀，程式不寫死任何課程內容；方法包沒有教練階段就不畫這一區。
 */
import { buildNotesPayload } from "./notes-export.js";
import { prepareOutbound } from "./egress.js";
import { assessPropertyFromState, orderedViewings } from "./scoring.js";
import { stagesInfo, normalizeCoach, currentStageOf, localDate } from "./coach.js";
import { APP_VERSION, CONDITION_KEYS, CONDITION_LABELS } from "./defaults.js";
import { toFiniteNumber } from "./fields.js";

export const CARD_WIDTH = 1080;
export const CARD_MAX_HEIGHT = 1920;
export const CARD_FOOTER_NOTE = "不含可承受上限與財務數字";

const LIGHT_WORD = { 無問題: ["green", "正常"], 輕微: ["yellow", "輕微"], 嚴重: ["red", "嚴重"] };

/** 檔名：看房結果卡_<物件代號>_<YYYYMMDD_HHMM>.png（手機本地時間）。 */
export function resultCardFileName(propertyId, nowMs) {
  const d = new Date(nowMs);
  const pad = (n) => String(n).padStart(2, "0");
  const code = String(propertyId ?? "").replace(/[\\/:*?"<>|\s]/g, "");
  return `看房結果卡_${code}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.png`;
}

function unitPriceNote(state, property, area) {
  const median = toFiniteNumber(area?.comps_median_unit);
  const ask = toFiniteNumber(property?.ask_total);
  const ping = toFiniteNumber(property?.ping_total);
  if (median === null || median <= 0 || ask === null || ping === null || ping <= 0) return null;
  let a = ask;
  let p = ping;
  const pp = toFiniteNumber(property?.parking_price_ask);
  const pping = toFiniteNumber(property?.parking_ping);
  if (property?.parking_included_in_ask === true && pp !== null && pping !== null && p - pping > 0) {
    a -= pp;
    p -= pping;
  }
  if (a <= 0) return null;
  const pct = Math.round(((a / p) / median - 1) * 100);
  return pct === 0 ? "開價單價約等於可比成交中位單價" : `開價單價比可比成交中位單價${pct > 0 ? "高" : "低"} ${Math.abs(pct)}%`;
}

/**
 * 要畫的字與數字（純函式，不碰畫面）。
 * 回傳 { ok, shareable, ... }：延伸帶物件、找不到物件、或內容沒過出口閘門時 shareable 是 false，沒有任何要畫的內容。
 */
export function buildResultCardModel(state, propertyId, { nowMs = Date.now() } = {}) {
  const property = (state?.properties || []).find((p) => p && p.id === propertyId);
  if (!property) return { ok: false, shareable: false, error: "找不到這間物件" };
  const { payload } = buildNotesPayload(state, { nowMs });
  const row = payload.properties.find((r) => r.property_code === propertyId);
  if (!row) return { ok: false, shareable: false, error: "延伸帶物件只留在手機，不提供結果卡" };
  const live = assessPropertyFromState(state, propertyId);
  const area = (state.areas || []).find((a) => a && a.area_code === property.area_code) || null;
  const community = typeof property.community_name === "string" ? property.community_name.trim() : "";
  const status = row.status;
  const badge = status === "淘汰" ? "淘汰" : status === "觀察" ? "觀察" : "候選";
  const viewings = orderedViewings(state, propertyId);
  const date = viewings.length ? localDate(Date.parse(viewings.at(-1).start || viewings.at(-1).recorded_at || nowMs) || nowMs) : "";
  const scoreOk = typeof row.score_total === "number";
  const left = toFiniteNumber(live?.pending_count) ?? 0;
  const conditionOf = row.condition || {};
  const lights = CONDITION_KEYS.map((k) => {
    const [level, word] = LIGHT_WORD[conditionOf[k]] || ["yellow", "待核"];
    return { key: k, label: CONDITION_LABELS[k] || k, level, word };
  });
  // 區段：有區域資料的刀才畫
  const section = [];
  if (area) {
    const commute = toFiniteNumber(area.commute_min);
    const walk = toFiniteNumber(area.walk_min);
    if (commute !== null) section.push({ label: "到強勢辦公區", text: `${commute} 分鐘` });
    if (walk !== null) section.push({ label: "步行到車站", text: `${walk} 分鐘` });
    const unit = unitPriceNote(state, property, area);
    if (unit) section.push({ label: "價格對照", text: unit });
  }
  // 複盤一句話與下一步（從方法包讀；沒有教練階段就不畫「下一步」區）
  const info = stagesInfo(state.methodPack);
  let next = null;
  if (info.enabled) {
    const stage = currentStageOf(info.stages, normalizeCoach(state.coach));
    if (stage) {
      const say = Array.isArray(stage.uncle_says) ? stage.uncle_says.find((u) => u && typeof u.text === "string" && u.text.trim()) : null;
      next = { stage: stage.title || "", nextWhen: stage.next_when || "", uncleSays: say ? say.text : "", source: say?.source || "" };
    }
  }
  const model = {
    ok: true,
    shareable: true,
    header: { code: propertyId, name: community, area: area?.area_label || property.area_code || "", date, badge },
    score: scoreOk
      ? { total: row.score_total, parts: [["篩選", row.score_parts?.screen], ["屋況", row.score_parts?.condition], ["價格", row.score_parts?.price]], note: "" }
      : { total: null, parts: [], note: `資料不足:還差 ${left} 題` },
    veto: { hits: [...(row.veto_hits || [])], text: row.veto_hits?.length ? row.veto_hits.join("、") : "沒有一票否決" },
    lights,
    section,
    review: { text: row.review_text || "", next },
    footer: { generatedAt: new Date(nowMs).toISOString(), generatedText: `${localDate(nowMs)} 產生`, version: `app-v${APP_VERSION}`, note: CARD_FOOTER_NOTE }
  };
  // 畫圖用的資料先過出口閘門（和匯出到筆記同一套）
  const prepared = prepareOutbound({ recipient: "notes", state, notesPayload: { schema: "result_card_v1", card: model } });
  if (!prepared.ok) return { ok: false, shareable: false, error: "結果卡內容含有不能送出的內容，已擋下", hits: prepared.hits };
  return { ...model, gate: { ok: true, recipient: prepared.recipient } };
}

// ---------------------------------------------------------------------------
// 畫圖（canvas）：沒有 canvas 的環境直接略過
// ---------------------------------------------------------------------------

const COLORS = { bg: "#f6f3ea", brand: "#1f4d3a", ink: "#222222", muted: "#666666", green: "#2e7d4f", yellow: "#c98a00", red: "#b3261e", redBg: "#fbe3e1", line: "#d8d2c2", bar: "#e4ded0" };

function wrapLines(ctx, text, maxWidth) {
  const out = [];
  let line = "";
  for (const ch of String(text ?? "")) {
    if (ch === "\n") {
      out.push(line);
      line = "";
      continue;
    }
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      out.push(line);
      line = ch;
    } else line += ch;
  }
  if (line) out.push(line);
  return out;
}

/** 畫在 canvas 上；回傳 { ok, height }，沒有 canvas 或畫圖功能時 { ok:false, skipped:true }。 */
export function drawResultCard(canvas, model) {
  const ctx = canvas && typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
  if (!ctx || !model || model.shareable !== true) return { ok: false, skipped: true };
  const W = CARD_WIDTH;
  const pad = 56;
  const inner = W - pad * 2;
  const FONT = "-apple-system, 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif";
  const ops = [];
  let y = pad;
  const text = (t, x, size, color, weight = "400", maxWidth = inner) => {
    ctx.font = `${weight} ${size}px ${FONT}`;
    const lines = wrapLines(ctx, t, maxWidth);
    for (const l of lines) {
      ops.push(["text", l, x, y + size, size, color, weight]);
      y += Math.round(size * 1.4);
    }
  };
  const gap = (n) => {
    y += n;
  };
  ctx.font = `700 40px ${FONT}`;
  text(`${model.header.code}${model.header.name ? ` ${model.header.name}` : ""}`, pad, 44, COLORS.brand, "700", inner - 180);
  text([model.header.area, model.header.date ? `看房日 ${model.header.date}` : ""].filter(Boolean).join("　"), pad, 26, COLORS.muted);
  const badgeColor = model.header.badge === "淘汰" ? COLORS.red : model.header.badge === "觀察" ? COLORS.yellow : COLORS.green;
  ops.push(["badge", model.header.badge, W - pad - 150, pad, 150, 56, badgeColor]);
  gap(24);
  // 總分與三段橫條
  if (model.score.total !== null) {
    ops.push(["text", String(model.score.total), pad, y + 96, 96, COLORS.brand, "700"]);
    ops.push(["text", "/ 100", pad + 240, y + 96, 32, COLORS.muted, "400"]);
    y += 120;
    for (const [label, v] of model.score.parts) {
      const val = typeof v === "number" ? v : 0;
      ops.push(["bar", label, pad, y, inner, val]);
      y += 52;
    }
  } else {
    text(model.score.note, pad, 40, COLORS.red, "700");
  }
  gap(20);
  // 一票否決
  if (model.veto.hits.length) {
    const start = y;
    ctx.font = `700 30px ${FONT}`;
    const lines = wrapLines(ctx, `一票否決：${model.veto.text}`, inner - 40);
    const h = lines.length * 42 + 28;
    ops.push(["rect", pad, start, inner, h, COLORS.redBg]);
    y += 14;
    for (const l of lines) {
      ops.push(["text", l, pad + 20, y + 30, 30, COLORS.red, "700"]);
      y += 42;
    }
    y = start + h;
  } else {
    text("沒有一票否決", pad, 32, COLORS.green, "700");
  }
  gap(16);
  // 屋況 7 燈號（顏色加字）
  text("屋況 7 項", pad, 30, COLORS.brand, "700");
  const colW = inner / 2;
  model.lights.forEach((l, i) => {
    const cx = pad + (i % 2) * colW;
    const cy = y + Math.floor(i / 2) * 48;
    ops.push(["light", cx, cy, l.label, l.word, COLORS[l.level]]);
  });
  y += Math.ceil(model.lights.length / 2) * 48 + 12;
  if (model.section.length) {
    gap(10);
    text("區段", pad, 30, COLORS.brand, "700");
    for (const s of model.section) text(`${s.label}：${s.text}`, pad, 28, COLORS.ink);
  }
  if (model.review.text) {
    gap(10);
    text("複盤", pad, 30, COLORS.brand, "700");
    text(model.review.text, pad, 28, COLORS.ink);
  }
  if (model.review.next && (model.review.next.nextWhen || model.review.next.uncleSays)) {
    gap(10);
    text("下一步", pad, 30, COLORS.brand, "700");
    if (model.review.next.nextWhen) text(model.review.next.nextWhen, pad, 28, COLORS.ink);
    if (model.review.next.uncleSays) text(`大叔說：${model.review.next.uncleSays}${model.review.next.source ? `（${model.review.next.source}）` : ""}`, pad, 26, COLORS.muted);
  }
  gap(16);
  text(`${model.footer.generatedText}　${model.footer.version}　${model.footer.note}`, pad, 22, COLORS.muted);
  const wanted = Math.max(480, y + pad);
  const height = Math.min(CARD_MAX_HEIGHT, wanted);
  const truncated = wanted > CARD_MAX_HEIGHT; // 內容超過高度上限（F-R16B-12）
  canvas.width = W;
  canvas.height = height;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, height);
  for (const op of ops) {
    const [type] = op;
    if (type === "text") {
      const [, t, x, ty, size, color, weight] = op;
      ctx.font = `${weight} ${size}px ${FONT}`;
      ctx.fillStyle = color;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(t, x, ty);
    } else if (type === "rect") {
      ctx.fillStyle = op[5];
      ctx.fillRect(op[1], op[2], op[3], op[4]);
    } else if (type === "badge") {
      const [, t, x, by, w, h, color] = op;
      ctx.fillStyle = color;
      ctx.fillRect(x, by, w, h);
      ctx.font = `700 32px ${FONT}`;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(t, x + 36, by + 40);
    } else if (type === "bar") {
      const [, label, x, by, w, val] = op;
      ctx.font = `600 28px ${FONT}`;
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(label, x, by + 30);
      const bx = x + 110;
      const bw = w - 110 - 100;
      ctx.fillStyle = COLORS.bar;
      ctx.fillRect(bx, by + 8, bw, 26);
      ctx.fillStyle = COLORS.brand;
      ctx.fillRect(bx, by + 8, Math.max(0, Math.min(1, val / 100)) * bw, 26);
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(String(val), bx + bw + 16, by + 30);
    } else if (type === "light") {
      const [, x, ly, label, word, color] = op;
      ctx.fillStyle = color;
      ctx.beginPath?.();
      ctx.arc?.(x + 16, ly + 22, 14, 0, Math.PI * 2);
      ctx.fill?.();
      ctx.font = `400 28px ${FONT}`;
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(`${label}　${word}`, x + 42, ly + 32);
    }
  }
  return { ok: true, height, truncated };
}
