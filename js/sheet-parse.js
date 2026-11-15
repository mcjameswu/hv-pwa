/**
 * 第 16 輪 F-R16-03、F-R16-04、F-R16-05：現場帶看單的文字拆欄位（純函式，不碰畫面、不連網、不寫資料）。
 * 白話：現場拿到一張紙本帶看單，用手機相機或相簿的「文字辨識」選複製文字，貼進 App，或請 AI 讀照片後給一段 JSON，
 * 這裡負責把文字拆成 App 的欄位（開價、坪數、房數、衛浴、屋齡、樓層、車位、管理費、案名、產品類型、仲介稱呼），
 * 並記下每個欄位是從哪裡來的（單子、AI、猜的）。App 不連網，讀圖不在 App 裡做。
 *
 * 規矩：
 *  - 地址不存進 App：含「市、區、路、街、巷、弄、號」組合的行整行丟掉，放進 dropped；行政區名稱只拿來對區域表，猜一個區域代號（標「猜的」，要使用者確認）。
 *  - 含電話、電子郵件的行也整行丟掉（個資不進 App）。
 *  - 全形半形數字、千分位逗號、空白都容忍；數字不合理時寧可不填，讓它列在「單子上沒有」。
 */
import { toHalfwidth, findPii, hasAddressPattern } from "./pii.js";
import { toFiniteNumber, normalizeValue } from "./fields.js";

/** 計分需要的欄位（沒有值就列在「單子上沒有」，讓使用者自己填或列成要問仲介的問題）。 */
export const SCORE_FIELDS = ["ask_total", "ping_total", "rooms", "baths", "area_code", "product_type", "has_parking"];

/** 欄位代號、白話名稱、單位（預覽與 AI 提示詞共用的唯一一份）。 */
export const SHEET_FIELDS = [
  { key: "community_name", label: "案名或社區名稱", unit: "" },
  { key: "area_code", label: "區域", unit: "" },
  { key: "ask_total", label: "開價", unit: "萬" },
  { key: "ping_total", label: "登記總坪", unit: "坪" },
  { key: "rooms", label: "房數", unit: "房" },
  { key: "baths", label: "衛浴數", unit: "間" },
  { key: "age", label: "屋齡", unit: "年" },
  { key: "floor_note", label: "樓層", unit: "" },
  { key: "product_type", label: "產品類型", unit: "" },
  { key: "has_parking", label: "有無車位", unit: "" },
  { key: "parking_ping", label: "車位坪", unit: "坪" },
  { key: "parking_price_ask", label: "車位開價", unit: "萬" },
  { key: "parking_included_in_ask", label: "車位是否含在開價", unit: "" },
  { key: "mgmt_fee_yuan", label: "管理費", unit: "元/月" },
  { key: "agent_company", label: "仲介公司", unit: "" },
  { key: "branch_label", label: "門市", unit: "" },
  { key: "agent_alias", label: "仲介稱呼", unit: "" }
];

/** 建立物件時允許寫入的欄位（SHEET_FIELDS 加記憶備註與來源備註）；其他的鍵（例如 id）一律不寫入（F-R16B-14）。 */
export const SHEET_WRITE_KEYS = [...SHEET_FIELDS.map((f) => f.key), "memory_note", "source_note"];

export function pickSheetFields(values) {
  const out = {};
  for (const [k, v] of Object.entries(values && typeof values === "object" ? values : {})) {
    if (SHEET_WRITE_KEYS.includes(k)) out[k] = v;
  }
  return out;
}

/** 「要問仲介」的通用問法（單子上沒有的欄位用）。 */
export const ASK_QUESTIONS = {
  ask_total: "請問現在的開價是多少?",
  ping_total: "請問登記總坪數是多少?",
  rooms: "請問格局是幾房?",
  baths: "請問有幾間衛浴?",
  area_code: "請問這間在哪個區域?",
  product_type: "請問產品類型是大樓、華廈、公寓還是透天?",
  has_parking: "請問有沒有車位?",
  age: "請問屋齡幾年?",
  floor_note: "請問在幾樓、整棟共幾層?",
  mgmt_fee_yuan: "請問管理費一個月多少?",
  parking_ping: "請問車位是幾坪?",
  parking_price_ask: "請問車位另外要多少錢?",
  parking_included_in_ask: "請問車位有沒有含在開價裡?"
};

const PRODUCT_WORDS = [
  [/透天/, "透天"],
  [/華廈/, "華廈"],
  [/公寓/, "公寓"],
  [/大樓/, "大樓"]
];

const ADDRESS_MARKERS = ["市", "區", "路", "街", "巷", "弄", "號"];
/** 這些詞裡的「市、區、路、號」不是地址，數標記之前先拿掉。 */
const NOT_ADDRESS_WORDS = /社區|門市|商圈|市場|市價|市區|區域|區段|地區|路口|路線|路況|道路|號稱|編號|房號|戶號|車號|號碼|街景|街廓|大街|商街|市中心/g;

/** 一行是不是地址（整行丟掉）。 */
export function isAddressLine(line) {
  const s = toHalfwidth(String(line ?? ""));
  if (/^\s*(?:地址|座落|坐落|門牌|地點)\s*[:：]/.test(s)) return true;
  const stripped = s.replace(NOT_ADDRESS_WORDS, "");
  if (/\d+\s*(?:之\s*\d+\s*)?[巷弄號]/.test(stripped)) return true;
  const hit = ADDRESS_MARKERS.filter((m) => stripped.includes(m));
  return hit.length >= 2;
}

function num(s) {
  if (s === undefined || s === null) return null;
  const t = String(s).replace(/[,\s]/g, "");
  return toFiniteNumber(t);
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

/** 民國年或西元年換成西元年；不像年份回 null。 */
function toGregorianYear(raw, hint) {
  const n = num(raw);
  if (n === null || !Number.isInteger(n)) return null;
  if (hint === "roc" || (n >= 1 && n <= 200 && hint !== "ad")) return n + 1911;
  if (n >= 1900 && n <= 2200) return n;
  return null;
}

function floorNote(s) {
  const t = toHalfwidth(s);
  let m = t.match(/(\d{1,3})\s*(?:F|f|樓|層)?\s*[/／]\s*(?:共\s*)?(\d{1,3})\s*(?:F|f|樓|層)?/);
  if (m) return `${m[1]} 樓，共 ${m[2]} 樓`;
  m = t.match(/第?\s*(\d{1,3})\s*(?:樓|層|F|f)\s*[（(]?\s*(?:共|\/)?\s*(\d{1,3})\s*(?:樓|層)[）)]?/);
  if (m) return `${m[1]} 樓，共 ${m[2]} 樓`;
  m = t.match(/(\d{1,3})\s*(?:樓|層|F)\b/);
  if (m) return `${m[1]} 樓`;
  m = t.match(/(\d{1,3})\s*(?:樓|層|F)/);
  return m ? `${m[1]} 樓` : null;
}

/** 單位換算成「萬」：沒有單位但數字很大（大於 10 萬）當成「元」。 */
function priceToWan(numText, unitText, textAround) {
  const n = num(numText);
  if (n === null || n <= 0) return null;
  const unit = String(unitText || "");
  if (/萬|万/.test(unit)) return round2(n);
  if (/億/.test(unit)) return round2(n * 10000);
  if (/元|NTD|TWD|NT\$|\$/i.test(unit + textAround) && n >= 100000) return round2(n / 10000);
  if (n >= 100000) return round2(n / 10000); // 12,800,000 這種直接寫元
  return round2(n);
}

const LABELS = {
  ask: "總價|售價|開價|特價|現價|價格|price|asking",
  ping: "權狀坪數|權狀|登記坪數|登記總坪|登記|總坪數|總坪|建坪|坪數|面積|area|size",
  layout: "格局|房型|房廳衛|layout",
  age: "屋齡|age",
  done: "完工年份|完工日期|完工|建築完成|竣工|落成|建成|年份|built",
  floor: "樓層|所在樓層|floor",
  parking: "車位|parking",
  mgmt: "管理費|管理費用|mgmt|management",
  community: "案名|社區名稱|社區|建案|building|project",
  type: "產品類型|建物型態|型態|類型|type",
  company: "仲介公司|房仲|公司|company|agency",
  branch: "門市|分店|店名|店別|branch",
  agent: "經紀人|營業員|業務|專員|承辦|聯絡人|agent|contact"
};

/** 找出「標籤 冒號 後面的值」。回傳這個標籤第一個出現的值（到行尾或下一個「、」「，」「|」之前）。 */
function labelValue(lines, labelRe) {
  const re = new RegExp(`(?:${labelRe})\\s*(?:[:：=]|\\s)\\s*([^\\n]*)`, "i");
  for (const line of lines) {
    const m = line.match(re);
    if (m && m[1] !== undefined && m[1].trim() !== "") return { value: m[1].trim(), line };
  }
  return null;
}

function cleanName(s) {
  return String(s ?? "")
    .replace(/^[【\[「『(（]+|[】\]」』)）]+$/g, "")
    .split(/[|｜,，;；/／]|\s{2,}/)[0]
    .trim();
}

function nameOnly(value) {
  const t = cleanName(value);
  if (!t) return "";
  if (findPii(t)) return "";
  if (/\d{4,}/.test(t)) return ""; // 長數字多半是電話、編號
  return t.slice(0, 60);
}

/**
 * 在一行裡找標籤加數字的第一個「不屬於車位」的命中（F-R16B-04）：命中位置前面 4 個字內有「車位」（或緊接 parking）的不算，
 * 這樣「車位坪數:10 坪」不會被當成總坪。
 *
 * 開價專用（priceOnly，F-R17B-01）：只有「車位」和數字之間出現價格類標籤（價、價格、售價、另計價、開價）而且沒有出現「總價」時才跳過。
 * 白話：「車位價格:150 萬」是車位的價錢，不是房子的開價；但「含車位 總價 1180 萬」「車位另計 總價 1180 萬」寫的是房子的總價，要收。
 */
function matchNotParking(line, re, { priceOnly = false } = {}) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of line.matchAll(g)) {
    const before = line.slice(0, m.index);
    if (/parkings*$/i.test(before.slice(-10))) continue;
    if (priceOnly) {
      const lastPark = before.lastIndexOf("車位");
      if (lastPark >= 0) {
        const between = before.slice(lastPark + 2);
        // 車位和命中之間沒有數字與分隔符號、不超過 12 個字，才算同一段；段內（含命中的標籤）有價格類標籤而沒有「總價」就是車位價
        if (between.length <= 12 && !/[0-9、，,;；|｜/／]/.test(between)) {
          const seg = between + m[0].replace(/[0-9].*$/s, "");
          if (/價/.test(seg) && !/總價/.test(seg)) continue;
        }
      }
      return m;
    }
    if (/車位/.test(before.slice(-4))) continue;
    // F-R17-02(b)：「車位(平面)價格:150 萬」這種車位和價格字之間隔超過 4 個字的同一段，也屬於車位（中間沒有數字與分隔符號、不超過 12 個字）
    const lastPark = before.lastIndexOf("車位");
    if (lastPark >= 0) {
      const between = before.slice(lastPark + 2);
      if (between.length <= 12 && !/[0-9、，,;；|｜/／]/.test(between)) continue;
    }
    return m;
  }
  return null;
}

/** 把一整段文字拆成 App 的欄位。 */
export function parseViewingSheet(text, { areas = [], now = Date.now() } = {}) {
  const fields = {};
  const sources = {};
  const dropped = [];
  const notes = [];
  const set = (key, value, source = "單子") => {
    if (value === null || value === undefined || value === "") return;
    if (fields[key] !== undefined) return;
    fields[key] = value;
    sources[key] = source;
  };

  const rawLines = toHalfwidth(String(text ?? ""))
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const allText = rawLines.join("\n");
  const lines = [];
  for (const line of rawLines) {
    if (findPii(line)) {
      dropped.push(line); // 電話、電子郵件、證件號碼等個資：整行不收
      continue;
    }
    if (isAddressLine(line)) {
      dropped.push(line);
      continue;
    }
    lines.push(line);
  }
  const body = lines.join("\n");

  // ---- 開價 ----
  {
    const re = new RegExp(`(?:${LABELS.ask})\\s*(?:[:：=]|\\s)?\\s*(?:NT\\$|NTD|TWD|\\$)?\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(萬元|萬|万|億|元)?`, "i");
    for (const line of lines) {
      const m = matchNotParking(line, re, { priceOnly: true });
      if (m) {
        const v = priceToWan(m[1], m[2], line);
        if (v !== null) {
          set("ask_total", v);
          break;
        }
      }
    }
  }
  // ---- 登記總坪（登記與權狀優先，建坪最後；只有建坪就標猜的）----
  {
    const order = [
      ["登記坪數|登記總坪|登記", "單子"],
      ["權狀坪數|權狀", "單子"],
      ["總坪數|總坪|坪數|面積|area|size", "單子"],
      ["建坪", "猜的"]
    ];
    for (const [labelRe, src] of order) {
      if (fields.ping_total !== undefined) break;
      const re = new RegExp(`(?:${labelRe})\\s*(?:[:：=]|\\s)?\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(坪|ping|pings|㎡|m2|sqm|平方公尺)?`, "i");
      for (const line of lines) {
        const m = matchNotParking(line, re);
        if (!m) continue;
        let n = num(m[1]);
        if (n === null || n <= 0) continue;
        const unit = String(m[2] || "").toLowerCase();
        let source = src;
        if (/㎡|m2|sqm|平方公尺/.test(unit)) {
          n = round2(n / 3.305785);
          source = "單子（平方公尺換算成坪）";
        }
        if (n > 0 && n < 1000) {
          set("ping_total", round2(n), source);
          break;
        }
      }
    }
    if (fields.ping_total === undefined) {
      // 「32.5 坪」「32.5 ping」前面沒有標籤：只有全文剛好出現一個「數字加坪」才用（標猜的）
      const noParkingBody = lines.filter((l) => !/車位|parking/i.test(l)).join("\n");
      const all = [...noParkingBody.matchAll(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:坪|ping)\b/gi)].map((m) => num(m[1])).filter((n) => n !== null && n > 5 && n < 1000);
      const uniq = [...new Set(all)];
      if (uniq.length === 1) set("ping_total", uniq[0], "猜的");
    }
  }
  // ---- 格局：3房2廳2衛 ----
  {
    const roomExact = body.match(/(\d{1,2})\s*(?:房|室)/) || body.match(/(\d{1,2})\s*(?:BR|bed(?:room)?s?)\b/i);
    const bathExact = body.match(/(\d{1,2})\s*(?:衛浴|衛|浴)/) || body.match(/(\d{1,2})\s*(?:BA|bath(?:room)?s?)\b/i);
    const roomLabel = labelValue(lines, "房數|房間數|臥室|bedrooms?");
    const bathLabel = labelValue(lines, "衛浴數|衛浴|衛生間|浴室|bathrooms?");
    const roomN = roomExact ? num(roomExact[1]) : roomLabel ? num((roomLabel.value.match(/\d+/) || [])[0]) : null;
    const bathN = bathExact ? num(bathExact[1]) : bathLabel ? num((bathLabel.value.match(/\d+/) || [])[0]) : null;
    if (roomN !== null && roomN >= 0 && roomN <= 20) set("rooms", roomN);
    if (bathN !== null && bathN >= 0 && bathN <= 20) set("baths", bathN);
  }
  // ---- 屋齡、完工年份 ----
  {
    const ageRe = new RegExp(`(?:${LABELS.age})\\s*(?:[:：=]|\\s)?\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(?:年|yrs?|years?)?`, "i");
    for (const line of lines) {
      const m = line.match(ageRe);
      if (m) {
        const n = num(m[1]);
        if (n !== null && n >= 0 && n <= 200) {
          set("age", n);
          break;
        }
      }
    }
    if (fields.age === undefined) {
      const m = body.match(/(\d{1,3}(?:\.\d+)?)\s*年屋齡/);
      const n = m ? num(m[1]) : null;
      if (n !== null && n >= 0 && n <= 200) set("age", n);
    }
    if (fields.age === undefined) {
      const doneRe = new RegExp(`(?:${LABELS.done})\\s*(?:[:：=]|\\s)?\\s*(民國|ROC|西元)?\\s*([0-9]{1,4})\\s*(?:年|[/-])?`, "i");
      for (const line of lines) {
        const m = line.match(doneRe);
        if (!m) continue;
        const hint = /民國|ROC/i.test(m[1] || "") ? "roc" : /西元/.test(m[1] || "") ? "ad" : null;
        const year = toGregorianYear(m[2], hint);
        const nowYear = new Date(now).getFullYear();
        if (year !== null && year <= nowYear && year >= 1900) {
          const age = nowYear - year;
          set("age", age, "單子（完工年份換算）");
          const d = new Date(now);
          notes.push(`屋齡是用完工年份 ${year} 年，以今天日期 ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} 換算成 ${age} 年；請確認。`);
          break;
        }
      }
    }
  }
  // ---- 樓層 ----
  {
    const lab = labelValue(lines, LABELS.floor);
    let note = lab ? floorNote(lab.value) : null;
    if (!note) {
      for (const line of lines) {
        if (/\d\s*[Ff樓層]\s*[/／]\s*(?:共\s*)?\d|\d\s*樓\s*[（(]?\s*共\s*\d|\d\s*[/／]\s*\d{1,3}\s*(?:樓|層|F)/.test(line)) {
          note = floorNote(line);
          break;
        }
      }
    }
    if (!note) {
      for (const line of lines) {
        if (/^\s*\d{1,3}\s*\/\s*\d{1,3}\s*$/.test(line)) {
          note = floorNote(line);
          break;
        }
      }
    }
    if (note) set("floor_note", note);
  }
  // ---- 車位 ----
  {
    const parkLines = lines.filter((l) => /車位|parking/i.test(l));
    const pj = parkLines.join("\n");
    if (parkLines.length) {
      if (/(?:車位|parking)\s*(?:[:：=]|\s)?\s*(?:無|沒有|否|none|no)\b|無車位|沒有車位|不含車位/i.test(pj) && !/含車位|車位\s*(?:有|是)/.test(pj)) {
        set("has_parking", false);
      }
      const pingM = pj.match(/(?:車位|parking)[^\n]*?([0-9]+(?:\.[0-9]+)?)\s*(?:坪|ping)/i) || pj.match(/([0-9]+(?:\.[0-9]+)?)\s*坪\s*車位/);
      // F-R17B-01：「車位 有 總價 1180 萬」的總價是房子的總價，不是車位價；比對車位價前先把「總價」的價字遮掉
      const pjPrice = pj.replace(/總價/g, "總＊");
      const priceM =
        pjPrice.match(/車位(?:[^\n0-9:：=、，,;；|｜]{0,10}?(?:價格|價|售價|另計|另購|開價))?\s*(?:[:：=]|\s)?\s*(?:NT\$|NTD|\$)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(萬元|萬|万|元)/) ||
        // F-R17-02(a)：沒寫單位的「車位價格:150」，只在有「價」字的標籤下收，照開價的無單位規則（小於 10 萬當萬元）
        pjPrice.match(/車位(?:[^\n0-9:：=、，,;；|｜]{0,10}?)(?:價格|價|售價|另計|另購|開價)\s*(?:[:：=]|\s)?\s*(?:NT\$|NTD|\$)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)(?!\s*(?:坪|ping|個|位|格|樓|層|F|號))/i);
      const pingN = pingM ? num(pingM[1]) : null;
      if (pingN !== null && pingN > 0 && pingN < 100) set("parking_ping", pingN);
      const priceV = priceM ? priceToWan(priceM[1], priceM[2], pj) : null;
      if (priceV !== null) set("parking_price_ask", priceV);
      if (/含(?:在)?(?:總價|開價|價格)|車位(?:已)?含|總價含車位|含車位價|price\s*incl/i.test(pj)) set("parking_included_in_ask", true);
      else if (/車位另計|車位另購|不含(?:在)?(?:總價|開價)|車位另外|車位未含|price\s*excl/i.test(pj)) set("parking_included_in_ask", false);
      if (fields.has_parking === undefined) {
        if (/平面|機械|坡道|有車位|車位\s*(?:[:：=]|\s)?\s*(?:有|是|yes)|含車位|parking\s*(?:[:：=]|\s)?\s*(?:yes|flat|mechanical|有)/i.test(pj) || pingN !== null || priceV !== null) set("has_parking", true);
      }
      const kind = /平面/.test(pj) ? "平面" : /機械/.test(pj) ? "機械" : /flat/i.test(pj) ? "平面" : /mechanical/i.test(pj) ? "機械" : "";
      if (kind) notes.push(`車位型式：${kind}（沒有對應的欄位，只提醒你）`);
    }
  }
  // ---- 管理費 ----
  {
    const re = new RegExp(`(?:${LABELS.mgmt})(?:\\s*fees?)?\\s*(?:[（(]月[）)])?\\s*(?:[:：=]|\\s)?\\s*(?:NT\\$|NTD|TWD|\\$)?\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(萬|千|元|NTD|TWD)?`, "i");
    for (const line of lines) {
      const m = line.match(re);
      if (!m) continue;
      let n = num(m[1]);
      if (n === null || n < 0) continue;
      const unit = m[2] || "";
      if (unit === "萬") n *= 10000;
      else if (unit === "千") n *= 1000;
      if (n >= 0 && n < 1000000) {
        set("mgmt_fee_yuan", Math.round(n));
        break;
      }
    }
  }
  // ---- 案名與社區 ----
  {
    const lab = labelValue(lines, LABELS.community);
    const name = lab ? nameOnly(lab.value) : "";
    if (name) set("community_name", name);
    if (fields.community_name === undefined) {
      const m = body.match(/[【\[「『]([^】\]」』\n]{2,20})[】\]」』]/);
      const t = m ? nameOnly(m[1]) : "";
      if (t && !/\d{2,}/.test(t) && !/總價|售價|開價/.test(t)) set("community_name", t, "猜的");
    }
  }
  // ---- 產品類型 ----
  {
    const lab = labelValue(lines, LABELS.type);
    let type = "";
    if (lab) for (const [re, name] of PRODUCT_WORDS) if (re.test(lab.value)) { type = name; break; }
    if (type) set("product_type", type);
    else for (const [re, name] of PRODUCT_WORDS) if (re.test(body)) { set("product_type", name, "猜的"); break; }
  }
  // ---- 仲介公司、門市、稱呼（只當文字存，不認品牌）----
  {
    const company = labelValue(lines, LABELS.company);
    if (company) set("agent_company", nameOnly(company.value));
    const branch = labelValue(lines, LABELS.branch);
    if (branch) set("branch_label", nameOnly(branch.value));
    const agent = labelValue(lines, LABELS.agent);
    if (agent) set("agent_alias", nameOnly(agent.value.replace(/[0-9０-９+()\-\s]{6,}.*$/, "")));
  }
  // ---- 區域：只拿行政區名稱對區域表，猜一個（標猜的，要使用者確認）----
  {
    const list = (Array.isArray(areas) ? areas : []).filter((a) => a && a.area_code && a.area_label);
    const hits = list.filter((a) => allText.includes(String(a.area_label)));
    if (hits.length === 1) set("area_code", String(hits[0].area_code), "猜的");
  }
  // 表格被辨識成亂序（標籤一排、數值另一排）：依序配對沒找到的欄位
  pairScrambledTable(lines, fields, sources, set);

  const missing = SCORE_FIELDS.filter((k) => fields[k] === undefined || fields[k] === "");
  return { fields, sources, dropped, missing, notes };
}

/**
 * 表格被辨識成亂序時：標籤全部排在一起、數值排在後面。
 * 做法：找到一段連續「只有標籤、沒有數值」的行，後面緊接同樣數量的「只有數值」行，依序配對；配對出的欄位標「猜的」。
 */
function pairScrambledTable(lines, fields, sources, set) {
  const KEYED = [
    [/^(?:總價|售價|開價|特價|價格)$/, "ask_total"],
    [/^(?:權狀|權狀坪數|登記坪數|登記總坪|登記|總坪數|總坪|坪數|建坪)$/, "ping_total"],
    [/^(?:屋齡)$/, "age"],
    [/^(?:管理費|管理費用)$/, "mgmt_fee_yuan"],
    [/^(?:格局|房數)$/, "rooms_layout"],
    [/^(?:樓層)$/, "floor_note"]
  ];
  const keyOf = (line) => {
    const t = line.replace(/[:：\s]+$/g, "").trim();
    for (const [re, key] of KEYED) if (re.test(t)) return key;
    return null;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const labels = [];
    let j = i;
    while (j < lines.length && keyOf(lines[j])) {
      labels.push(keyOf(lines[j]));
      j += 1;
    }
    if (labels.length < 2) continue;
    const values = lines.slice(j, j + labels.length);
    if (values.length < labels.length) continue;
    labels.forEach((key, idx) => {
      const v = values[idx];
      const m = v.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*(萬元|萬|万|億|元|坪|年|ping)?/i);
      if (key === "ask_total" && m) {
        const w = priceToWan(m[1], m[2], v);
        if (w !== null) set("ask_total", w, "猜的");
      } else if (key === "ping_total" && m && fields.ping_total === undefined) {
        const n = num(m[1]);
        if (n !== null && n > 0 && n < 1000) set("ping_total", round2(n), "猜的");
      } else if (key === "age" && m) {
        const n = num(m[1]);
        if (n !== null && n >= 0 && n <= 200) set("age", n, "猜的");
      } else if (key === "mgmt_fee_yuan" && m) {
        const n = num(m[1]);
        if (n !== null && n >= 0 && n < 1000000) set("mgmt_fee_yuan", Math.round(n), "猜的");
      } else if (key === "rooms_layout") {
        const r = v.match(/(\d{1,2})\s*(?:房|室)/);
        const b = v.match(/(\d{1,2})\s*(?:衛浴|衛|浴)/);
        if (r) set("rooms", num(r[1]), "猜的");
        if (b) set("baths", num(b[1]), "猜的");
      } else if (key === "floor_note") {
        const f = floorNote(v);
        if (f) set("floor_note", f, "猜的");
      }
    });
    i = j + labels.length - 1;
  }
}

// ---------------------------------------------------------------------------
// AI 讀圖路線（F-R16-04）
// ---------------------------------------------------------------------------

/** AI 的 JSON 用哪些鍵名（App 的欄位代號，單位照 SHEET_FIELDS）。區域不在裡面（AI 不知道區域表，也不給地址）。 */
export const AI_JSON_KEYS = [
  ["community_name", "案名或社區名稱，文字"],
  ["ask_total", "開價，單位萬，數字"],
  ["ping_total", "登記總坪，單位坪，數字"],
  ["rooms", "房數，數字"],
  ["baths", "衛浴數，數字"],
  ["age", "屋齡，單位年，數字"],
  ["floor_note", "樓層，例如「7 樓，共 11 樓」"],
  ["product_type", "產品類型，只能是 大樓、華廈、公寓、透天 其中一個"],
  ["has_parking", "有無車位，只能是 有 或 無"],
  ["parking_ping", "車位坪，單位坪，數字"],
  ["parking_price_ask", "車位開價，單位萬，數字"],
  ["parking_included_in_ask", "車位是否含在開價，只能是 是 或 否"],
  ["mgmt_fee_yuan", "管理費，單位元每月，數字"],
  ["agent_company", "仲介公司，文字"],
  ["branch_label", "門市，文字"],
  ["agent_alias", "仲介稱呼，文字（只寫姓氏加先生或小姐這種，不要電話）"]
];

/** 複製給 AI 的提示詞：通用說法，不含任何私人資料。 */
export function buildSheetPrompt() {
  const keys = AI_JSON_KEYS.map(([k, d]) => `- ${k}：${d}`).join("\n");
  return [
    "請讀我附上的「帶看單」照片，把裡面的資料整理成一個 JSON 區塊，用 ```json 圍起來，只輸出這一個區塊，不要輸出其他文字。",
    "規則：",
    "1. 鍵名只能用下面列出的欄位代號，看不到或不確定的欄位一律填 null，不要猜。",
    "2. 不要輸出地址、門牌、電話、電子郵件，也不要輸出任何不在清單裡的鍵。",
    "3. 單位照下面寫的：開價與車位開價是「萬」，坪數是「坪」，管理費是「元每月」，屋齡是「年」；只填數字，不要寫單位。",
    "欄位代號與意思：",
    keys
  ].join("\n");
}

function stripFence(text) {
  const t = String(text ?? "").trim();
  const m = t.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  return (m ? m[1] : t).trim();
}

/** 這段貼上的內容是不是 JSON（含 ```json 圍起來的）；回傳 { isJson, data, error }。 */
export function detectSheetJson(text) {
  const body = stripFence(text);
  if (!body.startsWith("{")) return { isJson: false };
  try {
    const data = JSON.parse(body);
    if (data && typeof data === "object" && !Array.isArray(data)) return { isJson: true, data };
    return { isJson: false };
  } catch (err) {
    return { isJson: false, brokenJson: true, error: err?.message || "JSON 格式看不懂" };
  }
}

/** AI 路線裡的自由文字欄位（案名、樓層、仲介公司、門市、仲介稱呼、來源備註）：像地址就不寫入。 */
export const FREE_TEXT_KEYS = ["community_name", "floor_note", "agent_company", "branch_label", "agent_alias", "source_note"];

const AI_FLAG_WORDS = { 有: true, 無: false, 是: true, 否: false, true: true, false: false };

/**
 * AI 給的 JSON：每個欄位走欄位驗證（照匯入檔的規則 normalizeValue），不合規格的欄位標待核、不寫入（列在 invalid）。
 * 地址、電話一類不在清單裡的鍵一律丟掉（放進 dropped）。
 */
export function normalizeAiSheet(data, { areas = [] } = {}) {
  const fields = {};
  const sources = {};
  const dropped = [];
  const droppedFields = [];
  const invalid = [];
  const allowed = new Set(AI_JSON_KEYS.map(([k]) => k));
  const aliases = { parking_price: "parking_price_ask", mgmt_fee: "mgmt_fee_yuan" };
  for (const [rawKey, rawVal] of Object.entries(data && typeof data === "object" ? data : {})) {
    const key = aliases[rawKey] || rawKey;
    if (!allowed.has(key)) {
      if (rawVal !== null && rawVal !== undefined && rawVal !== "") dropped.push(`${rawKey}：${typeof rawVal === "string" ? rawVal : JSON.stringify(rawVal)}`);
      continue;
    }
    let v = rawVal;
    if (v === null || v === undefined || (typeof v === "string" && (v.trim() === "" || /^null$/i.test(v.trim())))) continue;
    if (typeof v === "string") v = toHalfwidth(v).trim();
    // 自由文字欄位如果像地址：這一欄不寫入（F-R16B-03），列在 dropped，預覽說明原因
    if (typeof v === "string" && FREE_TEXT_KEYS.includes(key) && (isAddressLine(v) || hasAddressPattern(v))) {
      dropped.push(`${rawKey}：${v}`);
      droppedFields.push(key);
      continue;
    }
    if (key === "has_parking" || key === "parking_included_in_ask") {
      if (!Object.prototype.hasOwnProperty.call(AI_FLAG_WORDS, String(v))) {
        invalid.push({ field: key, message: "只能是有、無（或是、否）", value: v });
        continue;
      }
      fields[key] = AI_FLAG_WORDS[String(v)];
      sources[key] = "AI";
      continue;
    }
    const r = normalizeValue("properties", key, typeof v === "string" && ["ask_total", "parking_price_ask"].includes(key) ? v.replace(/,/g, "") : v);
    if (r.state === "invalid") {
      invalid.push({ field: key, message: r.error || "不合規格", value: v });
      continue;
    }
    if (r.state === "ok") {
      fields[key] = r.value;
      sources[key] = "AI";
    }
  }
  // 地址不存進 App：就算 AI 給了地址，也只拿行政區名稱去猜區域，地址本身丟掉
  const list = (Array.isArray(areas) ? areas : []).filter((a) => a && a.area_code && a.area_label);
  const joined = dropped.join("\n");
  const hits = list.filter((a) => joined.includes(String(a.area_label)));
  if (hits.length === 1) {
    fields.area_code = String(hits[0].area_code);
    sources.area_code = "猜的";
  }
  const missing = SCORE_FIELDS.filter((k) => fields[k] === undefined || fields[k] === "");
  return { fields, sources, dropped, droppedFields, invalid, missing, notes: [] };
}

/** 貼上框的總入口：自動判斷是 JSON 還是一般文字（F-R16-04）。 */
export function parseSheetInput(text, ctx = {}) {
  const det = detectSheetJson(text);
  if (det.isJson) return { mode: "ai", ...normalizeAiSheet(det.data, ctx) };
  const out = parseViewingSheet(text, ctx);
  return { mode: "text", ...out, invalid: [], ...(det.brokenJson ? { notes: [...out.notes, "看起來像 JSON 但格式有誤，已改用一般文字的方式讀。"] } : {}) };
}
