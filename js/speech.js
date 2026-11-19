/**
 * Online speech-to-text is off by default. Requires consent checkbox
 * each time, and settings.online_transcribe === 是.
 */

import { isFlagOn } from "./fields.js";

/**
 * 是否類旗標（同意、設定是否允許）一律用全 App 統一的 isFlagOn：只認布林 true 與字串「是」，
 * 字串「否」、「待核」、空白、其他任何值都不算同意（C-R11-03，白話：以前「否」是一個非空字串，會被當成有同意）。
 */
export function canEnableOnlineStt({ settings, consented, fieldMode = true }) {
  if (!isFlagOn(consented)) {
    return { ok: false, reason: "未勾「已告知在場的人並取得同意」" };
  }
  if (!isFlagOn(settings?.online_transcribe)) {
    return { ok: false, reason: "設定未允許線上即時轉文字" };
  }
  return { ok: true, fieldDefaultOff: fieldMode };
}

export function auditSttEnable(now = new Date().toISOString()) {
  return {
    type: "online_stt_enable",
    at: now,
    note: "使用者手動開啟線上轉文字，聲音會送到語音服務商"
  };
}

export function onSpeechNetworkError(chunks) {
  return { crashed: false, chunks_intact: Array.isArray(chunks), message: "已斷網，改用本機錄音" };
}

export function speechRecognitionCtor(globalObj = globalThis) {
  return globalObj.SpeechRecognition || globalObj.webkitSpeechRecognition || null;
}

export function appendTranscript(existing, chunk) {
  return `${existing || ""}${chunk || ""}`;
}

export function createBrowserStt({ lang = "zh-TW", onText, onError, onEnd, globalObj = globalThis } = {}) {
  const Ctor = speechRecognitionCtor(globalObj);
  if (!Ctor) return { ok: false, message: "此瀏覽器不支援" };
  let rec;
  try {
    rec = new Ctor();
  } catch (err) {
    return { ok: false, message: "此瀏覽器無法開啟轉文字" };
  }
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (ev) => {
    let text = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      if (!ev.results[i].isFinal) continue;
      text += ev.results[i][0]?.transcript || "";
    }
    if (onText && text) onText(text);
  };
  rec.onerror = () => {
    if (onError) onError("轉文字已中斷，本機錄音照常");
  };
  // 辨識器自己結束（斷線、逾時）時通知呼叫端，才能釋放連線並更新訊息（F9-09）
  rec.onend = () => {
    if (onEnd) onEnd();
  };
  return { ok: true, rec };
}

/**
 * 等稽核寫完之後，能不能真的啟動線上轉文字（F9-09）。
 * 白話：按下「開啟線上轉文字」後系統先寫一筆稽核紀錄；等待的這一小段時間，使用者可能已按停止、
 * 取消同意或換了看房。任何一項不成立就不可以啟動，否則聲音會在使用者表示停止之後送到語音服務商。
 */
export function sttMayStart({ gen, currentGen, consented, boundViewingId, currentViewingId, settings } = {}) {
  if (gen !== currentGen) return false;
  if (consented !== true) return false;
  if (!boundViewingId || boundViewingId !== currentViewingId) return false;
  return isFlagOn(settings?.online_transcribe);
}
