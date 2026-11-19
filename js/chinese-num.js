/** Convert integers to Traditional Chinese numerals and list leak variants. */

const DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const FORMAL = ["零", "壹", "貳", "參", "肆", "伍", "陸", "柒", "捌", "玖"];

function under10000(n, digits) {
  if (n === 0) return digits[0];
  const qian = Math.floor(n / 1000);
  const bai = Math.floor((n % 1000) / 100);
  const shi = Math.floor((n % 100) / 10);
  const ge = n % 10;
  let s = "";
  if (qian) s += digits[qian] + "千";
  if (bai) s += digits[bai] + "百";
  else if (qian && (shi || ge)) s += digits[0];
  if (shi) {
    if (shi === 1 && !qian && !bai) s += "十";
    else s += digits[shi] + "十";
  } else if ((qian || bai) && ge) s += digits[0];
  if (ge) s += digits[ge];
  return s;
}

export function intToChinese(n, formal = false) {
  const digits = formal ? FORMAL : DIGITS;
  n = Math.round(Number(n));
  if (!Number.isFinite(n) || n < 0) return "";
  if (n === 0) return digits[0];
  if (n < 10000) return under10000(n, digits);
  const yi = Math.floor(n / 100000000);
  const wan = Math.floor((n % 100000000) / 10000);
  const rest = n % 10000;
  let s = "";
  if (yi) s += under10000(yi, digits) + "億";
  if (wan) {
    if (s && wan < 1000) s += digits[0];
    s += under10000(wan, digits) + "萬";
  } else if (yi && rest) s += digits[0];
  if (rest) {
    if (wan && rest < 1000) s += digits[0];
    s += under10000(rest, digits);
  }
  return s;
}

function toFullwidthDigits(s) {
  return String(s).replace(/[0-9]/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xff10 - 48));
}

function withQianBai(s) {
  return String(s).replace(/千/g, "仟").replace(/百/g, "佰");
}

/**
 * All writings of a 萬-unit amount that the draft scanner must catch
 * when value >= 100. Do not round decimals into integers.
 */
export function amountWritings(valueWan) {
  if (valueWan === undefined || valueWan === null || valueWan === "") return [];
  const n = Number(valueWan);
  if (!Number.isFinite(n)) return [];
  const out = new Set();
  if (!Number.isInteger(n)) {
    out.add(String(n));
    out.add(`${n}萬`);
    out.add(`${n}万`);
    out.add(toFullwidthDigits(String(n)));
    out.add(`${toFullwidthDigits(String(n))}萬`);
    return [...out].filter(Boolean);
  }
  const intPart = n;
  const withComma = intPart.toLocaleString("en-US");
  const cn = intToChinese(intPart);
  const cnFormal = intToChinese(intPart, true);
  const yuan = intPart * 10000;
  const yuanCn = intToChinese(yuan);
  // 以元為單位的千分位寫法（12,000,000、12，000，000）也是 1200 萬的寫法（F-R11-01）
  const yuanComma = yuan.toLocaleString("en-US");
  for (const w of [
    yuanComma,
    yuanComma.replace(/,/g, "，"),
    `${yuanComma}元`,
    String(intPart),
    withComma,
    withComma.replace(/,/g, "，"),
    `${intPart}萬`,
    `${intPart}万`,
    `${withComma}萬`,
    `${cn}`,
    `${cn}萬`,
    `${cn}万`,
    `${cnFormal}`,
    `${cnFormal}萬`,
    `${withQianBai(cn)}`,
    `${withQianBai(cn)}萬`,
    `${withQianBai(cnFormal)}`,
    `${withQianBai(cnFormal)}萬`,
    `${yuanCn}`,
    String(yuan),
    `${yuan}元`,
    `${intPart}.0`,
    `${intPart}.0萬`,
    toFullwidthDigits(String(intPart))
  ]) {
    out.add(w);
  }
  // 百萬寫法：值是 100 的倍數時，15 百萬、15百萬 都要擋
  if (intPart >= 100 && intPart % 100 === 0) {
    const baiwan = intPart / 100;
    out.add(`${baiwan}百萬`);
    out.add(`${baiwan} 百萬`);
    out.add(`${intToChinese(baiwan)}百萬`);
  }
  if (intPart >= 1000) {
    // 用固定三位小數再去掉尾端的 0，避免 1550 被四捨五入成 1.6
    const qianwan = Number((intPart / 1000).toFixed(3));
    out.add(`${qianwan}千萬`);
    out.add(`${qianwan}仟萬`);
    const whole = Math.floor(qianwan);
    const fracDigits = String(qianwan).split(".")[1] || "";
    if (fracDigits) {
      const cnW = whole ? intToChinese(whole) : "";
      const cnF = [...fracDigits].map((d) => (d === "0" ? "零" : intToChinese(Number(d)))).join("");
      out.add(`${cnW}點${cnF}千萬`);
      out.add(`${cnW}點${cnF}仟萬`);
    }
  }
  if (intPart >= 10000) {
    const yi = intPart / 10000;
    out.add(`${yi}億`);
    if (Number.isInteger(yi)) {
      out.add(`${intToChinese(yi)}億`);
    } else {
      const whole = Math.floor(yi);
      const fracDigits = String(yi).split(".")[1] || "";
      if (fracDigits) {
        const cnW = whole ? intToChinese(whole) : "零";
        const cnF = [...fracDigits].map((d) => (d === "0" ? "零" : intToChinese(Number(d)))).join("");
        out.add(`${cnW}點${cnF}億`);
      }
    }
  }
  return [...out].filter(Boolean);
}

export function toFullwidth(s) {
  return toFullwidthDigits(s);
}

const CN_DIGIT = {
  零: 0,
  "〇": 0,
  "○": 0,
  一: 1,
  二: 2,
  兩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  壹: 1,
  貳: 2,
  參: 3,
  叁: 3,
  肆: 4,
  伍: 5,
  陸: 6,
  柒: 7,
  捌: 8,
  玖: 9
};
const CN_SMALL = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000 };

function parseUnderWan(s) {
  if (!s) return 0;
  let n = 0;
  let num = 0;
  for (const ch of s) {
    if (CN_DIGIT[ch] !== undefined) num = CN_DIGIT[ch];
    else if (CN_SMALL[ch]) {
      n += (num || 1) * CN_SMALL[ch];
      num = 0;
    }
  }
  return n + num;
}

function parseDianFraction(s) {
  let frac = 0;
  let div = 10;
  for (const ch of String(s || "")) {
    if (CN_DIGIT[ch] !== undefined) {
      frac += CN_DIGIT[ch] / div;
      div *= 10;
    } else if (/^\d$/.test(ch)) {
      frac += Number.parseInt(ch, 10) / div;
      div *= 10;
    }
  }
  return frac;
}

/** Parse a Chinese numeral string (optionally ending in 萬／元／億) into a number. Supports 點. */
export function parseChineseNumber(s) {
  const raw = String(s || "").replace(/整$/, "");
  if (!raw) return null;
  const rest0 = raw.replace(/元$/, "");
  if (rest0.includes("點")) {
    let mul = 1;
    let rest = rest0;
    if (/億$/.test(rest)) {
      mul = 100000000;
      rest = rest.replace(/億$/, "");
    } else if (/[千仟]萬$/.test(rest)) {
      mul = 10000000;
      rest = rest.replace(/[千仟]萬$/, "");
    } else if (/萬|万$/.test(rest)) {
      mul = 10000;
      rest = rest.replace(/[萬万]$/, "");
    }
    const [head, tail] = rest.split("點");
    const whole = head ? parseUnderWan(head) || 0 : 0;
    const frac = parseDianFraction(tail);
    const n = (whole + frac) * mul;
    return Number.isFinite(n) ? n : null;
  }
  let total = 0;
  let rest = rest0;
  const yi = rest.split(/億/);
  if (yi.length > 1) {
    total += (parseUnderWan(yi[0]) || 1) * 100000000;
    rest = yi.slice(1).join("億");
  }
  const wan = rest.split(/萬|万/);
  if (wan.length > 1) {
    const preBai = wan[0].match(/^([^百佰千仟]+)[百佰]$/);
    const wanUnits = preBai ? (parseUnderWan(preBai[1]) || 1) * 100 : (parseUnderWan(wan[0]) || 1);
    total += wanUnits * 10000;
    rest = wan.slice(1).join("萬");
  }
  total += parseUnderWan(rest) || 0;
  return Number.isFinite(total) ? total : null;
}

export function sameWan(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return Math.round(x * 10000) === Math.round(y * 10000);
}

export function sameRatio(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return Math.round(x * 1e6) === Math.round(y * 1e6);
}

function pctString(n) {
  const pct = n * 100;
  if (Number.isInteger(pct) || Math.abs(pct - Math.round(pct)) < 1e-9) return String(Math.round(pct));
  return String(Math.round(pct * 100) / 100);
}

/**
 * Writings of a 0–1 ratio: decimal, percent, 百分之, 成數, 千分比.
 */
export function ratioWritings(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return [];
  const out = new Set();
  out.add(String(n));
  if (n < 0 || n > 1) return [...out];
  const pctStr = pctString(n);
  out.add(`${pctStr}%`);
  out.add(`${pctStr} %`);
  out.add(`${pctStr}％`);
  const pctNum = Number(pctStr);
  if (Number.isFinite(pctNum) && (Number.isInteger(pctNum) || Math.abs(pctNum - Math.round(pctNum)) < 1e-9)) {
    const cn = intToChinese(Math.round(pctNum));
    if (cn) out.add(`百分之${cn}`);
  }
  const tenths = Math.round(n * 100) / 10;
  if (Math.abs(tenths - Math.round(tenths)) < 1e-9) {
    const t = Math.round(tenths);
    out.add(`${t}成`);
    out.add(`${t} 成`);
    const cnT = intToChinese(t);
    if (cnT) out.add(`${cnT}成`);
  } else {
    const rounded = Math.round(tenths * 10) / 10;
    out.add(`${rounded}成`);
    const whole = Math.floor(rounded + 1e-9);
    const frac = Math.round((rounded - whole) * 10);
    out.add(`${whole}成${frac}`);
    const cnW = intToChinese(whole);
    const cnF = intToChinese(frac);
    if (cnW && cnF) out.add(`${cnW}成${cnF}`);
  }
  const permille = Math.round(n * 1000);
  if (Number.isFinite(permille)) {
    out.add(`${permille}‰`);
    out.add(`${permille} ‰`);
  }
  return [...out].filter(Boolean);
}

function parseChengHead(token) {
  if (token === undefined || token === null || token === "") return null;
  if (/^\d/.test(token)) {
    const n = Number(token);
    return Number.isFinite(n) ? n : null;
  }
  if (CN_DIGIT[token] !== undefined) return CN_DIGIT[token];
  return parseChineseNumber(token);
}

/**
 * Pull percent / 成數 / 百分之 / 千分比 / 點 mentions and convert to 0–1.
 */
export function extractNormalizedRatios(text) {
  const t = String(text || "")
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xff10 + 48))
    .replace(/．/g, ".");
  const out = [];
  const push = (raw, value) => {
    if (!Number.isFinite(value)) return;
    out.push({ raw, value });
  };
  const pctRe = /(\d+(?:\.\d+)?)\s*[%％](?!‰)/g;
  let m;
  while ((m = pctRe.exec(t))) {
    push(m[0], Number.parseFloat(m[1]) / 100);
  }
  const permilleRe = /(\d+(?:\.\d+)?)\s*‰/g;
  while ((m = permilleRe.exec(t))) {
    push(m[0], Number.parseFloat(m[1]) / 1000);
  }
  const dianRe = /([零一二三四五六七八九十兩]+|\d+)點([零一二三四五六七八九]+|\d+)/g;
  while ((m = dianRe.exec(t))) {
    const parsed = parseChineseNumber(m[0]);
    if (parsed != null && parsed >= 0 && parsed <= 1) push(m[0], parsed);
  }
  const baiRe = /百分之([零一二三四五六七八九十百兩]+|\d+(?:\.\d+)?)/g;
  while ((m = baiRe.exec(t))) {
    const token = m[1];
    const n = /^\d/.test(token) ? Number(token) : parseChineseNumber(token);
    if (n != null && Number.isFinite(n)) push(m[0], n / 100);
  }
  const chengRe = /([零一二三四五六七八九十兩]|\d+(?:\.\d+)?)\s*成([零一二三四五六七八九]|\d)?/g;
  while ((m = chengRe.exec(t))) {
    const n1 = parseChengHead(m[1]);
    if (n1 === null) continue;
    let tenths = n1;
    if (m[2] != null && m[2] !== "") {
      const n2 = parseChengHead(m[2]);
      if (n2 === null) continue;
      if (Number.isInteger(n1)) tenths = n1 + n2 / 10;
    }
    push(m[0], tenths / 10);
  }
  return out;
}

/**
 * 緊鄰數字就當成金額的詞（掃描器的 MONEY_WORDS 與這裡共用這一份）。
 * 第 15 輪 F-R15-02：補「月入」「月薪」「年薪」「年收」「年入」，所以「月入12」這種縮寫會被擋。
 * 第 16 輪 F-R16-42、47：「月入」「年入」後面接「住、帳、厝」，只有在「前面緊接月份或年份的日期寫法」時才排除，
 * 也就是數字加月（12 月入住、12月入帳、12 月入厝），或去年、今年、明年、前年、後年、數字加年（去年入住 12 日、今年入帳 12 筆）。
 * 「每月入帳 12」「月入帳面 12」「月入住宿費 12」前面不是日期，照樣當成收入來擋。
 * 這裡用「回頭看」比對前一個字，所以呼叫處要讓比對看得到數字前後的字（見 hasMoneyContext）。
 */
export const MONEY_WORD_PATTERN = String.raw`收入|支出|月付|借款|持有成本|存款|可動用資金|流動資金|頭期|上限|(?<!\d\s?)月入|(?<=\d\s?)月入(?![住帳厝])|月薪|年薪|年收|(?<![去今明前後\d]\s?)年入|(?<=[去今明前後\d]\s?)年入(?![住帳厝])`;
const MONEY_NEAR = new RegExp(`${MONEY_WORD_PATTERN}|自備`);
/** 數字前面緊貼的貨幣記號（NT$12,000,000、$600,000、新台幣 600,000）也算金額字詞（F-R11-01）。 */
const CURRENCY_LEFT = /(?:NT\$|NTD|TWD|\$|＄|新台幣|新臺幣|台幣|臺幣)\s*$/i;

function hasMoneyContext(text, start, end) {
  const left = text.slice(Math.max(0, start - 8), start);
  const right = text.slice(end, Math.min(text.length, end + 4));
  if (/萬|万|元|千|億/.test(right) || /萬|万|元|千|億/.test(left.slice(-1))) return true;
  if (CURRENCY_LEFT.test(left)) return true;
  // 第 16 輪：把數字本身放進比對範圍，「回頭看」才看得到「12 月入住」前面的數字（日期寫法不誤擋）
  return MONEY_NEAR.test(text.slice(Math.max(0, start - 8), Math.min(text.length, end + 4)));
}

function pushAmount(out, raw, wan, yuan, adjacentMoney) {
  if (!Number.isFinite(wan)) return;
  out.push({ raw, wan, yuan: Number.isFinite(yuan) ? yuan : wan * 10000, adjacentMoney: !!adjacentMoney });
}

/**
 * 阿拉伯數字與國字單位混寫（1千2百萬、1千200萬、一千2百萬、1億2000萬）要先合併成一筆再換算（F-R11-01）。
 * 白話：以前「1千2百萬」被拆成「1千」與「2百萬」兩筆小金額，湊不回 1200 萬，所以私密上限寫成這樣會漏擋。
 * 做法：先把整串（含阿拉伯數字、國字數字、十百千、萬、億）切成小單位，再照一般中文數字的讀法累加成元。
 */
const MIXED_TOKEN = String.raw`\d{1,3}(?:,\d{3})+|\d+|[零〇○一二兩三四五六七八九壹貳參叁肆伍陸柒捌玖]|[十拾百佰千仟萬万億]`;
const MIXED_RUN_RE = new RegExp(`(?:${MIXED_TOKEN})+`, "g");
const MIXED_TOKEN_RE = new RegExp(MIXED_TOKEN, "g");
/** 「數字加單一個單位」是原本數字掃描就處理的寫法，不重複當成混寫。 */
const SIMPLE_AMOUNT_RE = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:百萬|千萬|仟萬|億|萬|万|仟|千)?$/;
const MIXED_SMALL = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000 };

/** 回傳 { yuan, alt }：yuan 是照讀法算出的元；alt 是「億之後的尾數省略了萬」的另一種讀法（沒有就是 null）。 */
function parseMixedYuan(run) {
  let total = 0;
  let section = 0;
  let pending = 0;
  let lastBig = "";
  let pendingFromCn = false;
  for (const tok of run.match(MIXED_TOKEN_RE) || []) {
    if (/^[\d]/.test(tok)) {
      pending = Number(tok.replace(/,/g, ""));
      pendingFromCn = false;
    } else if (CN_DIGIT[tok] !== undefined) {
      pending = pendingFromCn ? pending * 10 + CN_DIGIT[tok] : CN_DIGIT[tok];
      pendingFromCn = true;
    } else if (MIXED_SMALL[tok] !== undefined) {
      section += (pending || 1) * MIXED_SMALL[tok];
      pending = 0;
      pendingFromCn = false;
    } else {
      const v = section + pending;
      if (v === 0) continue;
      total += v * (tok === "億" ? 100000000 : 10000);
      lastBig = tok;
      section = 0;
      pending = 0;
      pendingFromCn = false;
    }
  }
  const tail = section + pending;
  const alt = lastBig === "億" && tail > 0 ? total + tail * 10000 : null;
  return { yuan: total + tail, alt };
}

function pushMixedAmounts(out, t) {
  const re = new RegExp(MIXED_RUN_RE.source, "g");
  let m;
  while ((m = re.exec(t))) {
    const run = m[0];
    if (!/\d/.test(run) || !/[零〇○一二兩三四五六七八九壹貳參叁肆伍陸柒捌玖十拾百佰千仟萬万億]/.test(run)) continue;
    if (SIMPLE_AMOUNT_RE.test(run)) continue;
    const { yuan, alt } = parseMixedYuan(run);
    const near = hasMoneyContext(t, m.index, m.index + run.length) || /[萬万億]/.test(run);
    if (yuan > 0) pushAmount(out, run, yuan / 10000, yuan, near);
    if (alt !== null) pushAmount(out, run, alt / 10000, alt, near);
  }
}

/**
 * Find numbers in text, drop trailing zeros, convert 萬／元／千萬, then return 萬-unit values.
 */
export function extractNormalizedAmounts(text) {
  const original = String(text || "");
  const t = original
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xff10 + 48))
    .replace(/．/g, ".")
    .replace(/，/g, ",");
  const out = [];
  const re = /(?<![0-9.])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(百萬|千萬|仟萬|億|萬|万|仟|千|元)?/g;
  let m;
  while ((m = re.exec(t))) {
    const intPart = m[1].replace(/,/g, "");
    const frac = m[2] ? `.${m[2]}` : "";
    const n = Number(`${intPart}${frac}`);
    if (!Number.isFinite(n)) continue;
    const unit = m[3] || "";
    let wan;
    let yuan;
    if (unit === "元") {
      yuan = n;
      wan = n / 10000;
    } else if (unit === "百萬") {
      wan = n * 100;
      yuan = wan * 10000;
    } else if (unit === "千萬" || unit === "仟萬") {
      wan = n * 1000;
      yuan = wan * 10000;
    } else if (unit === "億") {
      wan = n * 10000;
      yuan = wan * 10000;
    } else if (unit === "千" || unit === "仟") {
      yuan = n * 1000;
      wan = yuan / 10000;
    } else if (unit === "萬" || unit === "万") {
      wan = n;
      yuan = n * 10000;
    } else {
      wan = n;
      yuan = n * 10000;
    }
    const near = hasMoneyContext(t, m.index, m.index + m[0].length);
    pushAmount(out, m[0], wan, yuan, near || !!unit);
    // 沒有單位的大數字也可能是「以元為單位」：12,000,000、NT$12,000,000 是 1200 萬，另外推一筆當元的換算（F-R11-01）
    if (!unit && n >= 10000) pushAmount(out, m[0], n / 10000, n, near);
  }
  // 用空白、不換行空白或句點分組的千分位（12 000 000、12.000.000）：至少兩組才當成金額（避免把小數當千分位），一律當元換算（F-R11-01）
  const groupedRe = /(?<![\d.,])(\d{1,3}(?:[ \u00a0\u2009.]\d{3}){2,})(?![\d,]|\.\d)/g;
  while ((m = groupedRe.exec(t))) {
    const n = Number(m[1].replace(/[ \u00a0\u2009.]/g, ""));
    if (Number.isFinite(n)) pushAmount(out, m[0], n / 10000, n, hasMoneyContext(t, m.index, m.index + m[0].length));
  }
  pushMixedAmounts(out, t);
  const cnRe = /([零一二三四五六七八九壹貳參肆伍陸柒捌玖十百千仟佰拾兩兩〇○點]+(?:億)?[零一二三四五六七八九壹貳參肆伍陸柒捌玖十百千仟佰拾兩兩〇○點]*(?:萬|万)?)(元)?/g;
  while ((m = cnRe.exec(t))) {
    if (m[0].length < 2 && !m[2]) continue;
    const parsed = parseChineseNumber(m[0]);
    if (parsed === null || parsed === 0) continue;
    const asYuan = !!m[2] || /元$/.test(m[0]);
    const hasUnit = asYuan || /[萬万億]/.test(m[0]);
    const wan = hasUnit || parsed >= 10000 ? parsed / 10000 : parsed;
    const yuan = wan * 10000;
    pushAmount(out, m[0], wan, yuan, hasMoneyContext(t, m.index, m.index + m[0].length) || asYuan || /萬|万|億/.test(m[0]));
  }
  return out;
}

/** 掃描器與閘門共用的金額擷取，單位為萬。 */
export function extractMoneyWan(text) {
  return extractNormalizedAmounts(text);
}
