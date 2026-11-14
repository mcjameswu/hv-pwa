/**
 * 問價紀錄（第 13 輪 C5）：純函式，不碰畫面、不寫資料。
 * 白話：每間物件一份「誰在什麼時候說了什麼價」的流水帳，列表最新的在最上面。
 * 紀錄只留在手機裡，不會自動出現在任何給仲介的草稿；要不要把某個數字寫進訊息，永遠由使用者自己打字決定。
 */
import { PRICE_LOG_KINDS, parseNumericRaw } from "./fields.js";
import { scanDraft } from "./scanner.js";

export { PRICE_LOG_KINDS };

/** 某間物件的問價紀錄，最新的在最上面（日期新的在前；同一天的，後記的在前）。 */
export function priceLogFor(rows, propertyId) {
  return (Array.isArray(rows) ? rows : [])
    .map((r, i) => ({ r, i }))
    .filter((x) => x.r && typeof x.r === "object" && x.r.property_id === propertyId)
    .sort((a, b) => {
      const d = String(b.r.date || "").localeCompare(String(a.r.date || ""));
      if (d !== 0) return d;
      const t = String(b.r.at || "").localeCompare(String(a.r.at || ""));
      return t !== 0 ? t : b.i - a.i;
    })
    .map((x) => x.r);
}

/** 一筆問價紀錄在畫面上的一行字。 */
export function priceLogLine(r) {
  const amount = r.amount === null || r.amount === undefined || r.amount === "" ? "" : `　${r.amount} 萬`;
  const who = r.who ? `　${r.who}說` : "";
  const note = r.note ? `　${r.note}` : "";
  return `${r.date}　${r.kind}${amount}${who}${note}`;
}

/**
 * 第 14 輪 F-R14-02：一筆問價紀錄過不過私密數字檢查（保存與匯出共用這一個判斷函式）。
 * 白話：問價紀錄的金額是分欄存的數字（單位一律是萬），匯出時被序列化成沒有單位的文字，小於 100 的私密數字
 * （例如月收入 12 萬）就會漏掉。這裡把金額補回「N 萬」再掃一次，和 B01、財務區每一個金額值比對；
 * 「誰說的」「備註」各自照既有文字規則掃描。
 * @returns {{ amountHit: boolean, textHit: boolean, hits: object[] }}
 */
export function scanPriceLogEntry(entry, finance = {}) {
  const ctx = { finance: finance || {}, areas: [], travel: [], recipient: "notes", stretchPrices: [], stretchMentioned: false };
  const hits = [];
  const amount = entry?.amount;
  let amountHit = false;
  const parsed = amount === null || amount === undefined || amount === "" ? null : parseNumericRaw(amount);
  if (parsed && parsed.state === "ok") {
    const r = scanDraft(`${parsed.value} 萬`, ctx);
    const blocked = (r.hits || []).filter((h) => h.level === "block");
    if (blocked.length) {
      amountHit = true;
      hits.push(...blocked.map((h) => ({ ...h, from: "price_log.amount" })));
    }
  }
  let textHit = false;
  for (const k of ["who", "note"]) {
    const text = String(entry?.[k] ?? "").trim();
    if (!text) continue;
    const blocked = (scanDraft(text, ctx).hits || []).filter((h) => h.level === "block");
    if (blocked.length) {
      textHit = true;
      hits.push(...blocked.map((h) => ({ ...h, from: `price_log.${k}` })));
    }
  }
  return { amountHit, textHit, hits };
}

/** 一份給筆記的內容裡，哪幾筆問價紀錄沒過檢查（每筆寫明是哪間物件、哪一天、哪一類）。 */
export function priceLogProblems(payload, finance = {}) {
  const out = [];
  const visit = (code, rows) => {
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r || typeof r !== "object") continue;
      const res = scanPriceLogEntry(r, finance);
      if (res.hits.length) out.push({ property_code: code || r.property_code || "", date: String(r.date || ""), kind: String(r.kind || ""), amount: r.amount ?? null, amountHit: res.amountHit, textHit: res.textHit, hits: res.hits });
    }
  };
  if (Array.isArray(payload?.properties)) for (const p of payload.properties) visit(p?.property_code, p?.price_log);
  visit("", payload?.price_log);
  return out;
}

/** 保存與畫面提示用的一句話（說清楚為什麼不能存）。 */
export const PRICE_LOG_AMOUNT_MESSAGE = "這個金額跟你的私密財務數字一樣，匯出時會被擋（含有不能送出的內容），所以先不存；請確認金額是不是打錯";
