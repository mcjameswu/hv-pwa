/**
 * Weekly viewing-slot rule (design supplement 3.2).
 * Pure function: takes user-entered time blocks. Does NOT read a calendar
 * and does NOT call any map service.
 */

import { splitList } from "./lists.js";
import { parseNumericRaw, isFlagOn } from "./fields.js";

const BUFFER = 15;
const MIN_USABLE = 135;
const LUNCH_START = 11 * 60 + 30;
const LUNCH_END = 13 * 60 + 30;

export function parseHM(s) {
  if (typeof s === "number") {
    if (!Number.isFinite(s) || s < 0 || s > 24 * 60) return null;
    return s;
  }
  const m = String(s).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number.parseInt(m[1], 10);
  const min = Number.parseInt(m[2], 10);
  if (h === 24 && min === 0) return 24 * 60; else if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function formatHM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function defaultWindows(halfHours = 4) {
  const len = Math.round(halfHours * 60);
  return [
    { id: "am", label: "上午", start: parseHM("08:30"), end: parseHM("08:30") + len },
    { id: "pm", label: "下午", start: parseHM("13:30"), end: parseHM("13:30") + len }
  ];
}

function lookupCommute(travel, fromAlias, areaCode, direction) {
  if (!fromAlias || fromAlias === "家") {
    /* fall through */
  }
  if (!travel || !travel.length) return { known: false, minutes: null };
  const row = travel.find((t) => t.place_alias === fromAlias);
  if (!row) return { known: false, minutes: null };
  const field = direction === "back"
    ? (row.minutes_back || row.minutes_to_area)
    : row.minutes_to_area;
  if (!field) return { known: false, minutes: null };
  const map = {};
  for (const part of splitList(field)) {
    const m = part.trim().match(/^([A-Z]{2}\d{2})\s*[:：]\s*(\d+)$/);
    if (m) map[m[1]] = Number.parseInt(m[2], 10);
  }
  if (map[areaCode] === undefined) {
    if (direction === "back") {
      const fallback = {};
      for (const part of splitList(row.minutes_to_area || "")) {
        const m2 = part.trim().match(/^([A-Z]{2}\d{2})\s*[:：]\s*(\d+)$/);
        if (m2) fallback[m2[1]] = Number.parseInt(m2[2], 10);
      }
      if (fallback[areaCode] !== undefined) return { known: true, minutes: fallback[areaCode] };
    }
    return { known: false, minutes: null };
  }
  return { known: true, minutes: map[areaCode] };
}

/**
 * Compute usable field minutes for one candidate slot.
 */
export function usableFieldTime(input) {
  const {
    slotStart,
    slotEnd,
    prevEnd = null,
    nextStart = null,
    outboundMin,
    returnMin,
    overnightOutOfCounty = false,
    isMorning = false,
    tripCount = 0,
    prevOutOfCounty = false,
    nextOutOfCounty = false,
    longDistance = false
  } = input;

  const reasons = [];
  const hasReturnTrip = isFlagOn(input.hasReturnTrip);
  const halfHours = input.halfHours ?? 4;
  const times = [slotStart, slotEnd, outboundMin, returnMin];
  if (times.some((t) => t == null || !Number.isFinite(t) || t < 0)) {
    return { exclude: true, ok: false, usable: null, reasons: ["時間非法或為負"] };
  }
  if (slotStart >= slotEnd) {
    return { exclude: true, ok: false, usable: null, reasons: ["時段開始不早於結束"] };
  }
  for (const neighbor of [prevEnd, nextStart]) {
    if (neighbor !== null && neighbor !== undefined && !(Number.isFinite(neighbor) && neighbor >= 0)) {
      return { exclude: true, ok: false, usable: null, reasons: ["前後行程時間非法"] };
    }
  }
  if (isFlagOn(overnightOutOfCounty) && isFlagOn(isMorning) && !hasReturnTrip) {
    return { exclude: true, usable: 0, reasons: ["前一晚外縣市過夜，上午排除"] };
  }
  if (tripCount >= 3) {
    return { exclude: true, usable: 0, reasons: ["當天已有 3 個以上行程"] };
  }
  if (isFlagOn(prevOutOfCounty) || isFlagOn(nextOutOfCounty) || isFlagOn(longDistance)) {
    return { exclude: true, usable: 0, reasons: ["前後行程在外縣市或需長程交通"] };
  }

  let depart = slotStart;
  if (prevEnd !== null && prevEnd !== undefined) {
    depart = Math.max(slotStart, prevEnd);
    const gap = slotStart - prevEnd;
    if (prevEnd >= 11 * 60 && prevEnd <= 13 * 60 + 30 && gap < 45) {
      depart = prevEnd + 45;
    }
  }
  const arrive = depart + outboundMin;
  let leaveLimit = slotEnd;
  if (nextStart !== null && nextStart !== undefined) leaveLimit = Math.min(slotEnd, nextStart);
  const actualLeave = leaveLimit - returnMin;
  let lunchDeduct = 0;
  if (arrive <= LUNCH_START && actualLeave >= LUNCH_END) lunchDeduct = 45;
  const usable = actualLeave - arrive - BUFFER - lunchDeduct;
  const exclude = usable < MIN_USABLE;
  if (exclude) reasons.push(`可用現場 ${usable} 分，少於 ${MIN_USABLE}`);
  const fullNeed = halfHours >= 4 ? 175 : 145;
  const fullMark = usable >= fullNeed ? "可看滿" : "";
  return {
    exclude,
    usable,
    depart,
    arrive,
    actualLeave,
    lunchDeduct,
    reasons,
    fullMark
  };
}

/**
 * Rank up to 3 candidate slots from user-entered blocks.
 *
 * @param {object} args
 * @param {{start:string,end:string,place?:string}[]} args.events weekday events
 * @param {object[]} args.travel commute table
 * @param {string} args.areaCode
 * @param {number} args.halfHours 3.5 or 4
 * @param {string[]} args.excludeDates user-flagged infeasible dates
 * @param {object} args.overrides {outbound, return} minutes if table missing a pair, still 待核
 */
export function suggestSlots(args) {
  const {
    events = [],
    travel = [],
    areaCode,
    halfHours = 4,
    homeAlias = "家",
    excludeDates = [],
    forcedExclude = [],
    days = [],
    outboundMin,
    returnMin
  } = args;

  const windows = args.windows?.length ? args.windows : defaultWindows(halfHours);
  const candidates = [];
  // 行程時間格式錯誤不默默濾掉：記下是第幾筆，整體回 status: "invalid"
  const invalidEvents = [];
  events.forEach((e, i) => {
    if (parseHM(e?.start) === null || parseHM(e?.end) === null) invalidEvents.push({ index: i + 1, start: e?.start, end: e?.end });
  });
  for (const day of days) {
    if (excludeDates.includes(day.date) || forcedExclude.includes(day.date)) {
      candidates.push({
        date: day.date,
        exclude: true,
        reasons: ["使用者指出不可行或指定排除"]
      });
      continue;
    }
    const dayEvents = events.filter((e) => e.date === day.date);
    const overnight = !!day.overnightOutOfCounty;
    for (const w of windows) {
      const hasReturnTrip = dayEvents.some((e) => {
        if (!(e.returnTrip || e.kind === "返程")) return false;
        const done = parseHM(e.end) ?? parseHM(e.start);
        return done !== null && done <= w.start;
      });
      const parsedEv = dayEvents
        .map((e) => ({ ...e, s: parseHM(e.start), en: parseHM(e.end) }))
        .filter((e) => e.s !== null && e.en !== null);
      const coversWindow = parsedEv.some((e) => e.s <= w.start && e.en >= w.end);
      const interior = parsedEv.filter((e) => e.s > w.start && e.en < w.end);
      if (coversWindow || interior.length) {
        candidates.push({
          date: day.date,
          window: w.label,
          windowId: w.id,
          exclude: true,
          rankable: false,
          reasons: ["時段內有無法避開的重疊行程"]
        });
        continue;
      }
      const prev = [...parsedEv]
        .filter((e) => e.en <= w.start || (e.s <= w.start && e.en > w.start))
        .sort((a, b) => b.en - a.en)[0];
      const next = [...parsedEv]
        .filter((e) => e.s >= w.end || (e.s < w.end && e.en >= w.end))
        .sort((a, b) => a.s - b.s)[0];
      const origin = prev ? prev.place || homeAlias : homeAlias;
      const dest = next ? next.place || homeAlias : homeAlias;
      let out = outboundMin;
      let back = returnMin;
      let commutePending = false;
      const ov = args.overrides;
      if (ov && (ov.outbound != null || ov.return != null)) {
        out = ov.outbound ?? out;
        back = ov.return ?? back;
        commutePending = true;
      } else if (out === undefined || back === undefined) {
        const o = lookupCommute(travel, origin, areaCode, "out");
        const b = lookupCommute(travel, dest, areaCode, "back");
        if (!o.known || !b.known) commutePending = true;
        out = o.minutes;
        back = b.minutes;
      }
      if (commutePending) {
        candidates.push({
          date: day.date,
          window: w.label,
          exclude: true,
          commutePending: true,
          reasons: ["通勤待核"],
          rankable: false
        });
        continue;
      }
      const result = usableFieldTime({
        slotStart: w.start,
        slotEnd: w.end,
        prevEnd: prev ? prev.en : null,
        nextStart: next ? next.s : null,
        outboundMin: out,
        returnMin: back,
        overnightOutOfCounty: isFlagOn(overnight),
        isMorning: w.id === "am",
        hasReturnTrip,
        halfHours,
        tripCount: dayEvents.length,
        prevOutOfCounty: isFlagOn(prev?.outOfCounty),
        nextOutOfCounty: isFlagOn(next?.outOfCounty),
        longDistance: isFlagOn(prev?.longDistance) || isFlagOn(next?.longDistance)
      });
      candidates.push({
        date: day.date,
        window: w.label,
        windowId: w.id,
        outboundMin: out,
        returnMin: back,
        origin,
        dest,
        rankable: !result.exclude && !commutePending,
        ...result
      });
    }
  }
  function isValidYmd(dateStr) {
    const ymd = String(dateStr || "").slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m) return false;
    const y = parseNumericRaw(m[1]).value;
    const mo = parseNumericRaw(m[2]).value;
    const da = parseNumericRaw(m[3]).value;
    if (y == null || mo == null || da == null) return false;
    const d = new Date(Date.UTC(y, mo - 1, da));
    return !Number.isNaN(d.getTime()) && d.getUTCFullYear() === y && d.getUTCMonth() === mo - 1 && d.getUTCDate() === da;
  }
  function isWeekend(dateStr) {
    if (isFlagOn(dayLookup(dateStr)?.weekend)) return true;
    const ymd = String(dateStr).slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m) return false;
    const y = parseNumericRaw(m[1]).value;
    const mo = parseNumericRaw(m[2]).value;
    const da = parseNumericRaw(m[3]).value;
    if (y == null || mo == null || da == null) return false;
    const d = new Date(Date.UTC(y, mo - 1, da));
    if (Number.isNaN(d.getTime()) || d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== da) return false;
    const wd = d.getUTCDay();
    return wd === 0 || wd === 6;
  }
  function dayLookup(dateStr) {
    return days.find((d) => d.date === dateStr);
  }
  const rankableAll = candidates.filter((c) => c.rankable && (!/^\d{4}-\d{2}-\d{2}/.test(String(c.date || "")) || isValidYmd(c.date)));
  const weekday = rankableAll.filter((c) => !isWeekend(c.date));
  const weekend = rankableAll.filter((c) => isWeekend(c.date));
  const pool = weekday.length ? weekday : weekend;
  const rankable = invalidEvents.length ? [] : pool.sort((a, b) => b.usable - a.usable).slice(0, 3);
  return { candidates, top: rankable, invalidEvents, status: invalidEvents.length ? "invalid" : "ok" };
}

/** Evening 333 window 17:30-20:30, in-store >= 75, each way <= 30. */
export function agencyEveningOk({ outboundMin, returnMin, shopOpen, shopClose, hoursVerified = false }) {
  const start = parseHM("17:30");
  const end = parseHM("20:30");
  if (!Number.isFinite(outboundMin) || !Number.isFinite(returnMin) || outboundMin < 0 || returnMin < 0) {
    return { ok: false, reason: "通勤待核" };
  }
  if (outboundMin > 30 || returnMin > 30) return { ok: false, reason: "去程或回程超過 30 分" };
  if (!isFlagOn(hoursVerified)) return { ok: false, reason: "門市營業時間未查證" };
  const shopStart = parseHM(shopOpen);
  const shopEnd = parseHM(shopClose);
  if (shopStart === null || shopEnd === null) return { ok: false, reason: "門市營業時間未查證" };
  const arrive = start + outboundMin;
  const leave = end - returnMin;
  const inStore = Math.min(leave, shopEnd) - Math.max(arrive, shopStart);
  if (!Number.isFinite(inStore) || inStore < 75) return { ok: false, reason: "店內不足 75 分鐘" };
  return { ok: true, inStore };
}
