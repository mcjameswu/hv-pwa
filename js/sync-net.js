/**
 * 雲端同步唯一的連網檔(S1 同步,F-S1-21)。
 * 白話:整個 App 只有這一個檔案可以對外發出網路請求,而且只准呼叫「和 App 同一個網址底下的 ./api/sync/v1/」(相對路徑,不寫任何主機名稱)。
 * 它只負責把信封與權杖送出去、把回應收回來,不 import 任何碰得到資料的模組;回應不是 JSON 或狀態異常時回一個統一的錯誤物件,不丟出含內容的例外。
 * 同步關閉時沒有人會呼叫這個檔,所以連探測請求都不會發出。
 */

/** 組出 API 網址。只收英數字、連字號、底線與斜線,其他一律丟出(不含內容的)錯誤,所以組不出別的網站的網址。 */
export function apiUrl(path) {
  return "./api/sync/v1/" + safePath(path);
}

function safePath(path) {
  const p = String(path ?? "").replace(/^\/+/, "");
  if (!/^[A-Za-z0-9_\-/]*$/.test(p) || p.includes("//") || p.includes("..")) throw new Error("bad_path");
  return p;
}

const bad = (error, extra = {}) => ({ ok: false, status: 0, error, ...extra });

/**
 * 呼叫一個 API。method 是 GET、POST、PUT、DELETE;options 有 headers、body(物件,會轉成 JSON)、keepalive。
 * 回傳一律是物件:
 *  成功 { ok: true, status, body, etag };版本沒變 { ok: true, status: 304, notModified: true };
 *  失敗 { ok: false, status, error, closed?, limited?, offline? },error 只是固定代碼(例如 network、not_json、closed),不含任何內容。
 */
export async function call(method, path, options = {}) {
  try {
    apiUrl(path);
  } catch {
    return bad("bad_path");
  }
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      keepalive: options.keepalive === true
    });
  } catch {
    return bad("network", { offline: true });
  }
  const status = typeof res?.status === "number" ? res.status : 0;
  if (status === 304) return { ok: true, status, notModified: true };
  let parsed = null;
  try {
    parsed = JSON.parse(await res.text());
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return bad("not_json", { status });
  if (status >= 200 && status < 300 && parsed.ok === true) {
    let etag = null;
    try {
      etag = res.headers.get("etag");
    } catch {
      etag = null;
    }
    return { ok: true, status, body: parsed, etag };
  }
  return {
    ok: false,
    status,
    error: typeof parsed.error === "string" && /^[a-z_]{1,32}$/.test(parsed.error) ? parsed.error : `http_${status}`,
    closed: parsed.closed === true,
    limited: status === 429
  };
}
