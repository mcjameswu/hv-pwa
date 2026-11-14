/**
 * Outbound gate: every string that leaves the App must pass prepareOutbound.
 * 剪貼簿與下載只准寫入閘門回傳的 text。
 */
import { scanDraft, whitelistUploadPack, buildShareSummary } from "./scanner.js";
import { findPii } from "./pii.js";
import { displayValue, fieldSpec, fieldLabel } from "./fields.js";
import { SHEET_COLUMNS } from "./defaults.js";
import { isStretchProperty, propertiesForAgentDraft, assessPropertyFromState } from "./scoring.js";
import { agentDraft, partnerDrafts, PARTNER_BLANK, PARTNER_STAGES } from "./module333.js";
import { uniqueCounted } from "./counting.js";
import { extractMoneyWan, sameWan } from "./chinese-num.js";
import { buildUncompressedZip, stripJpegExif, jsonBytes } from "./zip.js";

export function recipientKind(recipient) {
  const r = String(recipient || "");
  if (r === "partner" || r === "共同決策人") return "partner";
  if (r === "agent" || r === "仲介") return "agent";
  if (r === "upload" || r === "上傳") return "upload";
  return "share";
}

export function isPartnerRecipient(recipient) {
  return recipientKind(recipient) === "partner";
}

function liveScores(state) {
  return (state.properties || []).map((p) => assessPropertyFromState(state, p.id)).filter((s) => s.ok);
}

function stretchList(state) {
  return (state.properties || []).filter((p) => isStretchProperty(p, state.finance));
}

function systemAgentText(state) {
  const scores = liveScores(state);
  const list = propertiesForAgentDraft(state.properties, state.finance, scores)
    .map((p) => p.id)
    .join("、");
  const slots = String(state.selectedSlot?.text || state.selectedSlotText || "").trim() || "時段未選";
  return agentDraft({ list, conditions: state.profile?.layout_note || "", slots });
}

function systemShareText(state, property) {
  const code = String(property?.id ?? "").trim();
  if (!code) return "";
  const live = assessPropertyFromState(state, code);
  const score = live && !live.stale ? (live.total_display ?? live.total ?? "") : "";
  return `物件代號 ${code}${score !== "" && score != null ? ` 分數 ${score}` : ""}`.trim();
}

function systemUploadText(state, property, viewing) {
  const packed = whitelistUploadPack(buildShareSummary(property || {}, viewing || {}));
  const lines = Object.entries(packed)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}：${v}`);
  if (!lines.length) return `上傳包 ${property?.id || ""}`.trim();
  return lines.join("\n");
}

/**
 * 共同決策人的系統稿（使用者沒寫自己的訊息時才用）。
 * 門店取進行中或最近一筆訪視；「過程中」的屋單數取該訪視的屋單數，現場間數取已計入間數，
 * 開價範圍取已看物件開價的最低到最高。沒有值的地方留「＿＿」讓使用者填。
 */
export function systemPartnerDraft(state, stage = "before") {
  const visits = state.visits || [];
  const visit = visits.find((v) => v.id === state.currentVisitId) || visits.at(-1) || null;
  const counted = uniqueCounted(state.viewings, state.properties, state.methodPack).count;
  const viewed = new Set((state.viewings || []).map((v) => v.property_id));
  const asks = (state.properties || [])
    .filter((p) => viewed.has(p.id))
    .map((p) => p.ask_total)
    .filter((x) => typeof x === "number" && Number.isFinite(x) && x > 0);
  const lo = asks.length ? Math.min(...asks) : null;
  const hi = asks.length ? Math.max(...asks) : null;
  const askRange = lo === null ? "" : lo === hi ? String(lo) : `${lo}到${hi}`;
  const drafts = partnerDrafts({
    branch: visit?.branch_label,
    time: visit?.end ? String(visit.end).slice(11, 16) : "",
    nListings: visit?.n_listings ?? undefined,
    nView: viewed.size ? counted : undefined,
    askRange,
    clauses: [visit?.fee_clause, visit?.private_deal_fee, visit?.exclude_other]
  });
  // 找不到指定的時間點就回空字串，不再默默退回「出門前」的稿（F9-11）
  if (!PARTNER_STAGES.some((s) => s.key === stage)) return { text: "", needsFill: true };
  return { text: drafts[stage], needsFill: drafts.needsFill[stage] === true };
}

export function systemPartnerText(state, stage = "before") {
  return systemPartnerDraft(state, stage).text;
}

/** 代號前後不是英數字、底線或連字號才算命中（A1 不會命中 A10）。 */
export function mentionsId(text, id) {
  if (id === undefined || id === null || String(id) === "") return false;
  const esc = String(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_-])${esc}(?![A-Za-z0-9_-])`).test(String(text ?? ""));
}

function stretchAmountHit(text, stretch) {
  const extracted = extractMoneyWan(text);
  for (const p of stretch) {
    if (p.id && mentionsId(text, p.id)) return { id: p.id, writing: p.id };
    if (p.ask_total == null) continue;
    for (const a of extracted) {
      if (sameWan(a.wan, p.ask_total)) return { id: p.id, writing: a.raw };
    }
  }
  return null;
}

/**
 * Build outbound text then run one scan. Clipboard/download must use returned text.
 * shareKind／uploadKind 規格分流：分享只含物件代號與分數；上傳包走白名單。
 */
export function prepareOutbound({ recipient, kind, state = {}, userText, property, viewing, stage = "before" } = {}) {
  const rcpt = recipientKind(kind || recipient);
  const stretch = stretchList(state);
  let text = userText;
  let source = "user";
  let systemNeedsFill = false;

  if (rcpt === "share") {
    text = systemShareText(state, property, viewing);
    source = "system";
  } else if (rcpt === "upload") {
    text = systemUploadText(state, property, viewing);
    source = "system";
  } else if (rcpt === "partner") {
    // 使用者自己寫的訊息，輸出就等於輸入；沒寫才用系統稿
    const has = userText != null && String(userText).trim() !== "";
    if (has) {
      text = String(userText);
    } else {
      const sys = systemPartnerDraft(state, stage);
      text = sys.text;
      systemNeedsFill = sys.needsFill;
    }
    source = has ? "user" : "system";
  } else if (rcpt === "agent" && (userText == null || String(userText).trim() === "")) {
    text = systemAgentText(state);
    source = "system";
  } else {
    text = String(userText ?? "");
    source = "user";
  }

  if (text == null || String(text).trim() === "") {
    return { ok: false, text: "", hits: [{ level: "block", field: "empty", rule: "empty_text" }], source, recipient: rcpt };
  }

  const hits = [];
  const pii = findPii(text);
  if (pii) hits.push({ level: "block", field: "pii", writing: pii.match || pii, rule: "pii" });

  let stretchHit = null;
  if (rcpt !== "partner") {
    stretchHit = stretchAmountHit(text, stretch);
    if (stretchHit) hits.push({ level: "block", field: "stretch", writing: stretchHit.writing, rule: "no_stretch_price" });
    if (/請再幫我找/.test(text) && stretch.some((p) => mentionsId(text, p.id))) {
      hits.push({ level: "block", field: "stretch", rule: "no_stretch_find_more" });
    }
  }

  const scan = scanDraft(text, {
    finance: state.finance || {},
    areas: state.areas || [],
    travel: state.travel || [],
    recipient: rcpt,
    stretchPrices: rcpt === "partner" ? [] : stretch.map((p) => p.ask_total),
    stretchMentioned: rcpt === "partner" ? false : Boolean(stretchHit)
  });
  hits.push(...(scan.hits || []));

  const blocked = hits.filter((h) => h.level === "block");
  const ok = blocked.length === 0;
  return {
    ok,
    text: ok ? text : "",
    hits,
    source,
    recipient: rcpt,
    needsFill: ok && (String(text).includes(PARTNER_BLANK) || systemNeedsFill)
  };
}

export function writeClipboard(prepared) {
  if (!prepared?.ok) return Promise.resolve({ ok: false, hits: prepared?.hits || [] });
  if (prepared.needsFill) return Promise.resolve({ ok: false, error: "還有空格沒填", hits: [] });
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(prepared.text).then(() => ({ ok: true, text: prepared.text }));
  }
  return Promise.resolve({ ok: true, text: prepared.text, skipped: true });
}

export function downloadBackupJson(obj, filename) {
  if (typeof document === "undefined") return { ok: true, filename };
  const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { ok: true, filename };
}

export function downloadOutbound(prepared, filename) {
  if (!prepared?.ok) return { ok: false, hits: prepared?.hits || [] };
  if (typeof document === "undefined") return { ok: true, text: prepared.text, filename };
  const blob = new Blob([prepared.text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { ok: true, text: prepared.text, filename };
}

/** 只接受已通過出口閘門、而且標記為 approved 的上傳包。 */
export function downloadZipBytes(pack, filename) {
  if (!pack || pack.ok !== true || pack.approved !== true || !(pack.bytes instanceof Uint8Array)) {
    return { ok: false, error: "上傳包沒有通過出口閘門，不能下載" };
  }
  const bytes = pack.bytes;
  if (typeof document === "undefined") return { ok: true, bytes, filename };
  const blob = new Blob([bytes], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "upload-pack.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { ok: true, filename };
}

/**
 * 上傳包：白名單 manifest.json 與勾選照片，JPEG 先移除 EXIF。
 * 必須收到 gate.ok === true（prepareOutbound 的結果）才產生；清單每個字串值再掃一次私密資料與個資；
 * 照片在包裡一律用序號檔名（原始檔名可能含金額、地點或人名）；任何照片是 0 位元組就失敗。
 * selectedMedia：[{ id, name, bytes }]，bytes 由控制器從資料庫讀出。
 */
export function buildUploadPackZip({ property, viewing, selectedMedia = [], gate, state = {} } = {}) {
  if (!gate || gate.ok !== true || gate.recipient !== "upload") {
    return { ok: false, error: "上傳內容沒有通過上傳出口閘門" };
  }
  const propId = String(property?.id ?? "").trim();
  if (!propId) return { ok: false, error: "缺少物件代號，不能產生上傳包" };
  if (isStretchProperty(property, state.finance)) {
    return { ok: false, error: "延伸帶物件不可產生上傳包" };
  }
  for (const m of selectedMedia) {
    if (!m || typeof m !== "object") return { ok: false, error: "只能選這次看房的現場照片" };
    if (!m.viewing_id || (viewing?.id && m.viewing_id !== viewing.id)) {
      return { ok: false, error: "只能選這次看房的現場照片" };
    }
    if (m.property_id && m.property_id !== propId) {
      return { ok: false, error: "只能選這個物件的現場照片" };
    }
    if ((m.type && m.type !== "photo") || m.kind === "visit_doc") {
      return { ok: false, error: "只能選這次看房的現場照片" };
    }
  }
  const photoNames = selectedMedia.map((_, i) => `photo-${String(i + 1).padStart(2, "0")}.jpg`);
  const manifest = {
    property_code: propId,
    community_name: property?.community_name || "",
    viewing_date: String(viewing?.start || viewing?.recorded_at || viewing?.viewing_date || "").slice(0, 10),
    photos: photoNames
  };
  const values = [manifest.property_code, manifest.community_name, manifest.viewing_date, ...manifest.photos];
  for (const v of values) {
    if (String(v).trim() === "") continue;
    const pii = findPii(v);
    const scan = scanDraft(String(v), {
      finance: state.finance || {},
      areas: state.areas || [],
      travel: state.travel || [],
      recipient: "upload",
      stretchPrices: [],
      stretchMentioned: false
    });
    if (pii || (scan.hits || []).some((h) => h.level === "block")) {
      return { ok: false, error: "清單裡有不能對外的內容，已擋下", hits: scan.hits || [] };
    }
  }
  const files = [{ name: "manifest.json", bytes: jsonBytes(manifest) }];
  for (const [i, m] of selectedMedia.entries()) {
    const raw = m.bytes instanceof Uint8Array ? m.bytes : new Uint8Array();
    if (!raw.length) return { ok: false, error: `照片 ${m.name || m.id} 內容讀不到，請重新拍攝或還原備份` };
    const stripped = stripJpegExif(raw);
    if (stripped.corrupt) return { ok: false, error: `照片 ${m.name || m.id} 格式損毀，不能打包` };
    files.push({ name: photoNames[i], bytes: stripped.bytes });
  }
  return { ok: true, approved: true, bytes: buildUncompressedZip(files), manifest };
}

/** 匯入預覽的變更清單：私密欄位預設遮罩，長按解鎖後才顯示完整新舊值。 */
const TABLE_NAMES = { settings: "設定", finance: "財務", profile: "輪廓", scoring: "評分設定", areas: "區域", agents: "仲介", travel: "通勤表" };

/** 欄位的白話名稱：先查匯入表的中文欄名，再查通用欄位名稱，最後才用欄位代號。 */
function columnLabel(table, key) {
  const col = (SHEET_COLUMNS[table] || []).find(([, code]) => code === key);
  return col ? col[0] : fieldLabel(key);
}

function rowTitle(d) {
  if (d.table === "areas" && d.rowKey) return `區域 ${d.rowKey}`; // 區域代號不是私密
  if (d.table === "agents" && d.rowKey) return `仲介格位 ${d.rowKey}`;
  if (d.table === "travel") return `通勤表第 ${(d.rowIndex ?? 0) + 1} 列`; // 地點代稱是私密，不顯示
  return TABLE_NAMES[d.table] || d.table || "";
}

export function displayDiffChanges(changes = [], { vaultOpen = false } = {}) {
  return (changes || []).map((d) => {
    const legacy = !d.kind;
    let table = d.table;
    let key = d.key;
    if (legacy) {
      const field = String(d.field || "");
      const parts = field.includes(".") ? field.split(".") : ["finance", field];
      table = parts[0];
      key = parts[1];
    }
    if (d.kind === "add_row" || d.kind === "remove_row") {
      const verb = d.kind === "add_row" ? "新增" : "移除";
      // 通勤表的列識別就是地點代稱（私密），沒解鎖時只說第幾列
      if (d.table === "travel") {
        const text = vaultOpen ? `通勤表第 ${(d.rowIndex ?? 0) + 1} 列（${d.rowKey}）${verb}` : `通勤表第 ${(d.rowIndex ?? 0) + 1} 列${verb}，長按顯示`;
        return { ...d, from: vaultOpen ? d.from : "••••", to: vaultOpen ? d.to : "••••", text };
      }
      return { ...d, text: `${rowTitle(d)}${verb}` };
    }
    if (d.kind === "b01_pending") {
      // 上限是私密數字：檔案內的新值不進預覽，連長按顯示也不帶數字，只提醒要本人手打一次
      return { ...d, from: "", to: "", text: "可承受總價上限：檔案內有新的值，需本人手打一次才會寫入" };
    }
    const spec = fieldSpec(table, key);
    const masked = !vaultOpen && (!spec || spec.privacy === "P2");
    const from = spec ? displayValue(table, key, d.from, { vaultOpen }) : (vaultOpen ? displayValue(table, key, d.from, { vaultOpen }) : "••••");
    const to = spec ? displayValue(table, key, d.to, { vaultOpen }) : (vaultOpen ? displayValue(table, key, d.to, { vaultOpen }) : "••••");
    const label = columnLabel(table, key);
    const title = d.rowKey !== undefined || d.rowIndex !== undefined ? rowTitle(d) : TABLE_NAMES[table] || table;
    const text = masked ? `${title ? `${title}的` : ""}${label}有變更，長按顯示` : `${title ? `${title}：` : ""}${label}：${from} → ${to}`;
    return { ...d, from, to, text };
  });
}

export { partnerDrafts, systemAgentText };
