/**
 * 雲端同步的密語與加解密(S1 同步,F-S1-01、F-S1-02)。
 * 白話:這個檔案只做兩件事。一是把「同步密語」變成一組鑰匙(保險箱代號、存取權杖、管理權杖、加密金鑰);
 * 二是把要上傳的內容用加密金鑰鎖起來(信封),或把下載的信封打開。
 * 只用瀏覽器與 Node 內建的 Web Crypto(globalThis.crypto.subtle),沒有任何第三方套件,也沒有任何網路呼叫。
 * 加密函式只收兩種內容:已經過出口閘門、標記核准的「給筆記」包,以及通過白名單驗證的電腦內容。
 */
import { validateDeskPayload } from "./sync-engine.js";
import { FIELD_TABLES, NOTES_ROW_KEYS, LOCAL_ONLY_TABLES } from "./fields.js";

export const SYNC_PBKDF2_ITERATIONS = 600000;
export const SYNC_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** 環境標記只准英數字、連字號、底線,1 到 32 字(F-S1B-06):它會被拿去組鹽與檔案路徑,不能夾帶斜線或點。 */
export const SYNC_ENV_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const SYNC_ROLES = ["owner", "partner", "desk"];
export const SYNC_KINDS = ["phone_notes", "desk_import"];
/** 明文補到這個位元組數的倍數,伺服器看不出精確長度。 */
export const SYNC_PAD_BLOCK = 4096;
/** 解密失敗一律回這句,不分是哪一種原因(不讓人從錯誤訊息推測)。 */
export const SYNC_OPEN_FAIL_MESSAGE = "解不開這份雲端內容(密語不對,或內容被改過)";

const enc = new TextEncoder();
const dec = new TextDecoder();

function subtle() {
  return globalThis.crypto.subtle;
}

// ---------------------------------------------------------------------------
// base64url 與雜湊小工具
// ---------------------------------------------------------------------------

export function toB64url(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(text) {
  const s = String(text ?? "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Hex(input) {
  const bytes = typeof input === "string" ? enc.encode(input) : input;
  const dig = new Uint8Array(await subtle().digest("SHA-256", bytes));
  return [...dig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 權杖的雜湊(伺服器只存這個,資料庫外洩也不能冒充)。 */
export async function tokenHash(token) {
  return sha256Hex(`hv-sync-token|${String(token ?? "")}`);
}

// ---------------------------------------------------------------------------
// 密語
// ---------------------------------------------------------------------------

/** 產生 20 個 Crockford Base32 字元的同步密語,5 個一組用連字號隔開(約 100 位元的隨機度)。 */
export function generateSyncPassphrase() {
  const out = [];
  while (out.length < 20) {
    const buf = new Uint8Array(32);
    globalThis.crypto.getRandomValues(buf);
    for (const b of buf) {
      if (out.length >= 20) break;
      out.push(SYNC_ALPHABET[b & 31]); // 字母表剛好 32 個,取低 5 位元沒有偏差
    }
  }
  return [out.slice(0, 5), out.slice(5, 10), out.slice(10, 15), out.slice(15, 20)].map((g) => g.join("")).join("-");
}

function generatedStyle(text) {
  const t = String(text ?? "").normalize("NFKC").replace(/[\s-]+/g, "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
  return t.length === 20 && [...t].every((c) => SYNC_ALPHABET.includes(c)) ? t : null;
}

/**
 * 正規化密語:產生式(去掉空白與連字號後剛好是 20 個字母表字元)轉大寫、O 當 0、I 與 L 當 1;
 * 其他(自訂)做 NFKC 正規化並去頭尾空白。兩支手機與電腦只要密語「看起來一樣」就得到同一組鑰匙。
 */
export function canonicalPassphrase(text) {
  const g = generatedStyle(text);
  if (g) return g;
  return String(text ?? "").normalize("NFKC").trim();
}

const SEQ_RUNS = [
  "0123456789012345678901234567890123456789",
  "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz",
  "qwertyuiopasdfghjklzxcvbnm",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
  "1234567890qwertyuiop",
  "1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p"
];

function looksSequential(raw) {
  const t = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (t.length < 8) return false;
  for (const run of SEQ_RUNS) {
    const rev = [...run].reverse().join("");
    if (run.includes(t) || rev.includes(t)) return true;
  }
  // 短單位一直重複(abcabcabc)
  for (let n = 1; n <= 4; n += 1) {
    if (t.length >= n * 4 && t === t.slice(0, n).repeat(Math.ceil(t.length / n)).slice(0, t.length)) return true;
  }
  return false;
}

/**
 * 密語強度:產生式一律通過(全部同一字元除外);自訂至少 16 個字元,而且含三種以上字元類別或至少 5 個用空白分開的詞;
 * 全同字元、連號、鍵盤順序一律拒絕。回傳 { ok, generated, message, reasons },訊息是白話,不含密語原文。
 */
export function syncPassphraseStrength(text) {
  const raw = String(text ?? "");
  const gen = generatedStyle(raw);
  const why = "這組密語是雲端資料唯一的鎖,別人拿到密文可以離線一直猜,所以要比解鎖手機的密碼長很多。";
  if (gen) {
    if (new Set(gen).size < 2) return { ok: false, generated: true, message: "這組密語太單調了,請改用「幫我產生」的密語。", reasons: ["same_char"] };
    return { ok: true, generated: true, message: "夠強(App 產生的密語)。", reasons: [] };
  }
  const t = raw.normalize("NFKC").trim();
  const reasons = [];
  if ([...t].length < 16) reasons.push("too_short");
  const classes = [/[a-z]/.test(t), /[A-Z]/.test(t), /[0-9]/.test(t), /[^A-Za-z0-9\s]/.test(t)].filter(Boolean).length;
  const words = t.split(/\s+/).filter(Boolean).length;
  if (classes < 3 && words < 5) reasons.push("low_variety");
  if (t.length > 0 && new Set([...t]).size === 1) reasons.push("same_char");
  if (looksSequential(t)) reasons.push("sequential");
  if (!reasons.length) return { ok: true, generated: false, message: "夠強。", reasons: [] };
  const parts = [];
  if (reasons.includes("too_short")) parts.push("至少要 16 個字元");
  if (reasons.includes("low_variety")) parts.push("要含三種以上字元(大寫、小寫、數字、符號),或至少 5 個用空白隔開的詞");
  if (reasons.includes("same_char")) parts.push("不能全部是同一個字");
  if (reasons.includes("sequential")) parts.push("不能是連號或鍵盤上排在一起的字");
  return { ok: false, generated: false, message: `這組密語不夠強:${parts.join(";")}。${why}建議直接按「幫我產生」。`, reasons };
}

// ---------------------------------------------------------------------------
// 金鑰衍生
// ---------------------------------------------------------------------------

async function hkdf(masterKey, info, bytes) {
  const bits = await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(info) }, masterKey, bytes * 8);
  return new Uint8Array(bits);
}

/**
 * 從密語衍生整組鑰匙(照設計文件 3.2):主金鑰 = PBKDF2-HMAC-SHA256(正規化密語, 鹽 "hv-sync|v1|" + env, 600000 次);
 * 再用 HKDF-SHA256 分出保險箱代號(16 位元組轉 22 字元)、存取權杖、管理權杖、加密金鑰(都是 base64url 字串)。
 * 主金鑰(master)只放在模組內部的 WeakMap(F-S1B-03):回傳物件沒有 master 欄位,序列化、複製、寫進本機資料都帶不出去;
 * slotWriteToken 拿同一個回傳物件才查得到它,物件被丟掉主金鑰就跟著被回收。密語原文也不會出現在回傳物件裡。
 */
export async function deriveSyncKeys(passphrase, env) {
  const e = String(env ?? "");
  if (!e) throw new Error("缺少環境標記");
  if (!SYNC_ENV_RE.test(e)) throw new Error("環境標記格式不對");
  const canon = canonicalPassphrase(passphrase);
  if (!canon) throw new Error("缺少密語");
  const base = await subtle().importKey("raw", enc.encode(canon), "PBKDF2", false, ["deriveBits"]);
  const masterBits = await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(`hv-sync|v1|${e}`), iterations: SYNC_PBKDF2_ITERATIONS }, base, 256);
  const master = new Uint8Array(masterBits);
  const hk = await subtle().importKey("raw", master, "HKDF", false, ["deriveBits"]);
  const keys = {
    env: e,
    vault_id: toB64url(await hkdf(hk, "vault-id", 16)),
    access: toB64url(await hkdf(hk, "access", 32)),
    admin: toB64url(await hkdf(hk, "admin", 32)),
    enc: toB64url(await hkdf(hk, "enc", 32))
  };
  MASTERS.set(keys, master);
  return keys;
}

/** 主金鑰暫存:鍵是 deriveSyncKeys 的回傳物件(F-S1B-03)。 */
const MASTERS = new WeakMap();

/** 某一格的寫入權杖。第一個參數是 deriveSyncKeys 的回傳物件(主金鑰留在內部),或是主金鑰本身(位元組或 base64url,測試與工具用)。 */
export async function slotWriteToken(masterOrKeys, slotId) {
  let m = null;
  if (typeof masterOrKeys === "string") m = fromB64url(masterOrKeys);
  else if (masterOrKeys instanceof Uint8Array) m = masterOrKeys;
  else if (masterOrKeys && typeof masterOrKeys === "object") m = MASTERS.get(masterOrKeys) || null;
  if (!m) throw new Error("缺少主金鑰");
  const hk = await subtle().importKey("raw", m, "HKDF", false, ["deriveBits"]);
  return toB64url(await hkdf(hk, `slot-write|${String(slotId)}`, 32));
}

/** 產生一個格子代號(裝置自己的亂數,不含任何個人資訊)。 */
export function generateSlotId() {
  return toB64url(globalThis.crypto.getRandomValues(new Uint8Array(12)));
}

// ---------------------------------------------------------------------------
// 信封
// ---------------------------------------------------------------------------

/** 附加驗證資料:把環境、保險箱、格子、種類、版本綁進封條(搬格子、換版本、換環境都會解不開)。 */
export function envelopeAad({ env, vault_id, slot_id, kind, seq }) {
  return `hv-sync|1|${env}|${vault_id}|${slot_id}|${kind}|${seq}`;
}

async function importEncKey(encKey) {
  return subtle().importKey("raw", fromB64url(encKey), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function validCtx(ctx) {
  return (
    ctx &&
    typeof ctx.env === "string" && ctx.env &&
    typeof ctx.vault_id === "string" && ctx.vault_id &&
    typeof ctx.slot_id === "string" && ctx.slot_id &&
    typeof ctx.enc === "string" && ctx.enc &&
    Number.isInteger(ctx.seq) && ctx.seq >= 1
  );
}

/** 把明文物件補到 4096 位元組的倍數後加密。回傳 { ok, envelope }。 */
async function seal(kind, payload, ctx) {
  if (!SYNC_KINDS.includes(kind) || !validCtx(ctx)) return { ok: false };
  if (!SYNC_ROLES.includes(ctx.role)) return { ok: false };
  const payloadJson = JSON.stringify(payload);
  const body = {
    kind,
    role: ctx.role,
    device_label: String(ctx.device_label ?? ""),
    created_at: String(ctx.created_at ?? new Date().toISOString()),
    payload_sha256: await sha256Hex(payloadJson),
    payload,
    pad: ""
  };
  const base = enc.encode(JSON.stringify(body)).length;
  body.pad = "0".repeat((SYNC_PAD_BLOCK - (base % SYNC_PAD_BLOCK)) % SYNC_PAD_BLOCK);
  const plain = enc.encode(JSON.stringify(body));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await importEncKey(ctx.enc);
  const aad = enc.encode(envelopeAad({ ...ctx, kind }));
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, plain));
  return { ok: true, envelope: { v: 1, kind, seq: ctx.seq, iv: toB64url(iv), ct: toB64url(ct) }, hash: body.payload_sha256 };
}

/** 「給筆記」內容允許的格式標記(F-S1B-04)。 */
const NOTES_SCHEMAS = ["notes_sync_v1", "notes_sync_v1.1"];
/**
 * 給筆記內容會用到的表;其餘各表的名稱(設定、輪廓、評分、仲介、通勤與錢相關的表),
 * 連同那些表裡標為 P2(最私密)的欄位名稱,再加上 b01,都不准出現在要加密的內容裡。
 * 名稱全部從 fields.js 的表清單算出來,這裡不寫死,也和「給筆記」會用到的欄位名稱(NOTES_ROW_KEYS 與共用表)取差集,避免誤擋。
 */
const SHARED_TABLES = ["properties", "areas", "price_log", "stage_note", "coach_custom_item", "visits", "evidence"];
/**
 * 產生禁用鍵清單(F-S1C-01、F-S1C-02):財務表的全部欄位名稱都納入(不只 P2),其餘非共用表的名稱與 P2 欄位也納入,
 * 再加上 b01;一律轉小寫存放,比對時也轉小寫,所以大小寫混用擋得住。tables 可注入假的欄位表(測試用),預設是 fields.js 的表清單。
 */
// 只留在手機的表(LOCAL_ONLY_TABLES)由 fields.js 匯出,這裡不寫死表名,也不拆字(F-S2-02)
export function buildForbiddenKeys(tables = FIELD_TABLES) {
  const lc = (k) => String(k).toLowerCase();
  const shared = new Set([...NOTES_ROW_KEYS, ...SHARED_TABLES.flatMap((t) => Object.keys(tables[t] || {}))].map(lc));
  const out = new Set(["b01"]);
  for (const [table, fields] of Object.entries(tables)) {
    if (SHARED_TABLES.includes(table)) continue;
    out.add(lc(table));
    for (const [k, spec] of Object.entries(fields || {})) {
      if (shared.has(lc(k))) continue;
      if (LOCAL_ONLY_TABLES.includes(table) || (spec && spec.privacy === "P2")) out.add(lc(k));
    }
  }
  return out;
}


const FORBIDDEN_KEYS = buildForbiddenKeys();

/** 內容(遞迴)裡有沒有禁用鍵;不分大小寫,b01 開頭的一律算。forbidden 可注入(測試用)。 */
export function hasForbiddenKey(v, forbidden = FORBIDDEN_KEYS, depth = 0) {
  if (depth > 40) return true;
  if (Array.isArray(v)) return v.some((x) => hasForbiddenKey(x, forbidden, depth + 1));
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      const lk = k.toLowerCase();
      if (forbidden.has(lk) || lk.startsWith("b01") || hasForbiddenKey(x, forbidden, depth + 1)) return true;
    }
  }
  return false;
}

/** 縱深防禦(F-S1B-04):旗標之外,再驗格式標記,而且整份內容(遞迴)不含私密表的名稱或欄位名稱。 */
function notesPayloadClean(payload) {
  return NOTES_SCHEMAS.includes(payload.schema) && !hasForbiddenKey(payload);
}

/**
 * 加密「給筆記」的內容。只接受和 deliverNotesFile 同一組條件的核准包:
 * ok、approved、prepared 通過、收件對象是 notes、prepared.text 等於 text。其他一律回 { ok: false },不加密。
 */
export async function sealNotesPack(pack, ctx) {
  if (!pack || pack.ok !== true || pack.approved !== true || pack.prepared?.ok !== true || pack.prepared.recipient !== "notes" || typeof pack.text !== "string" || pack.prepared.text !== pack.text) {
    return { ok: false };
  }
  let payload;
  try {
    payload = JSON.parse(pack.text);
  } catch {
    return { ok: false };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false };
  if (!notesPayloadClean(payload)) return { ok: false };
  return seal("phone_notes", payload, ctx);
}

/** 加密電腦內容。只接受通過白名單驗證(validateDeskPayload)的內容。 */
export async function sealDeskPayload(payload, ctx) {
  const v = validateDeskPayload(payload);
  if (!v.ok) return { ok: false };
  return seal("desk_import", payload, ctx);
}

/**
 * 打開信封。任何失敗(密語不對、改過密文、換格子、換版本、換環境、換保險箱)都回同一個錯誤訊息。
 * 成功回傳 { ok: true, kind, role, device_label, created_at, payload }。
 */
export async function openEnvelope(envelope, ctx) {
  const fail = { ok: false, error: SYNC_OPEN_FAIL_MESSAGE };
  try {
    if (!envelope || envelope.v !== 1 || !SYNC_KINDS.includes(envelope.kind) || !Number.isInteger(envelope.seq)) return fail;
    if (!validCtx({ ...ctx, seq: envelope.seq })) return fail;
    const key = await importEncKey(ctx.enc);
    const aad = enc.encode(envelopeAad({ ...ctx, kind: envelope.kind, seq: envelope.seq }));
    const plain = await subtle().decrypt({ name: "AES-GCM", iv: fromB64url(envelope.iv), additionalData: aad }, key, fromB64url(envelope.ct));
    const body = JSON.parse(dec.decode(plain));
    if (!body || body.kind !== envelope.kind || !SYNC_ROLES.includes(body.role)) return fail;
    if ((await sha256Hex(JSON.stringify(body.payload))) !== body.payload_sha256) return fail;
    return { ok: true, kind: body.kind, role: body.role, device_label: body.device_label, created_at: body.created_at, payload: body.payload };
  } catch {
    return fail;
  }
}
