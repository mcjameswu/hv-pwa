import * as db from "./db.js";
import { loadImportSchema, setImportSchema } from "./js/schema.js";
import { splitList, joinList } from "./js/lists.js";
import { diffDataset } from "./js/merge.js";
import { readImportFiles } from "./js/import-file.js";
import { UNKNOWN_FILE_MESSAGE, prefillHint } from "./js/notes-import.js";
import { scoreProperty, priceDropToCapReminder, propertiesForAgentDraft, isStretchProperty, assessPropertyFromState, latestAnswerClearsVeto, orderedViewings, mergedEvidenceFor } from "./js/scoring.js";
import { runAffordability, DOWN_PENDING } from "./js/affordability.js";
import { scanDraft, whitelistUploadPack } from "./js/scanner.js";
import { prepareOutbound, writeClipboard, downloadOutbound, displayDiffChanges, downloadBackupJson, downloadZipBytes, deliverNotesFile, systemPartnerText } from "./js/egress.js";
import { parseHM, formatHM } from "./js/slots.js";
import { countViewing, uniqueCounted, w3OnsiteAudit, sameDaySoftWarning, responseValue } from "./js/counting.js";
import { w3Judge, w6Judge, w10Judge, w0PlanStartAllowed, minutesSplit, checkpointLabel, adoptedHalfDayHours, w3FullJudge, w6FullJudge, retroWriteVeto } from "./js/checkpoints.js";
import {
  canStartAgencyVisit,
  activeHardGates,
  openingScript,
  answerAQ,
  scriptText,
  stretchInquiryDraft,
  PARTNER_STAGES,
  CROSS_CHECK_OPTIONS,
  licenseConfirmed,
  agentDraft,
  transferAgent,
  vis17RedFlag,
  vis14Score,
  listingDocsRedFlag,
  QUESTIONS,
  DEFAULT_UNVERIFIED,
  checkAboutPhrase,
  mainPartnersOk,
  mainPartnerSlotIds,
  groupComplete
} from "./js/module333.js";
import {
  encryptBackup,
  decryptDownloadedFiles,
  sha256hex,
  backupCounts,
  passphraseStrength,
  validateBackupEnvelope
} from "./js/backup.js";
import { validateMethodPack, shouldUpgradeGenericPack } from "./js/method-pack.js";
import { canEnableOnlineStt, auditSttEnable, createBrowserStt, sttMayStart } from "./js/speech.js";
import { APP_VERSION, DEFAULT_SCORING, CONDITION_KEYS, CONDITION_LABELS, FIELD_LABELS } from "./js/defaults.js";
import { el, mount } from "./js/dom.js";
import { applyThresholdChange, parseThresholdNumber, fieldLabel } from "./js/thresholds.js";
import { isFlagOn, SCREEN_BINDINGS } from "./js/fields.js";
import { collectNumericForm, settingsPatchFromForm, scoreLineText, scoreBreakdownText, sheetRowsToCsvText, trustLabel, weekOf, hasOfferFlag, onsiteQuickItems, isRevealed, nextReveal, slotTrialResult, visitFormModel, bannerModel, afterCommand, noticesFromResult, backupDiffSummary, exportDoneMessage, numberHint, propertySelfFitLine, compareRankedText, affordLines, makeVisitDraftSaver, isStaleFieldView, afterReload } from "./js/ui-logic.js";
import { rankEligible } from "./js/rank-eligible.js";
import { applyGatedThresholdChange } from "./js/validate.js";
import { createController } from "./js/controller.js";
import { displayItem, packChecklist } from "./js/items-for-viewing.js";
import { propertyStatus } from "./js/notes-export.js";
import { onboardingModel, TRIAL_ROUTE } from "./js/onboarding.js";
import {
  resolveRoute,
  VISIT_STEPS,
  homeModel,
  propertyRows,
  rowLabel,
  phaseProgress,
  groupByCategory,
  resultSummary,
  currentOpenViewing,
  unfinishedViewing,
  glossTermsIn,
  glossText
} from "./js/ui-flow.js";
import { financeTrust } from "./js/finance-trust.js";
import { stagesInfo, normalizeCoach, currentStageOf, nextStepOf, stageProgress, parseLink, stepsForVisitStep, localDate, stageMinutes, visitStepMinutes, timerView } from "./js/coach.js";
import { routeStations, resolveStations, stationIndexForItem, stationItems, stationImpact, responseKeyOf, answered, optionsOf, isProblemValue, missingItems, missingLine, prefillOrigins, prefillFor, unassignedOnsite, CATCH_ALL_KEY } from "./js/sites.js";
import { priceLogFor, priceLogLine, PRICE_LOG_KINDS } from "./js/price-log.js";

const $ = (sel) => document.querySelector(sel);
const appEl = $("#app");
const bannerEl = $("#topBanner");
const interruptEl = $("#interrupt");

const ctrl = createController({ db });
const ui = {
  httpsLive: false,
  reveal: { scope: null, key: null }, // 私密數字揭露狀態：綁定對象（範圍與物件代號），不是全域旗標
  lastPage: null,
  notices: [], // 通知佇列：重繪不會洗掉，下一次成功操作才清除（非常駐的）
  recording: false,
  recChunks: 0,
  loanSelfAssess: false,
  aboutPhrase: "以內",
  selectedAffId: null,
  askingStretch: false,
  notesChoices: {}, // 匯入預覽裡「保留手機的／改用筆記的」選擇：鍵是「物件代號|欄位」
  visit: { step: 1, viewingId: null, selectedId: null, confirmSkip: false, confirmSave: false, removeAsk: null, editPost: false, resultFor: null }, // 看一間的進行狀態（只在這次開著的畫面裡）
  prefillOff: new Set(), // 看房前「已幫你填好」按了「不對」的題目（看房代號加題目代號），這次開著的畫面裡不再帶入
  timer: null, // 階段頁的計時器 { key, startedAt }（只在本機計時，不連網）
  timerHandle: null,
  stationMsg: "", // 「這站都正常」之後要顯示的一句話
  installEvent: null, // 瀏覽器送來的「可以安裝」事件（beforeinstallprompt）；沒有就只顯示文字做法
  coachArrival: null, // 按首頁「照著做」進階段頁時，要展開「怎麼做」的步驟代號（只用一次）
  focusAfterRender: null, // 換頁後要把游標放到哪個輸入框（首頁紅色提示用）
  lastHash: null, // 上一次畫的網址：網址換了（換頁或換步驟）就把畫面捲回最上面
  scrollTop: false, // 同一個網址但內容整個換掉（例如存檔後出現結果卡）時，要求捲回最上面
  tabNotice: "",
  _recStopExpected: false
};
let pendingBackupFiles = null;
let lastImportFiles = []; // 匯入預覽解鎖或遮住時，要用同一批檔案重畫預覽
let state = ctrl.getState();
function refreshState() {
  state = ctrl.getState();
}

async function runCommand(work, { keepNotices = false } = {}) {
  try {
    const r = await work();
    refreshState();
    if (typeof ctrl.getLoadStatus === "function" && ctrl.getLoadStatus() === "failed") {
      showLockScreen({ error: r?.error });
      return r;
    }
    if (r && r.ok === false) {
      if (r.code === "STALE" || r.persistFailed) {
        render(); // 控制器已重新讀取，畫面要跟著換成磁碟上的內容
      }
      showError(r.error || r.message || r.code || "操作失敗");
    } else if (r && r.ok !== false) {
      ui.tabNotice = "";
      if (!keepNotices) ui.notices = afterCommand(ui.notices, r); // 背景自動存草稿不算使用者操作，不清通知
      for (const n of noticesFromResult(r)) pushNotice(n.level, n.text);
      announceCommitted();
    }
    return r;
  } catch (e) {
    showError(e.message || String(e));
    return { ok: false, error: e.message || String(e) };
  }
}

let schema = null;
let rec = { media: null, wake: null, stream: null, stt: null, boundViewingId: null };
let sttGen = 0; // 線上轉文字的啟動世代：停止、取消同意、換看房都加一，等待中的啟動就作廢（F9-09）
let visitDraftSaver = null; // 目前門市頁的草稿存檔器（F9-07）

/**
 * 把一組輸入框的原文交給單一解析入口。有任何一格不是數字就整次不存、顯示是哪一格，
 * 輸入框內容原樣保留（不重繪）；空白送 null（清空），0 是合法值。
 * kinds 指定哪些格是金額：{ 欄位鍵: "wan"（萬元，可寫 1500萬）或 "yuan"（元，可寫 1萬、3千） }，沒列的格只收純數字，寫了單位字會被擋。
 */
function readNumbers(fields, labels = {}, kinds = {}) {
  const r = collectNumericForm(fields, labels, kinds);
  if (!r.ok) showError(r.errors.map((e) => e.message).join("；"));
  return r;
}

/** 其他分頁可能開著：每次成功存檔後廣播一則訊息（沒有這個介面的瀏覽器略過，靠控制器的修訂號保護）。 */
let tabChannel = null;
function announceCommitted() {
  try {
    tabChannel?.postMessage({ type: "committed" });
  } catch {
    /* 廣播失敗不影響存檔 */
  }
}

function formIsBeingEdited() {
  const a = document.activeElement;
  return !!a && appEl.contains(a) && ["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName);
}

function startTabSync() {
  if (tabChannel || typeof BroadcastChannel === "undefined") return;
  tabChannel = new BroadcastChannel("house-app");
  tabChannel.onmessage = async () => {
    if (formIsBeingEdited()) {
      ui.tabNotice = "資料已在另一個分頁更新。完成目前輸入後，請重新整理再繼續。";
      showBanner();
      return;
    }
    try {
      await ctrl.reload();
    } catch (err) {
      showLockScreen({ error: err?.message || String(err) });
      return;
    }
    refreshState();
    // 重新讀取失敗就顯示鎖定畫面，不要拿過期的資料繼續畫（F9-19）
    if (afterReload(typeof ctrl.getLoadStatus === "function" ? ctrl.getLoadStatus() : "loaded") === "lock") {
      showLockScreen({ error: "另一個分頁更新資料後，重新讀取失敗" });
      return;
    }
    ui.tabNotice = "資料已在另一個分頁更新";
    render();
  };
}

function showLockScreen(loaded) {
  const vl = document.getElementById("versionLine");
  if (vl) vl.textContent = `app-v${APP_VERSION} · 資料只存在這支手機`;
  showError(`讀取資料失敗：${loaded?.error || "未知錯誤"}。已鎖定寫入。`);
  mount(appEl, [
    el("section", { class: "card" }, [
      el("h2", { text: "資料讀取失敗，已鎖定" }),
      el("p", { text: loaded?.error || "請重試。未載入通用方法包，也未寫入空白狀態。" }),
      el("button", {
        type: "button",
        class: "primary",
        text: "重試",
        onclick: () => boot()
      })
    ])
  ]);
}

let noticeSeq = 0;

/** 把一則通知放進佇列並重畫橫幅；同一句話不重複堆疊。 */
function pushNotice(level, text, sticky = false) {
  const t = String(text ?? "").trim();
  if (!t) return;
  if (!ui.notices.some((n) => n.text === t && n.level === level)) {
    noticeSeq += 1;
    ui.notices.push({ id: noticeSeq, level, text: t, sticky });
  }
  showBanner();
}

function showError(msg) {
  pushNotice("error", msg);
}

function showWarn(msg) {
  pushNotice("warn", msg);
}

async function loadGeneric({ quiet = false } = {}) {
  try {
    const res = await fetch("./methods/generic/method.json");
    if (!res.ok) throw new Error("無法載入通用方法包");
    return await res.json();
  } catch (err) {
    if (!quiet) showError(`方法包載入失敗：${err.message || err}，仍可繼續使用已存資料`);
    return null;
  }
}

function liveHttps() {
  return location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

async function boot() {
  ui.httpsLive = liveHttps();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").then((reg) => {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
      }
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        nw?.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            const btn = el("button", { type: "button", text: "更新並重新載入" });
            btn.onclick = () => {
              nw.postMessage("skipWaiting");
              if (reg.waiting) reg.waiting.postMessage("skipWaiting");
            };
            bannerEl.className = "banner";
            bannerEl.textContent = "有新版本。";
            bannerEl.appendChild(btn);
            bannerEl.classList.remove("hidden");
          }
        });
      });
    }).catch(() => {});
  }
  try {
    schema = await loadImportSchema();
    setImportSchema(schema);
  } catch (err) {
    showError(`匯入規格載入失敗：${err.message || err}`);
    schema = null;
  }
  const loaded = await ctrl.load();
  refreshState();
  if (typeof ctrl.getLoadStatus === "function" && ctrl.getLoadStatus() === "failed") {
    showLockScreen(loaded);
    return;
  }
  startTabSync();
  ui.reveal = nextReveal(ui.reveal, { type: "page" });
  ui.httpsLive = liveHttps();
  ui.recording = false;
  const vl = document.getElementById("versionLine");
  if (vl) vl.textContent = `app-v${APP_VERSION} · 資料只存在這支手機`;
  if (!state.methodPack) {
    const pack = await loadGeneric();
    if (pack) {
      await runCommand(() => ctrl.loadMethodPack(pack));
    }
  } else {
    // App 更新後通用方法包可能升版（第 12 輪多了區域功課三項）：手機上存的若是舊版通用方法包就換成新版。
    // 使用者自己匯入的方法包不動；已經看過的紀錄用自己存的清單快照，不受影響
    const shipped = await loadGeneric({ quiet: true });
    if (shipped && shouldUpgradeGenericPack(state.methodPack, shipped)) {
      await runCommand(() => ctrl.loadMethodPack(shipped));
    }
  }
  // 瀏覽器說「可以安裝」時留著那個事件，上手卡才出現「安裝到主畫面」按鈕；iPhone 沒有這個事件，只顯示文字做法
  window.addEventListener("beforeinstallprompt", (ev) => {
    try {
      ev.preventDefault?.();
    } catch {
      // 忽略
    }
    ui.installEvent = ev;
    if ((location.hash || "#home") === "#home") render();
  });
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("hashchange", render);
  render();
}

async function onVisibility() {
  if (document.hidden) visitDraftSaver?.flushPending(); // 切到背景前，還在等待的門市草稿先送出（F9-07）
  if (document.hidden && ui.reveal?.scope) {
    ui.reveal = nextReveal(ui.reveal, { type: "hide" }); // 頁面隱藏（切到別的 App）時收起私密數字
    render();
  }
  if (ui.recording && document.hidden) {
    interruptEl.classList.remove("hidden");
    if (navigator.vibrate) navigator.vibrate(200);
  }
  if (ui.recording && document.visibilityState === "visible") {
    try {
      rec.wake = await navigator.wakeLock?.request("screen");
    } catch {
      /* ignore */
    }
  }
}


function capBlank() {
  const p = parseThresholdNumber(state.finance.budget_cap_total);
  return p.blank;
}

function currentWeek() {
  return weekOf(state.settings.program_start, new Date());
}

function showBanner() {
  const msgs = [];
  let standingDanger = false;
  try {
    // 常駐訊息每次重繪重新算；啟動很早期 state 還沒準備好時略過
    const blank = capBlank();
    // F-R14-14：首頁已經有可以直接點的紅卡，頂端紅條就不再重複講一次；其他頁照舊保留
    const onHome = currentRoute().page === "home";
    if (blank && !onHome) msgs.push("上限待填：請在設定裡由本人手打可承受總價上限。");
    const visRed = state.visits.some((v) => vis17RedFlag(v).red);
    if (visRed) msgs.push("紅旗：已簽文件含服務費或排除他店條款。");
    if (!ui.httpsLive) msgs.push("目前不是 https，W0「計畫開跑」不能勾。本機開發除外。");
    if (state.cooling?.until) {
      msgs.push(`冷靜期至 ${state.cooling.until}，欄位 ${fieldLabel(state.cooling.field)}。`);
    }
    if (ui.tabNotice) msgs.push(ui.tabNotice);
    standingDanger = !!((blank && !onHome) || visRed);
  } catch {
    /* 啟動早期 */
  }
  const model = bannerModel({ standing: msgs, notices: ui.notices });
  bannerEl.className = "banner" + (standingDanger || model.hasDanger ? " danger" : "");
  bannerEl.textContent = "";
  for (const item of model.items) {
    const row = el("span", { class: "banner-item" }, [`${item.text} `]);
    if (item.level !== "standing") {
      const close = el("button", { type: "button", class: "banner-close", text: "×", "aria-label": "關閉這則提示" });
      close.onclick = () => {
        ui.notices = ui.notices.filter((n) => n.id !== item.id);
        showBanner();
      };
      row.appendChild(close);
    }
    bannerEl.appendChild(row);
  }
  bannerEl.classList.toggle("hidden", model.hidden);
}

function currentRoute() {
  return resolveRoute(location.hash || "#home", { hasCurrentViewing: Boolean(currentOpenViewing(state)) });
}

function nav() {
  const route = currentRoute();
  document.querySelectorAll(".nav a").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("href") === `#${route.navPage || route.page}`);
  });
}

/**
 * 專有名詞的白話解釋（U5）：頁面上出現「待核」「一票否決」「延伸帶」時，在頁首加一行小字說明它是什麼意思。
 * 白話：第一次看到這些詞的人不知道它們在說什麼，所以每一頁只要用到，就先用一句話講清楚。
 */
function annotateGlossary() {
  if (!appEl) return;
  const prev = appEl.querySelector(".gloss");
  prev?.remove();
  const terms = glossTermsIn(appEl.textContent);
  if (!terms.length) return;
  const note = el("p", { class: "hint gloss", text: `名詞小提醒：${terms.map((t) => glossText(t)).join("；")}` });
  if (appEl.firstChild) appEl.insertBefore(note, appEl.firstChild);
  else appEl.appendChild(note);
}

function render() {
  visitDraftSaver?.flushPending(); // 換頁前，還在等待的門市草稿先送出（F9-07）
  refreshState();
  const route = currentRoute();
  // 舊網址（#import、#field、#agency、#compare、#aff）與不認得的網址：換成新位置，不留歷史，一定有頁面可以畫
  if (route.redirected && location.hash && location.hash !== route.canonical) {
    try {
      history.replaceState(null, "", route.canonical);
    } catch {
      /* 換網址失敗仍然照新位置畫 */
    }
  }
  nav();
  showBanner();
  const page = route.page;
  // 換頁一律收起私密數字
  if (ui.lastPage !== null && ui.lastPage !== page) ui.reveal = nextReveal(ui.reveal, { type: "tab" });
  ui.lastPage = page;
  const map = {
    home: pageHome,
    visit: () => pageVisit(route),
    property: () => pageProperty(route),
    more: () => pageMoreRoute(route),
    coach: () => pageCoach(route),
    price_log: () => pagePriceLog(route)
  };
  // 換頁或換步驟就從最上面開始看（手機上上一頁捲到哪，新的一頁不該停在半途）；只是答了一題而重畫時不動
  const hashNow = location.hash || "#home";
  const moved = ui.lastHash !== null && ui.lastHash !== hashNow;
  ui.lastHash = hashNow;
  const wantTop = moved || ui.scrollTop;
  ui.scrollTop = false;
  if (moved) {
    ui.visit.confirmSkip = false; // 離開再回來不要直接跳出「還差幾項」的確認
    ui.visit.confirmSave = false;
    ui.visit.removeAsk = null;
  }
  if (ui.timerHandle) {
    clearInterval(ui.timerHandle);
    ui.timerHandle = null;
  }
  (map[page] || pageHome)();
  annotateGlossary();
  document.body?.classList.toggle("has-stepbar", Boolean($("#stepbar")));
  if (ui.focusAfterRender) {
    const target = document.getElementById(ui.focusAfterRender);
    ui.focusAfterRender = null;
    // 題目如果收在摺疊區裡，先把摺疊區打開才看得到
    for (let n = target?.parentElement; n; n = n.parentElement) if (n.tagName === "DETAILS") n.open = true;
    if (target && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1"); // 一般區塊要有 tabindex 才接得住游標
    target?.classList?.add("focus-hit"); // 標亮：讓人看得出是被帶到的那一題
    target?.focus();
    target?.scrollIntoView?.({ block: "center" });
  } else if (wantTop && typeof globalThis.scrollTo === "function") {
    globalThis.scrollTo(0, 0);
  }
}

function mask(v, scope = "home", key = null) {
  if (v === undefined || v === null || v === "") return "（未填）";
  return isRevealed(ui.reveal, scope, key) ? String(v) : "••••";
}

function bindLongPress(node, fn, ms = 600) {
  let timer = null;
  let didLong = false; // 抑制點擊的旗標只屬於這個元素，不是全域
  let origin = null;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    origin = null;
  };
  const start = (e) => {
    origin = { x: e?.clientX ?? 0, y: e?.clientY ?? 0 };
    timer = setTimeout(() => {
      timer = null;
      didLong = true;
      fn();
    }, ms);
  };
  const move = (e) => {
    if (!timer || !origin) return;
    // 手指滑開超過 10 像素就取消，不揭露
    if (Math.hypot((e.clientX ?? 0) - origin.x, (e.clientY ?? 0) - origin.y) > 10) cancel();
  };
  node.addEventListener("pointerdown", start);
  node.addEventListener("pointerup", cancel);
  node.addEventListener("pointerleave", cancel);
  node.addEventListener("pointercancel", cancel); // 系統取消觸控（例如手指滑出或來電）
  node.addEventListener("pointermove", move);
  node.addEventListener("click", (e) => {
    if (didLong) {
      e.preventDefault();
      e.stopImmediatePropagation();
      didLong = false;
    }
  });
}

function selectedProperty() {
  const id = state.currentViewingId
    ? state.viewings.find((v) => v.id === state.currentViewingId)?.property_id
    : ui.selectedAffId || state.properties[0]?.id;
  return state.properties.find((p) => p.id === id) || null;
}

function viewingPicker(onChange) {
  const sel = el("select", { id: "viewingPick" }, [
    el("option", { value: "", text: "選擇已存看房" }),
    ...state.viewings.map((v) => {
      const p = state.properties.find((x) => x.id === v.property_id);
      return el("option", {
        value: v.id,
        text: `${p?.id || v.property_id}（${v.kind || "初看"}）`,
        selected: v.id === state.currentViewingId
      });
    })
  ]);
  sel.onchange = async () => {
    if (!sel.value) return;
    sel.disabled = true; // 等「選定這間」存完才重繪，期間不能再選（F9-08）
    sttGen += 1;
    ctrl.stopSpeechAndConsent();
    try {
      rec.stt?.rec?.stop?.();
    } catch {
      /* ignore */
    }
    rec.stt = null;
    const r = await runCommand(() => ctrl.selectViewing(sel.value));
    sel.disabled = false;
    if (!r?.ok) return;
    onChange?.();
  };
  return sel;
}

function issueHref(issue) {
  if (issue.table === "finance" || issue.table === "settings" || issue.table === "profile" || issue.table === "scoring") return "#more/settings";
  if (issue.table === "areas" || issue.table === "agents" || issue.table === "travel") return "#more/import";
  if (issue.table === "visits") return "#more/agency";
  return "#property";
}

function backLink(href = "#more", text = "← 回「更多」") {
  return el("p", {}, [el("a", { href, class: "back-link", text })]);
}

/** 開始看一間：有看到一半的就接著看，沒有就開新的（看過的物件開複看，複看不算新的一間）。 */
async function beginViewing(propertyId) {
  const open = unfinishedViewing(state, propertyId);
  const r = open
    ? await runCommand(() => ctrl.selectViewing(open.id))
    : await runCommand(() => ctrl.addViewing(propertyId, state.viewings.some((v) => v.property_id === propertyId) ? "複看" : "初看"));
  if (!r?.ok) return r;
  ui.visit = { ...ui.visit, step: 2, selectedId: propertyId, confirmSkip: false, editPost: false, resultFor: null };
  location.hash = "#visit/2";
  return r;
}

// ---------------------------------------------------------------------------
// 第 15 輪 F-R15-11、F-R15-12：「開始使用」上手卡（首頁）與「上手步驟」頁（更多）共用同一個判斷（onboardingModel）
// ---------------------------------------------------------------------------

/** 是不是從主畫面開啟的（兩種判斷都不存在時當沒有，不得出錯）。 */
function isStandaloneNow() {
  try {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) return true;
  } catch {
    // 不支援就當沒有
  }
  try {
    return typeof navigator !== "undefined" && navigator.standalone === true;
  } catch {
    return false;
  }
}

function onboardingNow() {
  return onboardingModel(state, { standalone: isStandaloneNow(), canInstall: Boolean(ui.installEvent) });
}

async function setOnboarding(flag, value = true) {
  const r = await runCommand(() => ctrl.setOnboardingFlag(flag, value), { keepNotices: true });
  if (r?.ok) render();
  return r;
}

/** 上手步驟的清單；full 為真是「更多」裡的完整頁（每一步都展開），否則是首頁的精簡卡（只有目前這步展開）。 */
function onboardingSteps(m, { full }) {
  return m.steps.map((st) => {
    const open = full || st.current;
    const mark = st.done ? "✓" : st.current ? "▶" : "○";
    const stateName = st.done ? "done" : st.current ? "current" : "todo";
    const kids = [
      el("p", { class: "onb-line" }, [
        el("span", { class: "onb-mark", text: mark }),
        el("strong", { class: "onb-title", text: `${st.n}. ${st.title}` }),
        el("span", { class: "tag", text: st.done ? "已完成" : st.current ? "目前這步" : "還沒到" })
      ])
    ];
    if (!st.done) {
      const btns = [];
      if (open) kids.push(el("p", { class: "hint onb-how", text: st.how }));
      if (st.id === "pwa") {
        if (m.canInstall) {
          const b = el("button", { type: "button", class: "primary", id: "onbInstall", text: "安裝到主畫面" });
          b.onclick = async () => {
            const ev = ui.installEvent;
            if (!ev || typeof ev.prompt !== "function") return;
            ui.installEvent = null;
            try {
              await ev.prompt();
            } catch {
              // 使用者關掉視窗也不算錯
            }
            render();
          };
          btns.push(b);
        }
        const done = el("button", { type: "button", id: "onbPwaDone", text: "我已經加好了" });
        done.onclick = () => setOnboarding("pwa_done");
        btns.push(done);
      } else if (st.id === "import" || st.id === "pack") {
        const go = el("button", { type: "button", class: st.current ? "primary" : "", "data-onb-go": st.id, text: "去「從筆記匯入」" });
        go.onclick = () => {
          location.hash = "#more/import";
        };
        btns.push(go);
        if (st.id === "pack") {
          const builtin = el("button", { type: "button", id: "onbBuiltin", text: "先用內建通用版" });
          builtin.onclick = () => setOnboarding("builtin_pack");
          btns.push(builtin);
        }
      } else if (st.id === "cap") {
        const go = el("button", { type: "button", class: st.current ? "primary" : "", id: "onbCap", text: "去填可承受上限" });
        go.onclick = () => {
          ui.focusAfterRender = "b01";
          location.hash = "#more/settings";
        };
        btns.push(go);
      } else if (st.id === "trial") {
        const go = el("button", { type: "button", class: st.current ? "primary" : "", id: "onbTrialGo", text: "照著做" });
        go.onclick = () => {
          location.hash = "#coach/1";
        };
        const tried = el("button", { type: "button", id: "onbTried", text: "我試過了" });
        tried.onclick = () => setOnboarding("tried");
        btns.push(go, tried);
      }
      if (open) kids.push(el("div", { class: "row onb-actions" }, btns));
      else if (btns.length) kids.push(el("div", { class: "row onb-actions" }, btns));
      if (st.id === "trial" && open) {
        kids.push(el("details", { class: "fold", id: "onbTrial", open: true }, [el("summary", { text: "試走路線" }), el("ol", { class: "onb-route" }, TRIAL_ROUTE.map((t) => el("li", { text: t })))]));
      }
    }
    return el("div", { class: `onb-step ${stateName}${st.current ? "" : " dim"}`, "data-onb": st.id, "data-state": stateName }, kids);
  });
}

/** 首頁最上面的上手卡：5 步各有狀態與按鈕，5 步都完成變成一行「上手完成」加「收起」，任何時候都可以「先收起來」。 */
function onboardingCard(m) {
  if (m.allDone) {
    const collapse = el("button", { type: "button", id: "onbCollapse", text: "收起" });
    collapse.onclick = () => setOnboarding("collapsed");
    return el("div", { class: "card onboarding-card", id: "onboardingCard" }, [el("p", { class: "onb-done", id: "onbTitle", text: m.title }), collapse]);
  }
  const collapse = el("button", { type: "button", id: "onbCollapse", text: "先收起來" });
  collapse.onclick = () => setOnboarding("collapsed");
  const more = el("a", { class: "hint", href: "#more/start", text: "看完整步驟" });
  return el("div", { class: "card onboarding-card", id: "onboardingCard" }, [
    el("h2", { id: "onbTitle", text: m.title }),
    ...onboardingSteps(m, { full: false }),
    el("div", { class: "row" }, [collapse, more])
  ]);
}

/** 「更多」→「上手步驟」：完整 5 步（同上手卡的自動狀態）加試走路線全文；收起來的卡可以在這裡放回首頁。 */
function moreStart() {
  const m = onboardingNow();
  const back = el("button", { type: "button", id: "onbRestore", text: "放回首頁" });
  back.onclick = () => setOnboarding("collapsed", false);
  mount(appEl, [
    el("div", { class: "card", id: "startPage" }, [
      el("h2", { text: "上手步驟" }),
      el("p", { class: "progress-line", id: "onbTitle", text: m.title }),
      el("p", { class: "hint", text: `已完成 ${m.doneCount}/${m.total} 步。狀態是從手機裡的資料自動看出來的，不用自己記。` }),
      ...onboardingSteps(m, { full: true }),
      el("details", { class: "fold", id: "onbRouteFull", open: true }, [el("summary", { text: "試走路線全文（約 10 分鐘）" }), el("ol", { class: "onb-route" }, TRIAL_ROUTE.map((t) => el("li", { text: t })))]),
      m.collapsed ? back : null
    ])
  ]);
}

function pageHome() {
  const week = currentWeek();
  const model = homeModel(state, { week });
  const issues = typeof ctrl.getLoadIssues === "function" ? ctrl.getLoadIssues() : [];
  const blank = capBlank();
  const vaultBtn = el("button", { type: "button", id: "toggleVault", text: isRevealed(ui.reveal, "home") ? "重新遮住" : "長按顯示" });
  const exportMsg = el("p", { class: "hint", id: "homeExportMsg" });
  const pendingRows = model.pending.map((r) => {
    const b = el("button", { type: "button", class: "prop-row", "data-property": r.id }, [
      el("strong", { text: rowLabel(r) }),
      el("span", { class: "meta", text: [r.area, r.status, r.plannedDate ? `預計 ${r.plannedDate}` : ""].filter(Boolean).join("　") })
    ]);
    b.onclick = () => beginViewing(r.id);
    return b;
  });
  const coach = model.coach?.enabled ? model.coach : null;
  const onb = onboardingNow();
  // 上手卡還在的時候，「可承受上限還沒填」紅卡不同時出現（上手卡第 4 步已經有按鈕）；上手卡收起後紅卡規則照舊
  mount(appEl, [
    onb.visibleOnHome ? onboardingCard(onb) : null,
    blank && !onb.visibleOnHome ? el("button", { type: "button", id: "capAlert", class: "alert-link", text: "可承受上限還沒填：點這裡直接去填（只有你自己看得到）" }) : null,
    // 口袋大叔：你現在在第幾階段、下一步做什麼、這間還要大約幾分鐘；R12 的三個大按鈕保留在下方
    coach
      ? el("div", { class: "card coach-card", id: "coachCard" }, [
          el("h2", { text: "口袋大叔" }),
          el("p", { class: "progress-line", id: "coachStage", text: coach.stageLine }),
          el("p", { id: "coachNext", text: coach.nextLine }),
          el("p", { class: "progress-line", id: "coachMinutes", text: coach.minutesLine }),
          el("p", { class: "hint small", id: "coachAllMinutes", text: coach.allMinutesLine }),
          el("button", { type: "button", class: "big-btn primary", id: "coachGo", text: coach.buttonLabel })
        ])
      : null,
    issues.length
      ? el("div", { class: "card", id: "loadIssues" }, [
          el("h2", { class: "danger-text", text: `有 ${issues.length} 項資料需要修正` }),
          el("p", { class: "hint", text: "這些是舊資料裡不合目前規則的地方。不影響你繼續記錄，但修正後計算才會準。" }),
          ...issues.map((i) => el("p", {}, [`${i.message}　`, el("a", { href: issueHref(i), text: "去修正" })]))
        ])
      : null,
    el("div", { class: "card" }, [
      el("h2", { text: "今天要做什麼" }),
      el("button", { type: "button", class: "big-btn", id: "homeImport", text: model.importLabel }),
      el("button", { type: "button", class: coach ? "big-btn" : "big-btn primary", id: "homeVisit", text: model.visitLabel }), // 有教練卡時，「照著做」是首頁唯一的主要按鈕
      el("button", { type: "button", class: "big-btn", id: "homeExport", text: model.exportLabel }),
      exportMsg
    ]),
    el("div", { class: "card" }, [el("p", { class: "progress-line", id: "progressLine", text: model.progressLine })]),
    el("div", { class: "card", id: "pendingList" }, [
      el("h2", { text: "待看物件" }),
      ...(pendingRows.length
        ? pendingRows
        : [el("p", { class: "hint", text: "目前沒有待看物件。按上面的「從筆記匯入」把筆記裡的待看物件帶進來，或到「看房」新增一間。" })])
    ]),
    el("div", { class: "card" }, [
      el("h2", { text: "今日注意" }),
      el("p", { text: "App 不送出任何訊息、出價或付款。草稿請你自己複製去送。" }),
      el("p", { text: "唯一對外連線：你手動打開的線上即時轉文字。" })
    ]),
    el("div", { class: "card", id: "vaultCard" }, [
      el("h2", { text: "私密區" }),
      el("p", {}, [
        "可承受上限（萬）：",
        el("span", { class: isRevealed(ui.reveal, "home") ? "" : "mask", text: mask(state.finance.budget_cap_total, "home") }),
        financeTrust(state.finance, state.finance_meta) === "unverified" ? ` ${trustLabel("unverified")}` : ""
      ]),
      el("p", { class: "hint", text: "畫面預設遮住。不進摘要與草稿。請長按才顯示。" }),
      vaultBtn
    ])
  ]);
  $("#capAlert")?.addEventListener("click", () => {
    ui.focusAfterRender = "b01";
    location.hash = "#more/settings";
  });
  $("#coachGo")?.addEventListener("click", () => {
    // F-R14-12：進到階段頁就直接捲到並標亮第一個沒做的必要步驟（畫面上看得到「怎麼做」與按鈕）
    if (coach.next) {
      ui.focusAfterRender = `step-${coach.next.id}`;
      ui.coachArrival = coach.next.id; // 這一次進來是按「照著做」：那一步的「怎麼做」直接展開
    }
    if (location.hash === coach.href) render();
    else location.hash = coach.href;
  });
  $("#homeImport").onclick = () => {
    location.hash = "#more/import";
  };
  $("#homeVisit").onclick = () => {
    location.hash = "#visit";
  };
  $("#homeExport").onclick = async () => {
    const r = await exportToNotes();
    exportMsg.textContent = r.message;
  };
  bindLongPress(vaultBtn, () => {
    ui.reveal = nextReveal(ui.reveal, { type: "reveal", scope: "home" });
    render();
  });
  vaultBtn.onclick = () => {
    if (isRevealed(ui.reveal, "home")) {
      ui.reveal = nextReveal(ui.reveal, { type: "conceal" });
      render();
    }
  };
}

// ---------------------------------------------------------------------------
// 看一間（U3）：1 選物件、2 看房前、3 現場、4 看房後
// ---------------------------------------------------------------------------

function visitStepsBar(step, cur) {
  const kids = [];
  VISIT_STEPS.forEach((s, idx) => {
    if (idx > 0) kids.push(el("span", { class: "arrow", text: " → " }));
    const label = `${s.n} ${s.label}`;
    const cls = `step${s.n === step ? " current" : s.n < step ? " done" : ""}`;
    kids.push(
      s.n === 1 || cur
        ? el("a", { class: cls, href: `#visit/${s.n}`, "data-step": s.n, text: label })
        : el("span", { class: cls, "data-step": s.n, text: label })
    );
  });
  return el("div", { class: "steps", id: "visitSteps" }, kids);
}

function stepBar(buttons, { confirming = false } = {}) {
  return el("div", { id: "stepbar", class: confirming ? "stepbar confirming" : "stepbar" }, buttons);
}

function pageVisit(route) {
  const cur = state.viewings.find((v) => v.id === state.currentViewingId) || null;
  const open = currentOpenViewing(state);
  let step = route.step;
  if (!step) {
    step = open ? (ui.visit.viewingId === open.id && ui.visit.step > 1 ? ui.visit.step : 2) : 1;
    if (!open && cur && ui.visit.resultFor === cur.id) step = 4;
  }
  if (step > 1 && !cur) step = 1;
  ui.visit.step = step;
  ui.visit.viewingId = cur?.id || null;
  if (cur) ui.fieldViewingId = cur.id;
  const built = step === 1 ? visitSelectStep() : step === 2 ? visitPrepStep(cur) : step === 3 ? visitOnsiteStep(cur, route) : visitPostStep(cur);
  mount(appEl, [visitStepsBar(step, cur), ...built.nodes, built.bar]);
  built.after?.();
}

function visitSelectStep() {
  const rows = propertyRows(state);
  const isWaiting = (r) => r.status === "待看" || r.status === "已約";
  const waiting = rows.filter(isWaiting);
  const others = rows.filter((r) => !isWaiting(r));
  const open = currentOpenViewing(state);
  const startBtn = el("button", { type: "button", class: "primary", id: "startViewing", text: "開始看這間", disabled: !ui.visit.selectedId });
  const rowNode = (r) => {
    const b = el("button", { type: "button", class: `prop-row${ui.visit.selectedId === r.id ? " on" : ""}`, "data-property": r.id }, [
      el("strong", { text: rowLabel(r) }),
      el("span", { class: "meta", text: [r.area, r.status, r.plannedDate ? `預計 ${r.plannedDate}` : ""].filter(Boolean).join("　") })
    ]);
    b.onclick = () => {
      ui.visit.selectedId = r.id;
      document.querySelectorAll(".prop-row[data-property]").forEach((n) => n.classList.toggle("on", n.dataset.property === r.id));
      startBtn.disabled = false;
    };
    return b;
  };
  const addCard = el("details", { class: "fold", id: "addFold" }, [
    el("summary", { text: "新增一間（只要物件代號與區域代號）" }),
    input("vCode", "物件代號", { placeholder: "例如 A01，不要寫門牌" }),
    input("vArea", "區域代號", { placeholder: "AA01" }),
    el("button", { type: "button", id: "vAdd", text: "新增到待看清單" }),
    el("p", { class: "hint", text: "其他資料之後在「物件」頁補，或現場再填。" })
  ]);
  const nodes = [
    el("div", { class: "card" }, [
      el("h2", { text: "選一間要看的物件" }),
      open
        ? el("p", {}, [`進行中的看房：${open.property_id}　`, el("button", { type: "button", id: "resumeViewing", text: `繼續看 ${open.property_id}` })])
        : null,
      ...(waiting.length ? waiting.map(rowNode) : [el("p", { class: "hint", text: "還沒有待看物件。可以先從筆記匯入，或在下面新增一間。" })])
    ]),
    others.length
      ? el("details", { class: "fold", id: "othersFold" }, [el("summary", { text: `看過或觀察的物件（${others.length}，要再看一次選這裡）` }), ...others.map(rowNode)])
      : null,
    addCard
  ];
  return {
    nodes,
    bar: stepBar([el("button", { type: "button", id: "stepBack", disabled: true, text: "上一步" }), startBtn]),
    after() {
      startBtn.onclick = async () => {
        if (!ui.visit.selectedId) return;
        await beginViewing(ui.visit.selectedId);
      };
      $("#resumeViewing")?.addEventListener("click", () => {
        location.hash = "#visit/2";
      });
      $("#vAdd").onclick = async () => {
        const id = ($("#vCode").value || "").trim();
        const area = ($("#vArea").value || "").trim();
        if (!id || !area) {
          showError("請填物件代號與區域代號");
          return;
        }
        const r = await runCommand(() => ctrl.addProperty({ id, area_code: area }, { withViewing: false }));
        if (!r?.ok) return;
        ui.visit.selectedId = id;
        render();
      };
    }
  };
}

/** 一題的回答列：有選項的題目用一行大按鈕（點了馬上存），其他題型沿用原本的輸入方式。 */
function choiceRow(i0, viewingId, { onSaved, prefill = null } = {}) {
  const i = displayItem(state, i0);
  const view = () => state.viewings.find((v) => v.id === viewingId);
  const getRec = () => view()?.responses?.[i.id] || {};
  // 選項一律是大按鈕（至少 48 像素高）：方法包有寫選項就用；勾選、拍照、錄音這類沒寫選項的題目用預設的是、否、不適用、待核
  const opts = optionsOf(i);
  const save = async (status, value) => {
    const r = await runCommand(() => ctrl.setChecklistResponse(i.id, { status, value }, viewingId), { keepNotices: true });
    if (r?.ok) onSaved?.();
    return r;
  };
  let row;
  if (opts) {
    const group = el("div", { class: "choices", "data-item": i.id });
    const paint = () => {
      const rec = getRec();
      const selected = rec.value ?? rec.status ?? "";
      group.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.value === selected));
    };
    for (const o of opts) {
      const b = el("button", { type: "button", class: "choice", "data-id": i.id, "data-value": o, text: o });
      b.onclick = async () => {
        const r = await save(o, o);
        if (r?.ok) paint();
      };
      group.appendChild(b);
    }
    paint();
    row = el("div", { class: "check-item stack", id: `item-${i.id}` }, [itemTitle(i, view()), group]);
  } else if (i.phase === "看房後" && i.input_type === "text") {
    const box = el("textarea", { rows: "3", "data-id": i.id, placeholder: "寫下你的想法" });
    box.value = getRec().value ?? "";
    box.onchange = () => save(box.value.trim() ? "是" : "待核", box.value);
    row = el("div", { class: "check-item stack", id: `item-${i.id}` }, [itemTitle(i, view(), false), box]);
  } else {
    row = checklistRow(i, view(), onSaved, { stacked: true });
    row.id = `item-${i.id}`;
  }
  if (!prefill) return row;
  // 第 13 輪 E4：能從匯入資料算出來的題目，先帶入並標「已幫你填好，請確認」。按「對」才算作答；按「不對」就改成可以自己填。
  // 確認之前不會寫進任何答案，也不會被當成已作答計分或計入一間。
  row.removeAttribute("id");
  row.classList.add("hidden");
  const box = el("div", { class: "prefill-box", "data-prefill-box": i.id }, [
    el("p", { class: "prefill-q", text: i.text }), // 先寫是哪一題，不然只看到「請確認」不知道在確認什麼
    el("p", { class: "prefill-title", text: "已幫你填好,請確認" }),
    el("p", { class: "prefill-text", text: prefill.text }),
    el("div", { class: "choices" }, [
      el("button", { type: "button", class: "choice", "data-prefill-yes": i.id, text: "對" }),
      el("button", { type: "button", class: "choice", "data-prefill-no": i.id, text: "不對" })
    ])
  ]);
  const wrap = el("div", { class: "check-item stack prefill-wrap", id: `item-${i.id}` }, [box, row]);
  box.querySelector("[data-prefill-yes]").onclick = async () => {
    const r = await save(prefill.status, prefill.value);
    if (!r?.ok) return;
    box.classList.add("hidden");
    row.classList.remove("hidden");
    const rowGroup = row.querySelector(".choices");
    if (rowGroup) rowGroup.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.value === String(prefill.value)));
  };
  box.querySelector("[data-prefill-no]").onclick = () => {
    ui.prefillOff.add(`${viewingId}|${i.id}`);
    box.classList.add("hidden");
    row.classList.remove("hidden");
  };
  return wrap;
}

function prepLeftText(prog) {
  if (prog.left > 0) return `還差 ${prog.left} 項`;
  return prog.pending > 0 ? `都答了，其中 ${prog.pending} 項待核` : "這一步的必做項目都做完了";
}

/** 看房前與看房後共用：列出該階段的題目，必做的在前面，非必做的收在「其他」。 */
function visitPhaseNodes(cur, phase, title) {
  const prop = state.properties.find((p) => p.id === cur.property_id) || {};
  const items = ctrl.checklistSource(cur).filter((i) => i.phase === phase);
  const core = items.filter((i) => i.core === true);
  const rest = items.filter((i) => i.core !== true);
  // E4：看房前能從匯入資料算出的題目，先帶入並請使用者確認（還沒答、也沒按過「不對」的才帶）
  const origins = prefillOrigins(state.methodPack);
  const area = (state.areas || []).find((a) => a && a.area_code === prop.area_code) || null;
  const prefillOf = (i) => {
    if (phase !== "看房前" || ui.prefillOff.has(`${cur.id}|${i.id}`) || responseValue(cur.responses?.[i.id]).filled) return null;
    return prefillFor(displayItem(state, i), { property: prop, area, origins });
  };
  const minutes = visitStepMinutes(state.methodPack, phase === "看房前" ? 2 : 4);
  const refresh = () => {
    const prog = phaseProgress(state, state.viewings.find((v) => v.id === cur.id), phase);
    const line = $("#prepLeft");
    if (line) line.textContent = prepLeftText(prog);
    if (prog.left === 0) $("#skipConfirm")?.remove();
  };
  const prog = phaseProgress(state, cur, phase);
  const nodes = [
    el("div", { class: "card" }, [
      el("h2", { text: `${prop.id || cur.property_id}　${title}` }),
      minutesNode(minutes, `這一步建議大約 ${minutes} 分鐘`, "stepMinutes"),
      el("p", { class: "progress-line", id: "prepLeft", text: prepLeftText(prog) }),
      ...core.map((i) => choiceRow(i, cur.id, { onSaved: refresh, prefill: prefillOf(i) })),
      rest.length ? el("p", { class: "hint", text: `另有 ${rest.length} 題非必做，想補的話到「物件」點進這間物件的詳細頁。` }) : null
    ])
  ];
  return { nodes, prog };
}

function visitPrepStep(cur) {
  const { nodes, prog } = visitPhaseNodes(cur, "看房前", "看房前功課");
  const next = el("button", { type: "button", class: "primary", id: "stepNext", text: "下一步" });
  // 還差題目時按「下一步」要確認一次。確認放在固定在畫面底部的那一列裡取代原本的按鈕：
  // 放在題目清單最後面的話，手機上按了下一步看起來什麼事都沒發生（確認在好幾個螢幕以外）。
  const confirming = ui.visit.confirmSkip && prog.left > 0;
  // 防漏清單（E5）：還差題目時，頁面最上面列出「還漏這幾項」（點一項直接跳過去補），底部那一列放回去補、先跳過、先跳過並標待核
  if (confirming) nodes.unshift(missingCard(computeMissing(cur, "看房前"), "點一項就跳過去補；不想現在補，可以先跳過並標成待核（還不確定，之後要查）。"));
  const bar = confirming ? skipConfirmBar(prog.left, "先跳過，到現場") : stepBar([el("button", { type: "button", id: "stepBack", text: "上一步" }), next]);
  return {
    nodes,
    bar,
    after() {
      const back = $("#stepBack");
      if (back) {
        back.onclick = () => {
          location.hash = "#visit/1";
        };
      }
      next.onclick = () => {
        const left = phaseProgress(state, state.viewings.find((v) => v.id === cur.id), "看房前").left;
        if (left > 0) {
          ui.visit.confirmSkip = true;
          render();
          return;
        }
        ui.visit.confirmSkip = false;
        location.hash = "#visit/3";
      };
      if (confirming) wireSkipConfirm(cur, "看房前", "#visit/3");
    }
  };
}

/** 掛上拍照、錄音與線上轉文字的按鈕（現場頁與看房第 3 步共用）。viewingId 是這個畫面顯示的那一間看房。 */
function wirePhotoAndRecording(viewingId) {
  wirePhoto(viewingId);
  $("#recBtn").onclick = toggleRec;
  $("#sttBtn").onclick = startStt;
  $("#sttStop").onclick = () => stopStt();
  // 取消勾選「已告知在場的人並取得同意」就停止轉文字（F9-09）
  $("#consent").addEventListener("change", () => {
    if (!$("#consent").checked) stopStt();
  });
}

function onsiteConfirmRow(cur, { key, label, value, inputId, patchKey, kind }) {
  const confirmed = () => state.viewings.find((v) => v.id === cur.id)?.onsite_confirmed?.[key] === true;
  const inp = el("input", { id: inputId, inputmode: "decimal", placeholder: `填${label}` });
  if (value !== undefined && value !== null) inp.value = String(value);
  const ok = el("button", { type: "button", class: "choice", id: `ok-${key}`, "data-confirm": key, text: confirmed() ? "已確認" : "對" });
  const paint = () => {
    ok.classList.toggle("on", confirmed());
    ok.textContent = confirmed() ? "已確認" : "對";
  };
  ok.onclick = async () => {
    if (!inp.value.trim()) {
      showError(`請先填${label}`);
      return;
    }
    const r = await runCommand(() => ctrl.confirmOnsiteFields(cur.id, [key]), { keepNotices: true });
    if (r?.ok) paint();
  };
  inp.onchange = async () => {
    const nums = readNumbers({ [patchKey]: inp.value }, { [patchKey]: label }, kind ? { [patchKey]: kind } : {});
    if (!nums.ok) return;
    const r = await runCommand(() => ctrl.saveFieldInputs(cur.property_id, nums.patch), { keepNotices: true });
    if (!r?.ok) return;
    // 現場親手填的值也算確認過
    const c = await runCommand(() => ctrl.confirmOnsiteFields(cur.id, [key]), { keepNotices: true });
    if (c?.ok) paint();
  };
  return el("div", { class: "check-item stack" }, [el("label", { text: label }, [inp]), ok]);
}

function visitOnsiteStep(cur, route = {}) {
  const prop = state.properties.find((p) => p.id === cur.property_id) || {};
  const items = ctrl.checklistSource(cur).filter((i) => i.phase === "現場").map((i) => displayItem(state, i));
  const core = items.filter((i) => i.core === true);
  const rest = items.filter((i) => i.core !== true);
  // 第 13 輪 E2：方法包有路線站（教練階段裡有 checklist_ids 的步驟）就一站一頁；沒有就沿用第 12 輪的分類收合
  const hiddenIds = normalizeCoach(state.coach).hidden_items;
  const defs = routeStations(state.methodPack, items, hiddenIds);
  if (defs.length && route.station) return visitStationPage(cur, defs, route.station);
  const routed = defs.length > 0;
  const onsiteMissing = ui.visit.confirmSkip ? computeMissing(cur, "現場") : [];
  const viewNow = () => state.viewings.find((v) => v.id === cur.id) || cur;
  const propNow = () => state.properties.find((p) => p.id === cur.property_id) || prop;
  const doneIn = (list) => list.filter((i) => responseValue(viewNow().responses?.[i.id]).filled).length;

  // 先確認開價、登記總坪、車位（帶入的值可直接按「對」）
  const parkingBox = el("div", { class: "stack", id: "parkingBox" });
  const drawParking = () => {
    const p = propNow();
    const has = p.has_parking === true ? "有" : p.has_parking === false ? "無" : "";
    const inAsk = p.parking_included_in_ask === true ? "是" : p.parking_included_in_ask === false ? "否" : "";
    const pick = (field, choices, current, toPatch) => {
      const g = el("div", { class: "choices" });
      for (const c of choices) {
        const b = el("button", { type: "button", class: `choice${current === c ? " on" : ""}`, "data-field": field, "data-value": c, text: c });
        b.onclick = async () => {
          const r = await runCommand(() => ctrl.saveFieldInputs(cur.property_id, toPatch(c)), { keepNotices: true });
          if (r?.ok) drawParking();
        };
        g.appendChild(b);
      }
      return g;
    };
    const kids = [el("p", { class: "hint", text: "車位" }), pick("has_parking", ["有", "無"], has, (c) => ({ has_parking: c === "有" }))];
    if (has === "有") {
      kids.push(
        el("p", { class: "hint", text: "車位是否含在開價" }),
        pick("parking_included_in_ask", ["是", "否"], inAsk, (c) => ({ parking_included_in_ask: c === "是" })),
        input("ppark", "車位開價（萬）", { inputmode: "decimal" }),
        input("pparkping", "車位坪", { inputmode: "decimal" })
      );
    }
    const confirmed = viewNow().onsite_confirmed?.parking === true;
    if (has) {
      const okBtn = el("button", { type: "button", class: `choice${confirmed ? " on" : ""}`, id: "ok-parking", "data-confirm": "parking", text: confirmed ? "已確認" : "對" });
      okBtn.onclick = async () => {
        const r = await runCommand(() => ctrl.confirmOnsiteFields(cur.id, ["parking"]), { keepNotices: true });
        if (r?.ok) drawParking();
      };
      kids.push(el("div", { class: "check-item stack" }, [okBtn])); // 和開價、坪數的「對」一樣寬
    }
    mount(parkingBox, kids);
    if (has === "有") {
      if (p.parking_price_ask != null) $("#ppark").value = String(p.parking_price_ask);
      if (p.parking_ping != null) $("#pparkping").value = String(p.parking_ping);
      const saveParkNums = async () => {
        const nums = readNumbers(
          { parking_price_ask: $("#ppark").value, parking_ping: $("#pparkping").value },
          { parking_price_ask: "車位開價", parking_ping: "車位坪" },
          { parking_price_ask: "wan" }
        );
        if (!nums.ok) return;
        await runCommand(() => ctrl.saveFieldInputs(cur.property_id, nums.patch), { keepNotices: true });
      };
      $("#ppark").onchange = saveParkNums;
      $("#pparkping").onchange = saveParkNums;
    }
  };

  // 屋況 7 類快選：點了馬上存到物件，顯示的是目前採用的結果
  const condGroup = el("div", { class: "stack", id: "condBox" });
  const drawCondition = () => {
    const p = propNow();
    const effective = mergedEvidenceFor(state, p.id).condition || {};
    mount(
      condGroup,
      CONDITION_KEYS.map((k) => {
        const g = el("div", { class: "choices", "data-cond": k });
        for (const c of ["無問題", "輕微", "嚴重", "看不出來"]) {
          const b = el("button", { type: "button", class: `choice${effective[k] === c ? " on" : ""}`, "data-value": c, text: c });
          b.onclick = async () => {
            const r = await runCommand(() => ctrl.saveFieldInputs(cur.property_id, { condition: { ...(propNow().condition || {}), [k]: c } }), { keepNotices: true });
            if (r?.ok) drawCondition();
          };
          g.appendChild(b);
        }
        return el("div", { class: "check-item stack" }, [el("strong", { text: CONDITION_LABELS[k] }), g]);
      })
    );
  };

  const groups = groupByCategory(core);
  const groupNodes = groups.map((g) => {
    const summary = el("summary", { text: `${g.name}（${doneIn(g.items)}/${g.items.length}）` });
    const d = el("details", { class: "fold", "data-category": g.name }, [
      summary,
      ...g.items.map((i) =>
        choiceRow(i, cur.id, {
          onSaved: () => {
            summary.textContent = `${g.name}（${doneIn(g.items)}/${g.items.length}）`;
          }
        })
      )
    ]);
    return d;
  });
  const nodes = [
    el("div", { class: "card" }, [
      el("h2", { text: `${prop.id || cur.property_id}　現場` }),
      minutesNode(visitStepMinutes(state.methodPack, 3), `這一步建議大約 ${visitStepMinutes(state.methodPack, 3)} 分鐘`, "stepMinutes"),
      el("p", { class: "hint", text: "先確認下面帶進來的數字對不對，對就按「對」，不對直接改。" }),
      onsiteConfirmRow(cur, { key: "ask_total", label: "開價（萬）", value: prop.ask_total, inputId: "pask", patchKey: "ask_total", kind: "wan" }),
      onsiteConfirmRow(cur, { key: "ping_total", label: "登記總坪", value: prop.ping_total, inputId: "pping", patchKey: "ping_total" }),
      parkingBox
    ]),
    el("div", { class: "card" }, [el("h2", { text: "屋況 7 類快選" }), condGroup]),
    ...(routed
      ? [
          ...routeOverviewCard(cur, defs),
          el("p", { class: "hint", id: "photoCount", text: `這次已拍 ${(cur.photos || []).length} 張` })
        ]
      : [
          el("div", { class: "card" }, [
            el("h2", { text: `現場必做（${core.length} 項）` }),
            el("p", { class: "hint", id: "photoCount", text: `這次已拍 ${(cur.photos || []).length} 張` }),
            ...groupNodes
          ]),
          rest.length
            ? el("details", { class: "fold" }, [el("summary", { text: `其他（非必做）${rest.length} 題` }), ...rest.map((i) => choiceRow(i, cur.id))])
            : null
        ]),
    el("details", { class: "fold", id: "recBox" }, [
      el("summary", { text: "錄音(選用)" }),
      el("div", { class: "row" }, [el("button", { type: "button", id: "recBtn", text: ui.recording ? "停止錄音" : "開始錄音（每 5 秒存本機）" })]),
      el("p", { class: "hint", text: "已存照片與分片會留在這支手機。線上轉文字預設關。" }),
      el("label", { class: "check-item" }, [el("input", { type: "checkbox", id: "consent" }), " 已告知在場的人並取得同意"]),
      el("div", { class: "row" }, [
        el("button", { type: "button", id: "sttBtn", text: "開啟線上即時轉文字" }),
        el("button", { type: "button", id: "sttStop", text: "停止轉文字" })
      ]),
      el("p", { id: "sttMsg", class: "hint" })
    ]),
    // F-R15-05：沒分到任何一站的現場題，統一放在站台總覽最下面「其他現場題」一區，可直接作答（寫入走原本的 setChecklistResponse）
    ...(routed
      ? [
          (() => {
            const extra = unassignedOnsite(items, defs, hiddenIds);
            return extra.length ? el("details", { class: "fold", id: "extraOnsite" }, [el("summary", { text: `其他現場題（${extra.length} 題）` }), ...extra.map((i) => choiceRow(i, cur.id))]) : null;
          })()
        ]
      : []),
    el("button", { type: "button", class: "fab", id: "photoBtn", text: "拍照" }),
    el("input", { id: "photoFile", type: "file", accept: "image/*", capture: "environment", class: "hidden" })
  ];
  // 防漏清單（E5）：現場必做題還有沒答的，按「下一步」先跳出「還漏這幾項」
  const confirming = !routed && onsiteMissing.length > 0;
  if (confirming) nodes.unshift(missingCard(onsiteMissing, "點一項就跳過去補；不想現在補，可以先跳過並標成待核（還不確定，之後要查）。"));
  return {
    nodes,
    bar: confirming
      ? skipConfirmBar(onsiteMissing.length, "先跳過，到看房後")
      : stepBar([el("button", { type: "button", id: "stepBack", text: "上一步" }), el("button", { type: "button", class: "primary", id: "stepNext", text: routed ? "開始走路線" : "下一步" })]),
    after() {
      drawParking();
      drawCondition();
      wirePhotoAndRecording(cur.id);
      if (confirming) wireSkipConfirm(cur, "現場", "#visit/4");
      $("#stepBack")?.addEventListener("click", () => {
        location.hash = "#visit/2";
      });
      $("#stepNext")?.addEventListener("click", async () => {
        if (routed) {
          // 開始現場：依物件的房數、衛浴數把站建起來（沒有數字就先各建 1 間），再走第一站
          const r = await runCommand(() => ctrl.ensureSites(cur.id), { keepNotices: true });
          if (r?.ok) location.hash = "#visit/3/1";
          return;
        }
        tryLeaveOnsite(cur);
      });
    }
  };
}

function visitResultStep(cur) {
  const live = ctrl.assessProperty(cur.property_id);
  const sum = resultSummary(state, cur, live);
  const msg = el("p", { class: "hint", id: "resultMsg" });
  const nodes = [
    el("div", { class: "card result-card", id: "resultCard" }, [
      el("h2", { text: `${cur.property_id}　這間的結果` }),
      el("p", { class: "progress-line", id: "resultTotal", text: `總分 ${sum.total}` }),
      el("p", { id: "resultParts", text: sum.parts.map(([name, v]) => `${name} ${v}`).join("　") }),
      el("p", { id: "resultCounts", text: sum.reason }),
      el("p", { text: `目前共計入 ${sum.countedTotal} 間` }),
      el("h3", { text: "下一步建議" }),
      el("ul", { id: "resultNext" }, sum.next.map((t) => el("li", { text: t }))),
      el("button", { type: "button", class: "big-btn", id: "resultExport", text: "匯出到筆記" }),
      coachAfterViewingLink() ? el("button", { type: "button", class: "big-btn", id: "resultCoach", text: "回口袋大叔(看房後要做的事)" }) : null,
      el("button", { type: "button", class: "big-btn", id: "resultEdit", text: "回去改答案" }),
      msg
    ])
  ];
  return {
    nodes,
    bar: stepBar([el("button", { type: "button", class: "primary", id: "nextViewing", text: "看下一間" })]),
    after() {
      $("#resultExport").onclick = async () => {
        const r = await exportToNotes();
        msg.textContent = r.message;
      };
      $("#resultCoach")?.addEventListener("click", () => {
        const target = coachAfterViewingLink();
        if (!target) return;
        ui.focusAfterRender = target.focusId;
        location.hash = target.href;
      });
      $("#resultEdit").onclick = () => {
        ui.visit.editPost = true;
        ui.scrollTop = true;
        render();
      };
      $("#nextViewing").onclick = async () => {
        const r = await runCommand(() => ctrl.leaveViewing());
        if (!r?.ok) return;
        ui.visit = { ...ui.visit, step: 1, selectedId: null, resultFor: null, editPost: false, confirmSkip: false };
        location.hash = "#visit/1";
      };
    }
  };
}

function visitPostStep(cur) {
  if (isFlagOn(cur.post_saved) && ui.visit.resultFor === cur.id && !ui.visit.editPost) return visitResultStep(cur);
  const { nodes } = visitPhaseNodes(cur, "看房後", "看房後");
  const save = el("button", { type: "button", class: "primary", id: "savePost", text: "存檔並評分" });
  // 防漏清單（E5）：存檔之前，一定要再列一次整間（看房前、現場、看房後）還漏了哪些
  const missingAll = ui.visit.confirmSave ? computeMissing(cur, "all") : [];
  const confirming = missingAll.length > 0;
  if (confirming) nodes.unshift(missingCard(missingAll, "存檔之前，再看一次整間還漏了哪些；點一項就跳過去補，不想補就先跳過並標成待核（還不確定，之後要查）。"));
  const doSave = async () => {
    const r = await runCommand(() => ctrl.scoreCurrent(cur.id));
    if (!r?.ok) return;
    const prop = state.properties.find((p) => p.id === cur.property_id);
    const drop = priceDropToCapReminder(prop, state.finance);
    if (drop) showError(drop);
    ui.visit.resultFor = cur.id;
    ui.visit.editPost = false;
    ui.visit.confirmSave = false;
    ui.scrollTop = true; // 結果卡在最上面，不要停在剛才長長的題目清單底部
    render();
  };
  return {
    nodes,
    bar: confirming
      ? stepBar(
          [
            el("div", { class: "confirm-bar", id: "saveConfirm" }, [
              el("p", { id: "saveText", text: `整間還漏 ${missingAll.length} 項,存檔之前再確認一次` }),
              el("div", { class: "confirm-actions" }, [
                el("button", { type: "button", id: "saveBack", text: "回去補" }),
                el("button", { type: "button", class: "primary", id: "savePending", text: "先跳過,標待核並存檔" })
              ])
            ])
          ],
          { confirming: true }
        )
      : stepBar([el("button", { type: "button", id: "stepBack", text: "上一步" }), save]),
    after() {
      $("#stepBack")?.addEventListener("click", () => {
        location.hash = "#visit/3";
      });
      $("#saveBack")?.addEventListener("click", () => {
        ui.visit.confirmSave = false;
        render();
      });
      $("#savePending")?.addEventListener("click", async () => {
        const list = computeMissing(cur, "all");
        const r = await runCommand(() => ctrl.markMissingPending(cur.id, list.map((m) => ({ itemId: m.itemId, stationKey: m.stationKey }))));
        if (r?.ok) await doSave();
      });
      save.onclick = async () => {
        if (computeMissing(cur, "all").length) {
          ui.visit.confirmSave = true;
          ui.scrollTop = true;
          render();
          return;
        }
        await doSave();
      };
    }
  };
}

function pageImport() {
  const preview = el("div", { id: "preview" });
  const restoreMsg = el("p", { class: "hint", id: "restoreMsg" });
  const reason = el("input", { id: "restoreReason", placeholder: "調鬆理由" });
  const fileInput = el("input", { id: "file", type: "file", accept: ".json,.csv,.xlsx,application/json", multiple: true, class: "hidden" });
  const pick = el("button", { type: "button", class: "primary", id: "pickNotes", text: "從筆記匯入" });
  mount(appEl, [
    backLink(),
    el("div", { class: "card" }, [
      el("h2", { text: "從筆記匯入" }),
      el("p", { class: "hint", text: "請選雲端硬碟「看房同步」資料夾裡的匯入檔。App 會自動判斷是匯入表（含待看物件）、方法包還是加密備份，確認前會先用白話告訴你會發生什麼事。可承受上限這一格若在檔裡，不會直接寫入，要你自己再打一次。" }),
      pick,
      fileInput,
      preview
    ]),
    el("div", { class: "card" }, [
      el("h2", { text: "還原上一批" }),
      el("label", { text: "理由" }, [reason]),
      el("button", { type: "button", id: "restore", text: "還原" }),
      el("button", { type: "button", id: "startCoolRestore", text: "開始 7 天冷靜期" }),
      restoreMsg,
      state.cooling?.until
        ? el("p", { text: `冷靜期截止：${state.cooling.until}（${fieldLabel(state.cooling.field)}）` })
        : null
    ])
  ]);
  pick.onclick = () => fileInput.click();
  fileInput.onchange = onFile;
  const doRestore = async (startCooling) => {
    const r = await ctrl.restorePreviousBatch({ reason: reason.value, startCooling });
    if (!r.ok) {
      restoreMsg.textContent = r.message || r.error || "沒有上一批";
      if (r.startedCooling && r.cooling) {
        restoreMsg.textContent = `已開始冷靜期，截止 ${r.cooling.until}`;
        render();
        return;
      }
      if (r.requiresCooling) {
        restoreMsg.textContent = `${r.message || ""}（調鬆須 7 天冷靜期與理由，請按「開始 7 天冷靜期」）`;
      }
      return;
    }
    restoreMsg.textContent = "已還原。";
    render();
  };
  $("#restore").onclick = () => doRestore(false);
  $("#startCoolRestore").onclick = () => doRestore(true);
}

function listMessages(report) {
  const box = el("ul");
  for (const e of [...report.errors, ...report.warnings, ...report.notes, ...(report.pending || [])]) {
    const label = e.fieldLabel || fieldLabel(e.field) || e.field || "";
    // 訊息等級用中文顯示（畫面上不出現 error、warning 這類英文字）
    const levelText = e.level === "error" ? "錯誤" : e.level === "warning" ? "提醒" : "註";
    box.appendChild(el("li", { text: `${levelText}：${label} ${e.message}` }));
  }
  return box;
}

/** 選好檔案：先自動判斷是匯入表、方法包還是加密備份，再各自顯示確認前的白話預覽（S4）。 */
async function onFile(e, { keepChoices = false } = {}) {
  const files = [...(e.target.files || [])];
  if (!files.length) return;
  lastImportFiles = files;
  if (!keepChoices) ui.notesChoices = {};
  const preview = $("#preview");
  mount(preview, [el("p", { class: "hint", text: "正在判斷是哪一種檔案…" })]);
  let read;
  try {
    read = await readImportFiles(files, state);
  } catch (err) {
    read = { ok: false, error: UNKNOWN_FILE_MESSAGE };
  }
  if (!read.ok) {
    mount(preview, [el("p", { class: "banner danger", text: read.error })]);
    return;
  }
  if (read.kind === "method_pack") return renderMethodPackPreview(preview, read.data);
  if (read.kind === "backup") return renderBackupPreview(preview, read.files);
  return renderImportTablePreview(preview, read.data, read.hash);
}

function renderMethodPackPreview(preview, data) {
  const v = validateMethodPack(data);
  const kids = v.ok
    ? [
        el("p", { text: `這是方法包「${data.meta?.title || ""}」，可載入，共 ${data.checklist.length} 項。已經看過的紀錄會繼續用它們當時的清單，不受影響。` }),
        el("button", { class: "primary", id: "applyPack", text: "確認匯入" })
      ]
    : [el("p", { text: v.errors.map((er) => er.message).join("；") })];
  mount(preview, kids);
  $("#applyPack")?.addEventListener("click", async () => {
    const r = await runCommand(() => ctrl.loadMethodPack(data));
    if (r?.ok) mount(preview, [el("p", { class: "banner", text: "已匯入方法包。" })]);
  });
}

function renderBackupPreview(preview, files) {
  const pass = el("input", { id: "importPass", type: "password", autocomplete: "current-password", placeholder: "通關詞" });
  const msg = el("div", { class: "hint", id: "importBackupMsg" });
  const confirm = el("button", { type: "button", class: "primary", id: "confirmBackup", text: "確認匯入" });
  mount(preview, [
    el("p", { text: `這是加密備份檔（共 ${files.length} 個檔案）。請輸入通關詞再確認匯入；如果和這支手機上的資料不同，會先讓你選「完全取代」或「合併」。` }),
    el("label", { text: "通關詞" }, [pass]),
    confirm,
    msg
  ]);
  const run = async (mode) => {
    const restored = await ctrl.importBackupFiles(files, pass.value, { reason: $("#restoreReason")?.value || "", schema, mode });
    if (restored.needsChoice) {
      mount(msg, [
        el("span", { text: `${backupDiffSummary(restored.diff)}請選一種處理方式。` }),
        el("button", {
          type: "button",
          id: "importBakReplace",
          text: "先自動另存現況，再完全取代",
          onclick: async () => {
            const exp = await ctrl.exportBackup(pass.value);
            if (!exp.ok) {
              showError(exp.error || "現況無法另存，已停止還原");
              return;
            }
            for (const d of exp.downloads) downloadJson(d.json, d.filename);
            await run("replace");
          }
        }),
        el("button", { type: "button", id: "importBakMerge", text: "合併（不會用備份覆蓋這台手機上已有的資料）", onclick: () => run("merge") })
      ]);
      return;
    }
    if (restored.ok && restored.unchanged) {
      msg.textContent = "備份的內容和這台手機完全相同，不需要還原。";
      return;
    }
    if (!restored.ok) {
      showError(restored.error || restored.message || "還原失敗");
      return;
    }
    refreshState();
    const c = backupCounts(restored.data);
    msg.textContent = `已還原物件 ${c.objects}、照片 ${c.photos}、錄音分片 ${c.audioChunks}。`;
  };
  confirm.onclick = () => run(undefined);
}

function conflictValueText(v) {
  if (v === true) return "是";
  if (v === false) return "否";
  return v === undefined || v === null || v === "" ? "（空）" : String(v);
}

function renderImportTablePreview(preview, data, hash) {
  const report = ctrl.previewImport(data, schema, { reason: $("#restoreReason")?.value, notesChoices: ui.notesChoices });
  const notes = report.notesImport;
  const typedB01 = report.b01RequiresManual
    ? el("label", { text: "此格必須本人輸入（上限，萬）" }, [
        el("input", { id: "typedB01", inputmode: "decimal", placeholder: "請手打檔裡的數字" })
      ])
    : null;
  const suggestBox = el("div");
  // 沒有建議值的待核項（例如必填欄留空）只在上方訊息列出，不放勾選框
  for (const p of (report.pending || []).filter((x) => x.suggested !== undefined)) {
    suggestBox.appendChild(
      el("label", { class: "check-item" }, [
        el("input", { type: "checkbox", class: "suggest", "data-field": p.field }),
        el("span", { text: `將套用建議值 ${p.suggested}（${fieldLabel(p.field)}）` })
      ])
    );
  }
  const canWrite = report.ok && (!report.unchanged || report.notesChanged === true);
  const confirm = el("button", {
    class: "primary",
    id: "confirmImport",
    disabled: !canWrite,
    text: "確認匯入"
  });
  const coolBtn = report.canStartCooling
    ? el("button", { type: "button", id: "startCoolImport", text: "登記調鬆理由並開始 7 天冷靜期" })
    : null;
  const changeList = displayDiffChanges(report.diff || [], { vaultOpen: isRevealed(ui.reveal, "import") }).map((d) => d.text);
  const diffVaultBtn = el("button", { type: "button", id: "diffVault", text: isRevealed(ui.reveal, "import") ? "重新遮住" : "長按顯示完整變更" });
  const conflictBox = notes?.conflicts?.length
    ? el("div", { id: "notesConflicts" }, [
        el("p", { text: "這些欄位你在手機上改過，筆記裡的值不一樣。預設保留手機的，可以逐項改選：" }),
        ...notes.conflicts.map((c) => {
          const key = `${c.id}|${c.field}`;
          const sel = el("select", { "data-conflict": key }, [
            el("option", { value: "phone", text: "保留手機的" }),
            el("option", { value: "notes", text: "改用筆記的" })
          ]);
          sel.value = ui.notesChoices[key] === "notes" ? "notes" : "phone";
          sel.onchange = () => {
            ui.notesChoices[key] = sel.value;
          };
          return el("div", { class: "check-item" }, [
            el("span", { text: `${c.id}　${c.label}：手機是 ${conflictValueText(c.phone)}，筆記是 ${conflictValueText(c.notes)}` }),
            sel
          ]);
        })
      ])
    : null;
  const pendingBox = notes?.pending?.length
    ? el("div", { id: "notesPending" }, [
        el("p", { text: "這幾列資料有問題，先標成待核（還不確定，之後要查），不會寫入：" }),
        el("ul", {}, notes.pending.map((p) => el("li", { text: `第 ${p.index + 1} 列 ${p.code || "（沒有物件代號）"}：${p.errors.map((er) => er.message).join("；")}` })))
      ])
    : null;
  mount(preview, [
    el("p", { text: report.ok ? "驗證通過（仍請看預覽）" : "有錯誤，已擋下" }),
    ...(report.plainSummary || []).map((t) => el("p", { class: "summary-line", text: t })),
    conflictBox,
    pendingBox,
    listMessages(report),
    changeList.length ? el("p", { text: "變更預覽" }) : null,
    changeList.length ? el("ul", {}, changeList.map((t) => el("li", { text: t }))) : null,
    changeList.length ? diffVaultBtn : null,
    typedB01,
    suggestBox,
    !canWrite && report.ok ? el("p", { text: "沒有變更" }) : null,
    confirm,
    coolBtn
  ]);
  bindLongPress(diffVaultBtn, () => {
    ui.reveal = nextReveal(ui.reveal, { type: "reveal", scope: "import" });
    onFile({ target: { files: lastImportFiles } }, { keepChoices: true });
  });
  diffVaultBtn.onclick = () => {
    if (isRevealed(ui.reveal, "import")) {
      ui.reveal = nextReveal(ui.reveal, { type: "conceal" });
      onFile({ target: { files: lastImportFiles } }, { keepChoices: true });
    }
  };
  const doApply = async (startCooling) => {
    const typed = $("#typedB01") ? $("#typedB01").value : undefined;
    const confirmedSuggestions = [...document.querySelectorAll(".suggest:checked")].map((i) => i.dataset.field);
    const applied = await ctrl.confirmImport(data, {
      typedB01: report.b01RequiresManual ? typed : undefined,
      fileHash: hash,
      confirmedSuggestions,
      reason: $("#restoreReason")?.value,
      startCooling,
      notesChoices: { ...ui.notesChoices }
    });
    refreshState();
    if (applied.unchanged) {
      showError("沒有變更");
      return;
    }
    if (applied.ok === false) {
      if (applied.startedCooling && applied.cooling) {
        showError(`已開始冷靜期，截止 ${applied.cooling.until}`);
        render();
        return;
      }
      showError(applied.message || applied.error || "門檻調鬆須冷靜期");
      return;
    }
    ui.notesChoices = {};
    // 匯入已經完成：第一句從「會…」改成「已…」，要「下面逐項改選」那句已不能做了就不再顯示
    const doneLines = (report.plainSummary || []).filter((t, i) => i === 0 || !/逐項改選/.test(t)).map((t, i) => (i === 0 ? t.replace(/^會/, "已") : t));
    mount(preview, [
      el("p", { class: "banner", text: "已匯入。" }),
      ...doneLines.map((t) => el("p", { text: t })),
      el("a", { href: "#home", text: "回首頁" })
    ]);
  };
  confirm.addEventListener("click", () => doApply(false));
  coolBtn?.addEventListener("click", () => doApply(true));
}

function input(id, label, attrs = {}) {
  return el("label", { text: label }, [el("input", { id, ...attrs })]);
}

function drawFieldChecklist() {
  const v = state.viewings.find((x) => x.id === state.currentViewingId);
  const source = ctrl.checklistSource(v);
  const onsite = source.filter((i) => i.phase === "現場");
  const node = $("#onsiteList");
  if (!node) return;
  // 快速模式：先列現場必做題；非必做題收在可展開的「其他」區
  const quick = onsiteQuickItems({ checklist: source });
  const others = onsite.filter((i) => !quick.includes(i));
  mount(node, [
    ...quick.map((i) => checklistRow(i, v)),
    others.length
      ? el("details", { class: "more-items" }, [el("summary", { text: `其他（非必做）${others.length} 題` }), ...others.map((i) => checklistRow(i, v))])
      : null
  ]);
}

/** 一題的標題區：題目、怎麼查，以及區域資料提示（S5 的 prefill_from：只提示，不替使用者作答）。 */
function itemTitle(i, v, withHow = true) {
  const kids = [el("strong", { text: i.text })];
  if (withHow) kids.push(el("br"), el("span", { class: "hint", text: i.how_to_check || "" }));
  const prop = state.properties.find((p) => p.id === v?.property_id);
  const hint = prefillHint(i, prop, state.areas);
  if (hint) kids.push(el("br"), el("span", { class: "hint prefill", "data-prefill": i.id, text: hint.text }));
  return el("span", {}, kids);
}

function checklistRow(i0, v, onSaved, { stacked = false } = {}) {
  const i = displayItem(state, i0); // 快照裡的題目沒帶操作說明與區域資料提示來源時，用目前方法包補上
  // 看一間的畫面用上下排（題目在上、填寫的格子在下，手機窄螢幕才有地方打字）；舊的現場頁維持左右排
  const rowClass = stacked ? "check-item stack" : "check-item";
  const rec = v?.responses?.[i.id] || {};
  const opts = i.options && i.options.length ? i.options : ["是", "否", "不適用", "待核"];
  const save = (status, value) => {
    if (!v) return;
    // 一律明確帶「畫面上這一間」的看房代號，不靠「目前選定」，快速切換看房也不會寫到前一間（F9-08）
    runCommand(() => ctrl.setChecklistResponse(i.id, { status, value }, v.id)).then(() => {
      onSaved?.();
      if (i.condition_key) {
        const node = document.getElementById(`cond-${i.condition_key}`);
        if (node) node.value = value ?? "";
      }
      if (i.screen_key && SCREEN_BINDINGS[i.screen_key]) {
        const node = document.getElementById(`cond-${i.screen_key}`);
        if (node) node.value = value ?? "";
      }
    });
  };
  if (i.options && i.options.length) {
    const current = rec.value ?? rec.status ?? "";
    const sel = el(
      "select",
      {
        "data-id": i.id,
        onchange: (ev) => {
          const val = ev.target.value;
          if (val === "") {
            runCommand(() => ctrl.setChecklistResponse(i.id, null, v?.id));
            return;
          }
          save(val, val);
        }
      },
      [el("option", { value: "", text: "未填" }), ...i.options.map((o) => el("option", { value: o, text: o }))]
    );
    if (current) sel.value = current;
    return el("div", { class: rowClass }, [
      itemTitle(i, v),
      sel
    ]);
  }
  if (i.input_type === "number") {
    const inp = el("input", {
      inputmode: "decimal",
      value: rec.value ?? "",
      "data-id": i.id
    });
    inp.onchange = () => {
      const f = readNumbers({ v: inp.value }, { v: i.text }, { v: i.unit === "萬" ? "wan" : i.unit === "元" ? "yuan" : "plain" });
      if (!f.ok) return;
      save(inp.value.trim() ? "是" : "待核", f.patch.v);
    };
    return el("div", { class: rowClass }, [itemTitle(i, v, false), inp]);
  }
  if (i.input_type === "text") {
    const inp = el("input", { value: rec.value ?? "", "data-id": i.id, placeholder: "請填原因或說明" });
    inp.onchange = () => save(inp.value ? "是" : "待核", inp.value);
    return el("div", { class: rowClass }, [itemTitle(i, v, false), inp]);
  }
  if (i.input_type === "rating") {
    const sel = el(
      "select",
      {
        "data-id": i.id,
        onchange: (ev) => {
          const f = readNumbers({ v: ev.target.value }, { v: i.text });
          if (f.ok) save(ev.target.value ? "是" : "待核", f.patch.v);
        }
      },
      [el("option", { value: "", text: "未填" }), ...["1", "2", "3", "4", "5"].map((o) => el("option", { value: o, text: `${o} 分` }))]
    );
    if (rec.value != null && rec.value !== "") sel.value = String(rec.value);
    return el("div", { class: rowClass }, [itemTitle(i, v, false), sel]);
  }
  const current = rec.status || "";
  const sel = el(
    "select",
    {
      "data-id": i.id,
      onchange: (ev) => {
        save(ev.target.value, ev.target.value);
      }
    },
    [el("option", { value: "", text: "未填" }), ...opts.map((o) => el("option", { value: o, text: o }))]
  );
  if (current) sel.value = current;
  return el("div", { class: rowClass }, [
    itemTitle(i, v),
    sel
  ]);
}

/** 畫面顯示的看房和目前選定的不同：這個畫面已過期，不送出任何寫入，提示後重繪（F9-08）。 */
function staleFieldNotice() {
  showError("畫面已過期，請重新整理");
  render();
}

function pageField() {
  ui.fieldViewingId = state.currentViewingId; // 記下這一頁顯示的是哪一間看房
  const pack = state.methodPack;
  const coreOn = (pack?.checklist || []).filter((i) => i.core && i.phase === "現場");
  mount(appEl, [
    backLink("#property", "← 回物件清單"),
    el("div", { class: "card" }, [
      el("h2", { text: "現場" }),
      el("p", { class: "hint", text: "一打開就是選定物件的必做清單、拍照、錄音、轉文字。單手可勾選。" }),
      viewingPicker(() => render()),
      input("pask", "開價（萬）", { inputmode: "decimal" }),
      input("pping", "登記總坪", { inputmode: "decimal" }),
      el("label", { text: "有無車位" }, [
        el("select", { id: "phaspark" }, [
          el("option", { value: "", text: "未填" }),
          el("option", { value: "有", text: "有" }),
          el("option", { value: "無", text: "無" })
        ])
      ]),
      el("label", { text: "車位是否含在開價" }, [
        el("select", { id: "pparkin" }, [
          el("option", { value: "", text: "未填" }),
          el("option", { value: "是", text: "含在開價" }),
          el("option", { value: "否", text: "不含在開價" })
        ])
      ]),
      input("ppark", "車位開價（萬）", { inputmode: "decimal" }),
      input("pparkping", "車位坪", { inputmode: "decimal" }),
      el("h3", { text: "屋況 7 類快選" }),
      ...CONDITION_KEYS.map((k) =>
        el("label", { text: CONDITION_LABELS[k] }, [
          el("select", { id: `cond-${k}` }, ["", "無問題", "輕微", "嚴重", "看不出來"].map((o) => el("option", { value: o, text: o || "未填" })))
        ])
      ),
      el("button", { type: "button", id: "saveField", text: "存現場欄位" })
    ]),
    el("div", { class: "card" }, [
      el("h2", { text: `現場必做（${coreOn.length} 項）` }),
      el("div", { id: "onsiteList" }),
      el("div", { class: "row" }, [
        el("button", { type: "button", id: "photoBtn", text: "拍照／選圖" }),
        el("input", { id: "photoFile", type: "file", accept: "image/*", capture: "environment", class: "hidden" }),
        el("button", { type: "button", id: "recBtn", text: ui.recording ? "停止錄音" : "開始錄音（每 5 秒存本機）" })
      ]),
      el("p", { class: "hint", text: "已存照片與分片會留在這支手機。線上轉文字預設關。" }),
      el("label", { class: "check-item" }, [el("input", { type: "checkbox", id: "consent" }), " 已告知在場的人並取得同意"]),
      el("div", { class: "row" }, [
        el("button", { type: "button", id: "sttBtn", text: "開啟線上即時轉文字" }),
        el("button", { type: "button", id: "sttStop", text: "停止轉文字" })
      ]),
      el("p", { id: "sttMsg", class: "hint" })
    ])
  ]);
  const prop = selectedProperty();
  if (prop) {
    if (prop.ask_total != null) $("#pask").value = prop.ask_total;
    if (prop.ping_total != null) $("#pping").value = prop.ping_total;
    if (prop.has_parking === true || prop.has_parking === "有") $("#phaspark").value = "有";
    else if (prop.has_parking === false || prop.has_parking === "無") $("#phaspark").value = "無";
    if (prop.parking_included_in_ask === false || prop.parking_included_in_ask === "否") $("#pparkin").value = "否";
    else if (prop.parking_included_in_ask === true || prop.parking_included_in_ask === "是") $("#pparkin").value = "是";
    if (prop.parking_price_ask != null) $("#ppark").value = prop.parking_price_ask;
    if (prop.parking_ping != null) $("#pparkping").value = prop.parking_ping;
    for (const k of CONDITION_KEYS) {
      if (prop.condition?.[k]) $(`#cond-${k}`).value = prop.condition[k];
    }
  }
  drawFieldChecklist();
  $("#saveField").onclick = async () => {
    if (isStaleFieldView(ui.fieldViewingId, state.currentViewingId)) {
      staleFieldNotice();
      return;
    }
    const p = selectedProperty();
    if (!p) {
      showError("請先到物件資料頁新增或選定物件");
      return;
    }
    const nums = readNumbers(
      { ask_total: $("#pask").value, ping_total: $("#pping").value, parking_price_ask: $("#ppark").value, parking_ping: $("#pparkping").value },
      { ask_total: "開價", ping_total: "登記總坪", parking_price_ask: "車位開價", parking_ping: "車位坪" },
      { ask_total: "wan", parking_price_ask: "wan" }
    );
    if (!nums.ok) return;
    const r = await runCommand(() => ctrl.saveFieldInputs(p.id, {
      ...nums.patch,
      has_parking: $("#phaspark").value === "有" ? true : $("#phaspark").value === "無" ? false : null,
      parking_included_in_ask: $("#pparkin").value === "否" ? false : $("#pparkin").value === "是" ? true : null,
      condition: Object.fromEntries(CONDITION_KEYS.map((k) => [k, $(`#cond-${k}`).value || null]))
    }));
    if (!r.ok) return;
    render();
  };
  $("#photoBtn").onclick = () => $("#photoFile").click();
  $("#photoFile").onchange = async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    if (isStaleFieldView(ui.fieldViewingId, state.currentViewingId)) {
      staleFieldNotice();
      return;
    }
    const r = await ctrl.takePhoto({ blob: f, name: f.name, viewingId: ui.fieldViewingId });
    if (!r.ok) showError(r.error);
  };
  $("#recBtn").onclick = toggleRec;
  $("#sttBtn").onclick = startStt;
  $("#sttStop").onclick = () => stopStt();
  // 取消勾選「已告知在場的人並取得同意」就停止轉文字（F9-09）
  $("#consent").addEventListener("change", () => {
    if (!$("#consent").checked) stopStt();
  });
}

function propertyTabs(active) {
  return el("div", { class: "row", id: "propertyTabs" }, [
    el("a", { class: `btn${active === "list" ? " on" : ""}`, href: "#property", text: "清單", "aria-current": active === "list" ? "page" : undefined }),
    el("a", { class: `btn${active === "compare" ? " on" : ""}`, href: "#property/compare", text: "比較", "aria-current": active === "compare" ? "page" : undefined })
  ]);
}

function pageProperty(route) {
  if (route.sub === "compare") return pageCompare();
  if (route.sub === "field") return pageField();
  if (route.sub === "detail") return pagePropertyDetail(route.id);
  return pagePropertyList();
}

/** 物件清單：每一列是物件代號、區域、狀態、分數、是否計入；點進去才看詳細欄位（U6）。 */
function pagePropertyList() {
  const rows = propertyRows(state);
  const nodes = rows.map((r) => {
    const b = el("button", { type: "button", class: "prop-row", "data-property": r.id }, [
      el("strong", { text: rowLabel(r) }),
      el("span", { class: "meta", text: `區域 ${r.area || "未填"}　狀態 ${r.status}　分數 ${r.score}　${r.counted ? "已計入" : "未計入"}　詳細 ›` })
    ]);
    b.onclick = () => {
      location.hash = `#property/detail/${encodeURIComponent(r.id)}`;
    };
    return b;
  });
  mount(appEl, [
    propertyTabs("list"),
    el("div", { class: "card", id: "propList" }, [
      el("h2", { text: `物件（${rows.length} 間）` }),
      ...(nodes.length ? nodes : [el("p", { class: "hint", text: "還沒有物件。可以從筆記匯入，或到「看房」新增一間。" })])
    ])
  ]);
}

/** 物件詳細：基本欄位預設展開，更多欄位預設收起；原本物件頁的功能都在這裡，現場頁從這裡進入。 */
function pagePropertyDetail(id) {
  const prop = state.properties.find((p) => p.id === id);
  if (!prop) {
    mount(appEl, [propertyTabs("list"), el("div", { class: "card" }, [el("p", { text: "找不到這間物件，請回清單重選。" })])]);
    return;
  }
  const views = orderedViewings(state, id);
  const latest = views.at(-1) || null;
  const live = assessPropertyFromState(state, id);
  const alerts = (live?.alerts || []).join("；");
  mount(appEl, [
    backLink("#property", "← 回物件清單"),
    el("div", { class: "card" }, [
      el("h2", { text: id }),
      el("p", { text: `狀態 ${propertyStatus(state, prop, live)}　評分：${scoreLineText(live)}${alerts ? `　提醒：${alerts}` : ""}` }),
      scoreBreakdownText(live) ? el("p", { class: "hint", text: `評分來源：${scoreBreakdownText(live)}` }) : null,
      el("p", { class: "hint", text: propertySelfFitLine(state, prop) }),
      el("button", { type: "button", id: "detailVisit", text: latest && !isFlagOn(latest.post_saved) ? "繼續看這間" : "開始看這間" }),
      el("a", { class: "btn", id: "detailPriceLog", href: `#price_log/${encodeURIComponent(id)}`, text: "問價紀錄" }),
      latest ? el("button", { type: "button", id: "openField", text: "開啟現場頁（進階）" }) : null
    ]),
    el("details", { class: "fold", id: "basicFold", open: true }, [
      el("summary", { text: "基本" }),
      input("pcode", "物件代號", { placeholder: "例如 A01，不要寫門牌" }),
      input("parea", "區域代號", { placeholder: "AA01" }),
      input("pask", "開價（萬）", { inputmode: "decimal" }),
      input("pping", "登記總坪", { inputmode: "decimal" }),
      input("prooms", "房數", { inputmode: "numeric" }),
      input("ptype", "產品類型", { placeholder: "大樓" })
    ]),
    el("details", { class: "fold", id: "moreFold" }, [
      el("summary", { text: "更多欄位" }),
      input("pwalkmin", "步行分鐘", { inputmode: "numeric" }),
      input("phold", "可持有年數", { inputmode: "decimal" }),
      input("pcommute", "到強勢辦公區分鐘（平日 7:30 開車門到門）", { inputmode: "numeric" }),
      el("label", { text: "交通狀態" }, [
        el("select", { id: "ptransit" }, [
          el("option", { value: "", text: "未填" }),
          el("option", { value: "已通車", text: "已通車" }),
          el("option", { value: "規劃中", text: "規劃中" }),
          el("option", { value: "施工中", text: "施工中" })
        ])
      ]),
      el("label", { text: "交通方式" }, [
        el("select", { id: "pwalkmode" }, [
          el("option", { value: "", text: "未填" }),
          el("option", { value: "步行", text: "步行" }),
          el("option", { value: "騎車", text: "騎車" }),
          el("option", { value: "開車", text: "開車" })
        ])
      ]),
      input("ptiming", "時間點分數（0／1／2）", { inputmode: "numeric" }),
      input("pschool", "學區主張"),
      el("label", { text: "學區已核實" }, [
        el("select", { id: "pschoolv" }, [
          el("option", { value: "待核", text: "待核" }),
          el("option", { value: "否", text: "否" }),
          el("option", { value: "是", text: "是" })
        ])
      ]),
      input("pschooldate", "學區核實公告日期", { placeholder: "YYYY-MM-DD" }),
      input("pbaths", "衛浴數（幾間浴室，現場會依這個數字建立浴室的站）", { inputmode: "numeric" }),
      input("pschoolyear", "學區適用學年度", { inputmode: "numeric" }),
      input("pfake", "假價格警訊項數", { inputmode: "numeric" }),
      input("pfakealt", "假價格替代解釋"),
      input("page", "屋齡（年）", { inputmode: "numeric" }),
      el("label", { text: "管理費（元／月，可寫 1萬 或 3千）" }, [el("input", { id: "pmgmt" }), el("span", { class: "hint", id: "pmgmtHint" })]),
      input("pprev", "前次開價（萬，選填）", { inputmode: "decimal" }),
      el("label", { text: "一票否決命中（逗號分隔）" }, [el("input", { id: "pdeal", placeholder: "例如 嚴重漏水" })]),
      el("label", { text: "有無車位" }, [
        el("select", { id: "phaspark" }, [
          el("option", { value: "", text: "未填" }),
          el("option", { value: "有", text: "有" }),
          el("option", { value: "無", text: "無" })
        ])
      ]),
      el("label", { text: "車位是否含在開價" }, [
        el("select", { id: "pparkin" }, [
          el("option", { value: "", text: "未填" }),
          el("option", { value: "是", text: "含在開價" }),
          el("option", { value: "否", text: "不含在開價" })
        ])
      ]),
      input("ppark", "車位開價（萬）", { inputmode: "decimal" }),
      input("pparkping", "車位坪", { inputmode: "decimal" })
    ]),
    el("div", { class: "card" }, [el("button", { class: "primary", id: "saveProp", text: "存這間物件" })]),
    latest
      ? el("div", { class: "card" }, [
          el("h2", { text: "看房前／看房後清單" }),
          el("div", { id: "otherList" }),
          el("button", { type: "button", id: "savePost", text: "看房後存檔並評分" })
        ])
      : null
  ]);
  fillPropForm(prop);
  if (prop.from_notes === true) {
    // 從筆記匯入的物件靠代號和筆記對得上，代號改了，下次匯入會被當成新物件
    const codeInput = $("#pcode");
    codeInput.setAttribute("readonly", "");
    codeInput.parentElement?.appendChild(el("span", { class: "hint", id: "pcodeHint", text: "從筆記匯入的物件，代號不能改（改了下次匯入會對不上）。" }));
  }
  const showMgmtHint = () => {
    const hint = $("#pmgmtHint");
    if (hint) hint.textContent = numberHint($("#pmgmt")?.value, "yuan");
  };
  $("#pmgmt")?.addEventListener("input", showMgmtHint);
  showMgmtHint();
  if (latest) {
    const other = ctrl.checklistSource(latest).filter((i) => i.phase !== "現場");
    mount($("#otherList"), other.map((i) => checklistRow(i, latest)));
  }
  $("#detailVisit").onclick = () => beginViewing(id);
  $("#openField")?.addEventListener("click", async () => {
    const r = await runCommand(() => ctrl.selectViewing(latest.id));
    if (r?.ok) location.hash = "#property/field";
  });
  $("#saveProp").onclick = async () => {
    const form = readPropForm();
    if (!form.ok) return;
    const raw = form.fields;
    const { patch, changedKeys } = diffPropForm(prop, raw);
    const r = await ctrl.updateProperty(prop.id, { ...patch, id: raw.id }, { changedKeys: [...changedKeys, "id"] });
    if (!r.ok) {
      showError((r.errors || []).map((e) => e.message).join("；") || r.error);
      return;
    }
    if (raw.id && raw.id !== prop.id) location.hash = `#property/detail/${encodeURIComponent(raw.id)}`;
    else render();
  };
  $("#savePost")?.addEventListener("click", async () => {
    const r = await ctrl.scoreCurrent(latest.id);
    if (!r.ok) {
      showError(r.error || "無法評分");
      return;
    }
    refreshState();
    const drop = priceDropToCapReminder(state.properties.find((p) => p.id === id), state.finance);
    if (drop) showError(drop);
    render();
  });
}

function fillPropForm(p) {
  if (!p) return;
  const set = (id, v) => {
    const n = $(id);
    if (!n) return;
    if (v === undefined || v === null) return;
    n.value = Array.isArray(v) ? joinList(v) : String(v);
  };
  set("#pcode", p.id);
  set("#parea", p.area_code);
  set("#pask", p.ask_total);
  set("#pping", p.ping_total);
  set("#prooms", p.rooms);
  set("#pbaths", p.baths);
  set("#ptype", p.product_type);
  set("#pwalkmin", p.walk_min);
  set("#phold", p.hold_years);
  set("#pcommute", p.commute_min);
  set("#ptransit", p.transit_status);
  set("#pwalkmode", p.walk_mode);
  set("#ptiming", p.timing_score);
  set("#pschool", p.school_zone_claimed);
  const schoolV = p.school_zone_verified;
  set("#pschoolv", isFlagOn(schoolV) ? "是" : schoolV === false || schoolV === "否" ? "否" : (schoolV || "待核"));
  set("#pschooldate", p.school_zone_verified_date);
  set("#pschoolyear", p.school_zone_year);
  set("#pfake", p.fake_alerts);
  set("#pfakealt", p.fake_price_alt);
  set("#page", p.age);
  set("#pmgmt", p.mgmt_fee_yuan);
  set("#pprev", p.prev_ask_total);
  set("#pdeal", joinList(p.deal_breaker_hits || []));
  if (p.has_parking === true || p.has_parking === "有") set("#phaspark", "有");
  else if (p.has_parking === false || p.has_parking === "無") set("#phaspark", "無");
  if (p.parking_included_in_ask === false || p.parking_included_in_ask === "否") set("#pparkin", "否");
  else if (p.parking_included_in_ask === true || p.parking_included_in_ask === "是") set("#pparkin", "是");
  set("#ppark", p.parking_price_ask);
  set("#pparkping", p.parking_ping);
}

function diffPropForm(original, raw) {
  const patch = {};
  const changedKeys = [];
  for (const [k, v] of Object.entries(raw)) {
    const orig = original?.[k];
    const origN = orig === undefined || orig === null ? "" : Array.isArray(orig) ? joinList(orig) : String(orig);
    const newN = v === undefined || v === null ? "" : Array.isArray(v) ? joinList(v) : String(v);
    if (origN !== newN) {
      patch[k] = v;
      changedKeys.push(k);
    }
  }
  return { patch, changedKeys };
}

/** 回傳 { ok, fields }；任何數字欄不是數字時 ok 為 false（已顯示是哪一格）。 */
function readPropForm() {
  const nums = readNumbers(
    {
      ask_total: $("#pask")?.value,
      ping_total: $("#pping")?.value,
      rooms: $("#prooms")?.value,
      baths: $("#pbaths")?.value,
      walk_min: $("#pwalkmin")?.value,
      hold_years: $("#phold")?.value,
      commute_min: $("#pcommute")?.value,
      timing_score: $("#ptiming")?.value,
      school_zone_year: $("#pschoolyear")?.value,
      fake_alerts: $("#pfake")?.value,
      age: $("#page")?.value,
      mgmt_fee_yuan: $("#pmgmt")?.value,
      prev_ask_total: $("#pprev")?.value,
      parking_price_ask: $("#ppark")?.value,
      parking_ping: $("#pparkping")?.value
    },
    {
      ask_total: "開價",
      ping_total: "登記總坪",
      rooms: "房數",
      baths: "衛浴數",
      walk_min: "步行分鐘",
      hold_years: "可持有年數",
      commute_min: "到強勢辦公區分鐘",
      timing_score: "時間點分數",
      school_zone_year: "學區適用學年度",
      fake_alerts: "假價格警訊項數",
      age: "屋齡",
      mgmt_fee_yuan: "管理費",
      prev_ask_total: "前次開價",
      parking_price_ask: "車位開價",
      parking_ping: "車位坪"
    },
    { ask_total: "wan", mgmt_fee_yuan: "yuan", prev_ask_total: "wan", parking_price_ask: "wan" }
  );
  if (!nums.ok) return { ok: false, fields: null };
  return {
    ok: true,
    fields: {
      id: ($("#pcode")?.value || "").trim(),
      area_code: $("#parea")?.value || null,
      product_type: $("#ptype")?.value || null,
      transit_status: $("#ptransit")?.value || null,
      walk_mode: $("#pwalkmode")?.value || null,
      school_zone_claimed: $("#pschool")?.value || null,
      school_zone_verified: $("#pschoolv")?.value,
      school_zone_verified_date: $("#pschooldate")?.value || null,
      fake_price_alt: $("#pfakealt")?.value || "",
      deal_breaker_hits: splitList($("#pdeal")?.value || ""),
      has_parking: $("#phaspark")?.value === "有" ? true : $("#phaspark")?.value === "無" ? false : null,
      parking_included_in_ask: $("#pparkin")?.value === "否" ? false : $("#pparkin")?.value === "是" ? true : null,
      ...nums.patch
    }
  };
}

/** 釋放錄音資源（音軌、螢幕常亮、錄音器、控制器的錄音綁定）：啟動失敗、正常停止、非預期停止共用。 */
function releaseRecorder() {
  try {
    rec.stream?.getTracks().forEach((t) => t.stop());
  } catch {
    /* ignore */
  }
  try {
    rec.wake?.release?.();
  } catch {
    /* ignore */
  }
  rec.media = null;
  rec.stream = null;
  rec.wake = null;
  ui.recording = false;
}

function finishRecordingUi(result) {
  releaseRecorder();
  const btn = $("#recBtn");
  if (btn) btn.textContent = "開始錄音（每 5 秒存本機）";
  if (result?.banner) {
    showError(result.banner);
    interruptEl.classList.remove("hidden");
    interruptEl.textContent = result.banner;
  } else {
    interruptEl.classList.add("hidden");
  }
}

async function stopRec() {
  ui._recStopExpected = true;
  try {
    rec.media?.stop();
  } catch {
    /* ignore */
  }
  const result = ctrl.handleRecordingStopped({ expected: true });
  finishRecordingUi(result);
}

async function toggleRec() {
  if (ui.recording) {
    await stopRec();
    return;
  }
  const startedFor = state.currentViewingId;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    refreshState();
    // 等麥克風授權的期間，使用者已經換到別間看房：立刻釋放麥克風，不開始錄（F9-09）
    if (state.currentViewingId !== startedFor) {
      stream.getTracks().forEach((t) => t.stop());
      showWarn("看房已換場，沒有開始錄音");
      return;
    }
    rec.stream = stream;
    const mr = new MediaRecorder(stream);
    rec.media = mr;
    const bound = state.currentViewingId;
    rec.boundViewingId = bound;
    ctrl.startRecording(bound);
    mr.onerror = () => showError("錄音發生錯誤");
    mr.onstop = () => {
      const expected = !!ui._recStopExpected;
      ui._recStopExpected = false;
      if (ui.recording || !expected) {
        const result = ctrl.handleRecordingStopped({ expected: false });
        finishRecordingUi(result);
      }
    };
    mr.ondataavailable = async (ev) => {
      if (!ev.data || ev.data.size === 0) return;
      ui.recChunks += 1;
      try {
        const saved = await ctrl.addAudioChunk({ blob: ev.data, viewingId: bound });
        if (saved && saved.ok === false) {
          // 控制器回的是 ok:false 而不是拋例外：一樣要讓你知道，並停止錄音，避免以為還在錄
          showError(`錄音分片保存失敗：${saved.error || "未知原因"}，已停止錄音`);
          navigator.vibrate?.(200);
          if (ui.recording) await stopRec();
        }
      } catch (err) {
        showError(`錄音分片保存失敗：${err.message || err}`);
      }
    };
    mr.start(5000);
    ui.recording = true;
    try {
      rec.wake = await navigator.wakeLock?.request("screen");
    } catch {
      /* ignore */
    }
    $("#recBtn").textContent = "停止錄音";
  } catch (err) {
    releaseRecorder(); // 啟動到一半失敗，麥克風與錄音器都要放掉
    ctrl.stopRecording?.();
    showError(`無法取得麥克風：${err.message || err}`);
  }
}

function stopStt(message = "已停止轉文字。換場須重新勾選同意。") {
  sttGen += 1; // 還在等待的啟動就此作廢（F9-09）
  try {
    rec.stt?.rec?.stop?.();
  } catch {
    /* ignore */
  }
  rec.stt = null;
  ctrl.stopSpeechAndConsent();
  const msg = $("#sttMsg");
  if (msg) msg.textContent = message;
}

async function startStt() {
  const r = canEnableOnlineStt({
    settings: state.settings,
    consented: $("#consent")?.checked
  });
  const msg = $("#sttMsg");
  if (!r.ok) {
    if (msg) msg.textContent = r.reason;
    return;
  }
  const bound = state.currentViewingId;
  const gen = (sttGen += 1);
  // 先關掉舊連線，避免同時有兩條轉文字
  try {
    rec.stt?.rec?.stop?.();
  } catch {
    /* ignore */
  }
  rec.stt = null;
  // 先寫稽核，成功才啟動辨識；稽核寫不進去就不開，聲音不會在沒有紀錄的情況下送出去
  const audited = await ctrl.appendAudit(auditSttEnable());
  if (audited && audited.ok === false) {
    showError(`稽核寫入失敗，未開啟轉文字：${audited.error || "未知原因"}`);
    return;
  }
  // 等稽核寫完的這段時間，使用者可能已按停止、取消同意或換了看房：全部重驗，任一項不成立就不啟動，並補一筆稽核（F9-09）
  refreshState();
  const may = sttMayStart({
    gen,
    currentGen: sttGen,
    consented: $("#consent")?.checked === true,
    boundViewingId: bound,
    currentViewingId: state.currentViewingId,
    settings: state.settings
  });
  if (!may) {
    await ctrl.appendAudit({ type: "stt_enable_cancelled", at: new Date().toISOString(), note: "等待期間已停止、取消同意或換了看房，沒有啟動線上轉文字" });
    if (msg) msg.textContent = "已取消開啟";
    return;
  }
  const started = createBrowserStt({
    lang: "zh-TW",
    onText: (text) => {
      runCommand(() => ctrl.appendFinalTranscript(text, bound));
    },
    onError: () => {
      if (rec.stt === started) stopStt("轉文字已中斷，本機錄音照常");
    },
    // 辨識器自己結束（斷線、逾時）：釋放連線、清掉同意狀態、更新訊息
    onEnd: () => {
      if (rec.stt === started) stopStt("轉文字已中斷，本機錄音照常");
    }
  });
  if (!started.ok) {
    if (msg) msg.textContent = started.message;
    showError("此瀏覽器不支援");
    return;
  }
  rec.stt = started;
  try {
    started.rec.start();
    if (msg) msg.textContent = "已開啟線上即時轉文字（本機錄音照常）。";
  } catch {
    stopStt();
    showError("轉文字發生錯誤，本機錄音照常");
  }
}

function gateLabel(id) {
  const map = {
    "PV-02": "上限只在私密區，今天不對任何人說這個數字",
    "PV-08": "上限、分段出價、財力證明沒有寫在會被看到的地方",
    "PV-10": "今天不簽斡旋、不付訂（內心確認）",
    "PV-11": "問延伸帶：不說上限、不說範圍可以再高，只問物件資料",
    "PV-12": "上限還沒填：開場白總價低於你和共同決策人說好的上限的九成"
  };
  return map[id] || id;
}

function pageAgency() {
  const cap = capBlank();
  const gates = activeHardGates({ capBlank: cap, askingStretch: false });
  const scriptBox = el("textarea", { id: "scriptBox", rows: "5" });
  scriptBox.value = openingScript(state.settings, state.finance, state.areas[0]?.area_label, { aboutPhrase: ui.aboutPhrase });
  const visFields = [
    ["vis02", "VIS-02 品牌與門店代稱"],
    ["vis03", "VIS-03 主責仲介稱呼"],
    ["vis04", "VIS-04 連鎖或在地"],
    ["vis05", "VIS-05 組別與格位"],
    ["vis06", "VIS-06 同行者"],
    ["vis08", "VIS-08 仲介自述優勢"],
    ["vis09", "VIS-09 帶看可排時段"],
    ["vis10", "VIS-10 宣傳與通知方式"],
    ["vis11", "VIS-11 客源描述"],
    ["vis13", "VIS-13 對方承諾的後續"],
    ["vis16", "VIS-16 本次屋單數"]
  ];
  const vis14 = [
    ["vis14flex", "VIS-14 彈性"],
    ["vis14docs", "VIS-14 文件齊全"],
    ["vis14promise", "VIS-14 守承諾"],
    ["vis14nopress", "VIS-14 不施壓"],
    ["vis14local", "VIS-14 在地知識"]
  ];
  mount(appEl, [
    backLink(),
    el("div", { class: "card" }, [
      el("h2", { text: "333 門市" }),
      el("p", { text: `開始前須勾硬關卡：${gates.join("、")}` }),
      ...gates.map((g) =>
        el("label", { class: "check-item" }, [
          el("input", { type: "checkbox", class: "gate", "data-id": g }),
          ` ${gateLabel(g)}`
        ])
      ),
      el("p", { class: "hint", text: "其他 7 項提醒可跳過，以免臨時路過門市卻用不了。" }),
      el("button", { class: "primary", id: "startVisit", text: "開始本次門市" }),
      el("button", { type: "button", id: "backfillVisit", text: "紙本補登" }),
      el("div", { id: "backfillBox", class: "hidden" }, [
        input("bfAt", "發生時間", { type: "datetime-local" }),
        input("bfReason", "補登理由"),
        el("label", { text: "時間戳照片（必選）" }, [el("input", { id: "bfFile", type: "file", accept: "image/*" })]),
        el("button", { type: "button", id: "bfSubmit", text: "建立紙本補登" }),
        el("p", { class: "hint", text: "紙本補登須在 24 小時內，照片必須真的附上；沒有照片或時間超過就不會建立。" })
      ]),
      el("div", { id: "pv11box", class: "hidden" }, [
        el("label", { class: "check-item" }, [
          el("input", { type: "checkbox", class: "gate", id: "pv11", "data-id": "PV-11" }),
          ` ${gateLabel("PV-11")}`
        ])
      ]),
      el("p", { id: "gateMsg" })
    ]),
    el("div", { class: "card" }, [
      el("h2", { text: "開場白與應答（只複製，不送出）" }),
      el("label", { text: "約數句型" }, [
        el("select", { id: "aboutPhrase" }, [
          el("option", { value: "以內", text: "以內" }),
          el("option", { value: "上下", text: "上下" })
        ])
      ]),
      el("label", { class: "check-item" }, [el("input", { type: "checkbox", id: "loanSelf" }), " AQ-05 後半句：貸款我會自己先去銀行評估（僅在屬實時勾）"]),
      el("label", { class: "check-item" }, [el("input", { type: "checkbox", id: "hasOffer", checked: isFlagOn(state.offered) }), " 已出價（AQ-06 用）"]),
      scriptBox,
      el("div", { class: "row" }, [
        el("button", { type: "button", "data-aq": "AQ-05", text: "預算怎麼答" }),
        el("button", { type: "button", "data-aq": "AQ-06", text: "有沒有出價" }),
        el("button", { type: "button", "data-sc": "SCRIPT-OFFER-NOW", text: "被催簽約" }),
        el("button", { type: "button", "data-sc": "SCRIPT-BUDGET", text: "請對方篩屋單" }),
        el("button", { type: "button", id: "stretchQ", text: "詢問延伸帶（須勾 PV-11）" })
      ])
    ]),
    el("div", { class: "card" }, [
      el("h2", { text: `題庫（答案預設「${DEFAULT_UNVERIFIED}」）` }),
      ...["G1", "G2", "G3"].flatMap((g) => [
        el("h3", { text: g }),
        ...QUESTIONS[g].map((q) =>
          el("label", { text: `${q.id} ${q.text}` }, [
            el("input", { "data-qid": q.id, placeholder: DEFAULT_UNVERIFIED })
          ])
        )
      ])
    ]),
    el("div", { class: "card" }, [
      el("h2", { text: "門市紀錄（同一筆存開始與結束）" }),
      input("vis01", "VIS-01 日期時間", { type: "datetime-local" }),
      ...visFields.map(([id, lab]) => input(id, lab)),
      el("label", { text: "VIS-12 交叉驗證結果" }, [
        el("select", { id: "vis12" }, ["", ...CROSS_CHECK_OPTIONS].map((o) => el("option", { value: o, text: o || "未選" })))
      ]),
      el("label", { text: "VIS-07 今天目的" }, [
        el("select", { id: "vis07" }, ["只看屋單", "已排帶看", "都有"].map((o) => el("option", { text: o, value: o })))
      ]),
      el("label", { text: "VIS-15 是否列主要合作" }, [
        el("select", { id: "vis15" }, ["否", "是"].map((o) => el("option", { text: o, value: o })))
      ]),
      el("label", { class: "check-item" }, [
        el("input", { type: "checkbox", id: "g1Confirm" }),
        " 確認要把第一組列為主要合作（練習組原則上不列）"
      ]),
      input("g1ConfirmReason", "第一組列主要合作的理由"),
      el("p", { id: "groupCompleteMsg", class: "hint" }),
      el("h3", { text: "VIS-14 五項評分" }),
      ...vis14.map(([id, lab]) =>
        el("label", { class: "check-item" }, [el("input", { type: "checkbox", id }), ` ${lab}`])
      ),
      input("vis14reason", "VIS-14 理由"),
      el("label", { text: "證照確認" }, [
        el("select", { id: "visLicense" }, ["", "是", "否", "改用公開查詢"].map((o) => el("option", { value: o, text: o || "未選" })))
      ]),
      el("h3", { text: "VIS-17 文件三勾選" }),
      el("label", { text: "簽了什麼" }, [
        el("select", { id: "signed" }, ["", "無", "帶看確認書", "其他"].map((o) => el("option", { value: o, text: o || "未選" })))
      ]),
      el("label", { text: "有無服務費條款" }, [
        el("select", { id: "fee" }, ["", "無", "有"].map((o) => el("option", { value: o, text: o || "未選" })))
      ]),
      el("label", { text: "有無「私下成交仍須付費」" }, [
        el("select", { id: "priv" }, ["", "無", "有"].map((o) => el("option", { value: o, text: o || "未選" })))
      ]),
      el("label", { text: "有無「排除他店」" }, [
        el("select", { id: "ex" }, ["", "無", "有"].map((o) => el("option", { value: o, text: o || "未選" })))
      ]),
      el("button", { type: "button", id: "visDocPhoto", text: "VIS-17 文件拍照" }),
      el("input", { id: "visDocFile", type: "file", accept: "image/*", capture: "environment", class: "hidden" }),
      el("h3", { text: "VIS-18 紅旗" }),
      ...["說保證賺", "催我快簽", "不給書面", "前後說法不一樣", "要我先付錢", "虛構競爭", "其他"].map((x) =>
        el("label", { class: "check-item" }, [el("input", { type: "checkbox", class: "vis18", value: x }), ` ${x}`])
      ),
      el("div", { id: "mainPartnerBox", class: "hint" }, [
        el("p", { text: `目前主要合作 ${mainPartnerSlotIds(state.slots, state.agents).size} 位（上限 3 位）` }),
        ...[...mainPartnerSlotIds(state.slots, state.agents)].map((sid) =>
          el("button", { type: "button", class: "unset-main", "data-slot": sid, text: `取消 ${sid} 主要合作` })
        )
      ]),
      el("button", { type: "button", id: "saveVis", text: "結束並存門市紀錄" }),
      el("p", { class: "hint", text: "載入時依 currentVisitId 回填既有門市紀錄與紅旗" })
    ]),
    el("div", { class: "card" }, [
      el("h2", { text: "屋單轉物件" }),
      input("lst01", "物件代號"),
      input("lst03", "開價", { inputmode: "decimal" }),
      input("lst14", "房數", { inputmode: "numeric" }),
      el("label", { text: "說明書與謄本" }, [
        el("select", { id: "lst13" }, ["現在給", "之後給", "不給"].map((o) => el("option", { text: o })))
      ]),
      el("button", { type: "button", id: "toProp", text: "轉成物件卡" })
    ]),
    el("div", { class: "card" }, [
      el("h2", { text: "仲介跳槽" }),
      input("moveOld", "舊格位", { placeholder: "例如 G1-1" }),
      input("moveNew", "新格位", { placeholder: "例如 G2-1" }),
      input("moveBranch", "新門店代稱"),
      el("button", { type: "button", id: "moveAgent", text: "把目前第一位移到新格並標人已離店" }),
      el("p", { class: "hint", text: "沒有仲介資料時顯示資料不足，不會寫入示範人物。" })
    ])
  ]);
  // 把表單目前的值收成一個物件（存草稿與結束存檔共用）
  const collectVisitForm = () => ({
    date: $("#vis01").value,
    branch_label: $("#vis02").value,
    agent_alias: $("#vis03").value,
    chain_or_local: $("#vis04").value,
    slot_id: $("#vis05").value,
    companion: $("#vis06").value,
    purpose: $("#vis07").value,
    advantage: $("#vis08").value,
    view_slots: $("#vis09").value,
    promo: $("#vis10").value,
    clients: $("#vis11").value,
    cross_check: $("#vis12").value,
    promise: $("#vis13").value,
    main_partner: $("#vis15").value,
    n_listings: $("#vis16").value,
    signed: $("#signed").value,
    fee_clause: $("#fee").value,
    private_deal_fee: $("#priv").value,
    exclude_other: $("#ex").value,
    license_ok: $("#visLicense").value,
    vis14: vis14Score({
      flex: $("#vis14flex").checked,
      docs: $("#vis14docs").checked,
      promise: $("#vis14promise").checked,
      no_pressure: $("#vis14nopress").checked,
      local_knowledge: $("#vis14local").checked
    }),
    vis14_reason: $("#vis14reason").value,
    // 題庫答案：空白就是空白，預設字樣只是提示，不當成答案
    answers: Object.fromEntries([...document.querySelectorAll("[data-qid]")].map((i) => [i.dataset.qid, (i.value || "").trim()])),
    red_flags: [...document.querySelectorAll(".vis18:checked")].map((i) => i.value),
    g1_partner_confirmed: !!$("#g1Confirm")?.checked,
    g1_partner_reason: $("#g1ConfirmReason")?.value || ""
  });
  const curVis = (state.visits || []).find((x) => x.id === state.currentVisitId);
  if (curVis) {
    // 一律從紀錄帶回全部欄位（畫面為了任何原因重繪，已填的內容都不會變空白）
    const model = visitFormModel(curVis, [...document.querySelectorAll("[data-qid]")].map((i) => i.dataset.qid));
    for (const id of ["vis01", "vis02", "vis03", "vis04", "vis05", "vis06", "vis07", "vis08", "vis09", "vis10", "vis11", "vis12", "vis13", "vis15", "vis16", "vis14reason", "signed", "fee", "priv", "ex", "g1ConfirmReason"]) {
      const n = $("#" + id);
      if (n && model[id] !== "") n.value = model[id];
    }
    if ($("#visLicense") && model.visLicenseChoice) $("#visLicense").value = model.visLicenseChoice;
    for (const id of ["vis14flex", "vis14docs", "vis14promise", "vis14nopress", "vis14local", "g1Confirm"]) {
      const n = $("#" + id);
      if (n) n.checked = !!model[id];
    }
    document.querySelectorAll(".vis18").forEach((cb) => {
      cb.checked = model.redFlags.includes(cb.value);
    });
    document.querySelectorAll("[data-qid]").forEach((i) => {
      i.value = model.answers[i.dataset.qid] || "";
    });
  }
  // 門市草稿：輸入變動就存（打字去抖動 250 毫秒，離開欄位時立刻存）。事件一律掛上，處理的當下才判斷有沒有
  // 進行中的訪視，所以第一次按「開始本次門市」之後才出現的訪視也會自動存（F9-07）
  visitDraftSaver?.cancel();
  const draftSaver = makeVisitDraftSaver({
    getState: () => state,
    collect: () => ($("#vis02") ? collectVisitForm() : null),
    save: (visitId, form) => runCommand(() => ctrl.saveVisitDraft(visitId, form), { keepNotices: true })
  });
  visitDraftSaver = draftSaver;
  for (const card of new Set([$("#vis02")?.closest(".card"), document.querySelector("[data-qid]")?.closest(".card")])) {
    card?.addEventListener("input", () => draftSaver.onInput());
    card?.addEventListener("change", () => draftSaver.flush());
  }
  $("#aboutPhrase").value = ui.aboutPhrase || "以內";
  $("#aboutPhrase").onchange = () => {
    ui.aboutPhrase = $("#aboutPhrase").value;
    const warn = checkAboutPhrase(state.finance, state.scoring);
    if (ui.aboutPhrase === "上下" && warn.warn) showError(warn.message);
    scriptBox.value = openingScript(state.settings, state.finance, state.areas[0]?.area_label, { aboutPhrase: ui.aboutPhrase });
  };
  $("#startVisit").onclick = async () => {
    const checked = [...document.querySelectorAll(".gate:checked")].map((i) => i.dataset.id);
    // 經統一的 runCommand（失敗會顯示在橫幅），成功後不整頁重繪（重繪會打斷輸入），只更新訊息並立刻存一次草稿（F9-07）
    const r = await runCommand(() => ctrl.startVisit(checked, { askingStretch: false }), { keepNotices: true });
    $("#gateMsg").textContent = r.ok ? (r.reused ? "沿用進行中的門市訪視。" : "可以開始。計時與看房分開。") : (r.error || `還缺：${(r.missing || []).join("、")}`);
    if (r.ok) await draftSaver.flush();
  };
  if ($("#backfillVisit")) {
    $("#backfillVisit").onclick = () => {
      $("#backfillBox").classList.toggle("hidden");
    };
    $("#bfSubmit").onclick = async () => {
      const file = $("#bfFile").files?.[0];
      const at = $("#bfAt").value ? new Date($("#bfAt").value).toISOString() : "";
      const bytes = file ? new Uint8Array(await file.arrayBuffer()) : null;
      const r = await runCommand(() =>
        ctrl.backfillRecord({ target: "visit", reason: $("#bfReason").value, occurredAt: at, photoBlob: bytes, photoName: file?.name || "paper.jpg" })
      );
      if (r?.ok) {
        showError("已建立紙本補登紀錄，請補齊欄位");
        render();
      }
    };
  }
  document.querySelectorAll("[data-aq]").forEach((b) => {
    b.onclick = () => {
      $("#scriptBox").value = answerAQ(b.dataset.aq, state.settings, state.finance, {
        hasViewings: state.viewings.length > 0,
        loanSelfAssess: $("#loanSelf").checked,
        hasOffer: hasOfferFlag($("#hasOffer").checked)
      });
    };
  });
  document.querySelectorAll("[data-sc]").forEach((b) => {
    b.onclick = () => {
      $("#scriptBox").value = scriptText(b.dataset.sc, state.settings, state.finance, {
        area: state.areas[0]?.area_label,
        layout: state.profile?.layout_note || "格局"
      });
    };
  });
  $("#stretchQ").onclick = () => {
    const box = $("#pv11box");
    if (box) box.classList.remove("hidden");
    const checked = [...document.querySelectorAll(".gate:checked")].map((i) => i.dataset.id);
    const r = canStartAgencyVisit(checked, { askingStretch: true, capBlank: cap });
    if (!r.ok) {
      $("#gateMsg").textContent = `詢問延伸帶須先勾：${r.missing.join("、")}`;
      return;
    }
    $("#scriptBox").value = stretchInquiryDraft();
  };
  $("#visDocPhoto")?.addEventListener("click", () => $("#visDocFile")?.click());
  $("#visDocFile")?.addEventListener("change", async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    try {
      const r = await ctrl.takeVisitPhoto({ blob: f, name: f.name, visitId: state.currentVisitId });
      if (!r.ok) showError(r.error || "照片未保存");
      else $("#gateMsg").textContent = "已保存 VIS-17 文件照片";
    } catch (err) {
      showError(`照片未保存：${err.message || err}`);
    }
  });
  $("#saveVis").onclick = async () => {
    if (!$("#signed").value || !$("#fee").value || !$("#priv").value || !$("#ex").value) {
      showError("VIS-17 文件三勾選尚未選完");
      return;
    }
    const visitNums = readNumbers({ n_listings: $("#vis16").value }, { n_listings: "屋單數" });
    if (!visitNums.ok) return;
    draftSaver.cancel(); // 結束存檔前先取消還沒送出的草稿
    const patch = {
      ...collectVisitForm(),
      end: new Date().toISOString(),
      n_listings: visitNums.patch.n_listings,
      offered: $("#hasOffer").checked
    };
    const r = await ctrl.saveVisit(state.currentVisitId, patch);
    if (!r.ok) {
      showError(r.error || "無法存門市紀錄");
      return;
    }
    const gmsg = $("#groupCompleteMsg");
    const groupId = String(patch.slot_id || "G1").slice(0, 2);
    if (gmsg) gmsg.textContent = r.visit?.group_complete ? `${groupId} 組別完成` : `${groupId} 組別尚未完成`;
    render();
  };
  document.querySelectorAll(".unset-main").forEach((b) => {
    b.onclick = async () => {
      const r = await runCommand(() => ctrl.unsetMainPartner(b.dataset.slot));
      if (r?.ok) render();
    };
  });
  $("#toProp").onclick = async () => {
    const vis = state.visits.find((x) => x.id === state.currentVisitId) || state.visits.at(-1);
    const lid = ($("#lst01").value || "").trim();
    if (!lid) {
      showError("物件代號不可空白");
      return;
    }
    const lnums = readNumbers({ ask_total: $("#lst03").value, rooms: $("#lst14").value }, { ask_total: "開價", rooms: "房數" }, { ask_total: "wan" });
    if (!lnums.ok) return;
    const listing = {
      id: lid,
      property_id: lid,
      ask_total: lnums.patch.ask_total,
      rooms: lnums.patch.rooms,
      docs_now: $("#lst13").value,
      agent_alias: vis?.agent_alias || "",
      slot_id: vis?.slot_id || ""
    };
    const r = await ctrl.listingToProperty(listing);
    if (!r.ok) {
      showError(r.error || "無法轉成物件卡");
      return;
    }
    render();
  };
  $("#moveAgent").onclick = async () => {
    const oldSlot = ($("#moveOld").value || "").trim().toUpperCase();
    const agent = state.agents.find((a) => String(a.slot_id || "").toUpperCase() === oldSlot);
    if (!agent) {
      showError("找不到舊格位對應仲介");
      return;
    }
    const r = await ctrl.transferAgent(agent.id, {
      oldSlotId: oldSlot,
      newSlotId: $("#moveNew").value,
      newBranch: $("#moveBranch").value
    });
    if (!r.ok) {
      showError(r.error || "無法搬移仲介");
      return;
    }
    render();
  };
}

/** 否決證據來自第幾次看房（日期），未解除的才列。 */
function vetoSourceText(s) {
  const views = orderedViewings(state, s.property_id);
  return (s.veto_evidence || [])
    .filter((e) => !e.released)
    .map((e) => {
      const v = views[e.index];
      const day = String(v?.recorded_at || v?.start || "").slice(0, 10);
      return `${e.kind}（來自第 ${e.index + 1} 次看房${day ? `，${day}` : ""}）`;
    })
    .join("、");
}

/** 最新一次看房已改答、但先前的否決還在：要填理由才能解除。 */
function releaseVetoRows(s) {
  const rows = [];
  for (const e of s.veto_evidence || []) {
    if (e.released || rows.some((r) => r.kind === e.kind)) continue;
    if (!latestAnswerClearsVeto(state, s.property_id, e.kind)) continue;
    const reason = el("input", { placeholder: "解除理由（必填）", "data-release-reason": `${s.property_id}|${e.kind}` });
    const btn = el("button", {
      type: "button",
      text: `解除「${e.kind}」`,
      onclick: async () => {
        const r = await runCommand(() => ctrl.releaseVeto(s.property_id, e.kind, reason.value));
        if (r?.ok) render();
      }
    });
    rows.push({ kind: e.kind, node: el("p", {}, [`先前紀錄為${e.kind}，填寫解除理由後才解除　`, reason, btn]) });
  }
  return rows.map((r) => r.node);
}

function pageCompare() {
  const live = (state.properties || []).map((p) => assessPropertyFromState(state, p.id)).filter((s) => s.ok);
  const ranked = live.filter((s) => rankEligible(s)).sort((a, b) => b.total - a.total);
  const pending = live.filter((s) => s.decision === "待核" || s.decision === "待重評");
  const anyStale = live.some((s) => s.stale);
  const watch = live.filter((s) => s.watch_only || s.action === "觀察");
  const stretch = live.filter((s) => s.stretch);
  const elim = live.filter((s) => s.action === "淘汰" || s.decision === "淘汰");
  mount(appEl, [
    propertyTabs("compare"),
    el("div", { class: "card" }, [
      el("h2", { text: "物件比較（待核不排名）" }),
      anyStale
        ? el("p", {}, [
            "有些物件的評分已過期（輸入改過了）。",
            el("button", {
              type: "button",
              id: "rescoreAll",
              text: "全部重評",
              onclick: async () => {
                const r = await runCommand(() => ctrl.rescoreAllStale());
                if (r?.ok) render();
              }
            })
          ])
        : null,
      ...(ranked.length ? ranked.map((s) => el("p", { text: compareRankedText(state, s) })) : [el("p", { text: "沒有可排名的物件" })])
    ]),
    el("div", { class: "card" }, [
      el("h2", { text: "淘汰（不排名、不進延伸帶）" }),
      ...(elim.length
        ? elim.flatMap((s) => [
            el("p", { text: `${s.property_id}　淘汰 ${(s.veto_hits || []).join("、")}${vetoSourceText(s) ? `　${vetoSourceText(s)}` : ""}` }),
            ...releaseVetoRows(s)
          ])
        : [el("p", { text: "沒有" })])
    ]),
    el("div", { class: "card" }, [
      el("h2", { text: "觀察（超過上限，不排名）" }),
      ...(watch.length ? watch.map((s) => el("p", { text: `${s.property_id || s.id}　觀察，不進比較排名` })) : [el("p", { text: "沒有" })]),
      el("h3", { text: "待核（資料不足）" }),
      ...(pending.length ? pending.map((s) => el("p", { text: `${s.property_id || s.id}　${s.decision === "待重評" ? "待重評（輸入已改，請重評）" : "待核"}` })) : [el("p", { text: "沒有" })])
    ]),
    el("div", { class: "card" }, [
      el("h2", { text: "延伸帶（只在本機，不進仲介草稿）" }),
      ...(stretch.length
        ? stretch.map((s) => el("p", { text: `${s.property_id}　${s.stretch_candidate ? "候選" : "不進候選"}　負擔檢查長按才顯示` }))
        : [el("p", { text: "沒有" })])
    ]),
    el("div", { class: "card" }, [
      el("h2", { text: "仲介並排" }),
      ...(state.agents.length
        ? state.agents.map((a) => {
            const vis = state.visits.filter((v) => v.agent_id === a.id || v.slot_id === a.slot_id || v.agent_alias === a.agent_alias).at(-1);
            const nRed = vis?.red_flags?.length || 0;
            const docsRed = state.listings.filter(
              (l) => isFlagOn(l.docs_red) && (l.agent_alias === a.agent_alias || l.slot_id === a.slot_id)
            ).length;
            const d = vis?.vis14?.detail || {};
            return el("p", {
              text: `${a.agent_alias || a.id}　${a.branch_label || ""}　${a.status || ""}　VIS-14 ${vis?.vis14?.score ?? "未填"}（彈性${d.flex ?? "-"} 文件${d.docs ?? "-"} 承諾${d.promise ?? "-"} 不施壓${d.no_pressure ?? "-"} 在地${d.local_knowledge ?? "-"}）　紅旗 ${nRed}　證照 ${licenseConfirmed(vis?.license_ok) ? "已核" : "未核"}　屋單 ${vis?.n_listings ?? 0}　LST-13 不給 ${docsRed}`
            });
          })
        : [el("p", { text: "尚未填仲介" })])
    ])
  ]);
}

function pageAff() {
  const pick = el("select", { id: "affPick" }, [
    el("option", { value: "", text: "選擇物件" }),
    ...state.properties.map((p) =>
      el("option", { value: p.id, text: p.id, selected: (ui.selectedAffId || selectedProperty()?.id) === p.id })
    )
  ]);
  const prop = state.properties.find((p) => p.id === (ui.selectedAffId || selectedProperty()?.id)) || null;
  const stretchThis = prop && (assessPropertyFromState(state, prop.id).stretch || isStretchProperty(prop, state.finance));
  const hideStretch = stretchThis && !isRevealed(ui.reveal, "aff", prop?.id);
  let body;
  if (!prop) {
    body = [el("p", { text: "資料不足：請先選定物件。" })];
  } else {
    const r = runAffordability({
      total: prop.ask_total,
      finance: state.finance,
      finance_meta: state.finance_meta,
      mgmtFeeYuan: prop.mgmt_fee_yuan,
      ageYears: prop.age,
      capBlank: capBlank()
    });
    const unverified = !!r.unverified;
    const vaultBtn = el("button", { type: "button", id: "affVault", text: "長按顯示延伸帶結果" });
    body = [
      pick,
      el("p", { text: `物件 ${prop.id}　總價 ${prop.ask_total ?? "待核"} 萬　管理費 ${prop.mgmt_fee_yuan ?? "待核"} 元　屋齡 ${prop.age ?? "待核"}` }),
      unverified ? el("p", { text: `財務數字：${trustLabel("unverified")}` }) : null,
      // 延伸帶物件未揭露時只放占位文字，真實結果完全不進畫面（F9-17）
      el("div", {}, affordLines(r, { hidden: hideStretch, liquidText: hideStretch ? "" : mask(r.liquid?.value, "aff", prop.id) }).map((x) => el("p", { text: x }))),
      unverified ? el("button", { type: "button", id: "confirmFin", text: "確認財務資料已核實" }) : null,
      stretchThis ? vaultBtn : null
    ];
  }
  mount(appEl, [
    backLink(),
    el("div", { class: "card" }, [
      el("h2", { text: "負擔能力檢查" }),
      el("p", { class: "hint", text: "依你的假設試算，不是銀行核貸結果。管理費以元計，程式會除以 10000 換成萬。缺值顯示資料不足。頭期無法判定時四道顯示頭期資料不足。" }),
      ...body.filter(Boolean)
    ])
  ]);
  pick.onchange = () => {
    ui.selectedAffId = pick.value;
    ui.reveal = nextReveal(ui.reveal, { type: "select", key: pick.value }); // 換物件一律收起
    render();
  };
  $("#confirmFin")?.addEventListener("click", async () => {
    await ctrl.confirmFinanceVerified();
    render();
  });
  const vaultBtn = $("#affVault");
  if (vaultBtn) {
    bindLongPress(vaultBtn, () => {
      ui.reveal = nextReveal(ui.reveal, { type: "reveal", scope: "aff", key: prop?.id ?? null });
      render();
    });
  }
}

function downloadJson(obj, filename) {
  downloadBackupJson(obj, filename);
}

/**
 * 匯出到筆記（S3）：內容由控制器白名單組好並過出口閘門，這裡只負責交出去
 * （手機支援分享檔案就開分享選單，使用者可以選雲端硬碟；不支援就下載）。回傳一句白話結果。
 */
async function exportToNotes() {
  const pack = await ctrl.buildNotesExport();
  if (!pack.ok) {
    showError(pack.error || "無法匯出到筆記");
    return { ok: false, message: pack.error || "無法匯出到筆記" };
  }
  const r = await deliverNotesFile(pack, pack.filename);
  const stretchNote = pack.summary?.skippedStretch ? `另有 ${pack.summary.skippedStretch} 間延伸帶物件不會匯出（延伸帶只留在手機）。` : "";
  if (r.cancelled) return { ok: false, message: "已取消，沒有匯出。" };
  if (!r.ok) {
    showError(r.error || "匯出失敗");
    return { ok: false, message: r.error || "匯出失敗" };
  }
  const where = r.method === "share" ? "已交給分享選單，請選雲端硬碟的「看房同步」資料夾。" : "已下載到這支手機，請把它放進雲端硬碟的「看房同步」資料夾。";
  return { ok: true, message: `${where}（${pack.filename}，共 ${pack.summary.properties} 間物件）${stretchNote}` };
}

function pageMoreRoute(route) {
  const map = {
    import: pageImport,
    settings: moreSettings,
    progress: moreProgress,
    agency: pageAgency,
    aff: pageAff,
    drafts: moreDrafts,
    backup: moreBackup,
    slots: moreSlots,
    profile: moreProfile,
    export: moreExport,
    start: moreStart
  };
  (map[route.sub] || moreMenu)();
}

const MORE_MENU = [
  ["start", "上手步驟", "五步開始使用，每一步做到哪一目了然"],
  ["import", "從筆記匯入", "把雲端硬碟「看房同步」資料夾裡的匯入檔讀進來"],
  ["settings", "設定", "可承受上限、計畫開始日、目標間數"],
  ["progress", "十週進度", "每個檢查點做到哪（預設收起）"],
  ["agency", "仲介與門市", "進門市前的準備與門市紀錄"],
  ["aff", "負擔能力", "這間買得起嗎"],
  ["drafts", "訊息草稿與上傳包", "給仲介或家人的話，先掃描再複製"],
  ["backup", "備份與還原", "加密備份你的資料"],
  ["slots", "看房時段建議", "算這個半天能不能看滿"],
  ["profile", "理想輪廓", "你想要什麼、不要什麼"]
];

function moreMenu() {
  const exportMsg = el("p", { id: "exportNotesMsg", class: "hint" });
  mount(appEl, [
    el("div", { class: "card" }, [
      el("h2", { text: "更多" }),
      el("a", { class: "menu-link", href: "#coach", "data-more": "coach" }, ["口袋大叔", el("span", { class: "hint", text: "　每個階段一步一步教你做、怎麼說、問什麼" })]),
      el("a", { class: "menu-link", href: "#price_log", "data-more": "price_log" }, ["問價紀錄", el("span", { class: "hint", text: "　每間物件誰開了什麼價、你問了什麼" })]),
      ...MORE_MENU.map(([sub, title, desc]) => el("a", { class: "menu-link", href: `#more/${sub}`, "data-more": sub }, [title, el("span", { class: "hint", text: `　${desc}` })]))
    ]),
    el("div", { class: "card" }, [
      el("h2", { text: "匯出到筆記" }),
      el("p", { class: "hint", text: "把每間物件的狀態、分數、屋況、功課完成度與複盤文字整理成一個檔案，分享到雲端硬碟的「看房同步」資料夾。可承受上限與財務數字、錄音與逐字稿全文、照片本身、共同決策人同意紀錄都不會出現在檔案裡。" }),
      el("button", { type: "button", class: "primary", id: "exportNotes", text: "匯出到筆記" }),
      exportMsg
    ]),
    el("div", { class: "card" }, [
      el("h2", { text: "隱私" }),
      el("p", { text: `沒有分析、遙測或廣告。版本 app-v${APP_VERSION}。課程方法包不會打進託管版本。` })
    ])
  ]);
  $("#exportNotes").onclick = async () => {
    const r = await exportToNotes();
    exportMsg.textContent = r.message;
  };
}

/** 十週進度：W0、W3、W6、W10 的檢查點文字整段放在這裡，預設收起。 */
function moreProgress() {
  const pack = state.methodPack;
  const counted = uniqueCounted(state.viewings, state.properties, pack);
  const week = currentWeek();
  const cp = ctrl.homeCheckpoints(week, { secureContext: ui.httpsLive });
  const half = cp.half;
  const onsiteFlags = cp.onsiteFlags;
  const retro = cp.retro;
  const w3 = cp.w3;
  const w6 = cp.w6;
  const w10 = cp.w10;
  const w0 = cp.w0;
  const sameDay = cp.sameDay;
  const split = cp.minutes;
  mount(appEl, [
    backLink(),
    el("details", { class: "fold", id: "progressFold" }, [
      el("summary", { text: "十週計畫的檢查點（W0、W3、W6、W10）" }),
      el("p", {}, ["已計入 ", el("strong", { text: String(cp.counted ?? counted.count) }), ` 間（承諾 ${state.settings.goal_commit || "未填"}）`]),
      el("p", { text: `已採用半天：${half ? `${half} 小時` : "待核（請在設定選 3.5 或 4）"}` }),
      el("p", { text: `W3：${w3.label}${w3.reason ? `（${w3.reason}）` : ""}${w3.missing?.length ? `；待核 ${w3.missing.join("、")}` : ""}` }),
      el("p", { text: `W6：${w6.label}${w6.reason ? `（${w6.reason}）` : ""}` }),
      el("p", { text: `W10：${w10.label || w10.result}${w10.reason ? `（${w10.reason}）` : ""}${w10.missing?.length ? `；待核 ${w10.missing.join("、")}` : ""}` }),
      el("p", { text: `看房合計 ${Math.round(split.viewing_total_min || 0)} 分　門市合計 ${Math.round(split.visit_total_min || 0)} 分` }),
      el("p", { text: `W0 計畫開跑：${w0.ok ? "可勾" : `待核：還缺 ${w0.missing.join("、")}`}` }),
      onsiteFlags.length ? el("p", { text: `現場不足稽核：${onsiteFlags.map((f) => f.id).join("、")}` }) : null,
      retro ? el("p", { text: "否決：偵測到跨日事後補寫" }) : null,
      cp.clockRollback ? el("p", { text: cp.clockRollbackHint || "偵測到裝置時鐘倒退，冷靜期不會因此提前到期" }) : null,
      sameDay.warn ? el("p", { text: sameDay.message }) : null
    ])
  ]);
}

function moreProfile() {
  mount(appEl, [
    backLink(),
    el("div", { class: "card" }, [
      el("h2", { text: "理想輪廓" }),
      el("p", { text: `目標區域：${state.profile.target_areas || "未填"}` }),
      el("p", { text: `最少房數：${state.profile.rooms_min || "未填"}　偏好：${state.profile.rooms_preferred || "未填"}` }),
      el("p", { text: `一票否決：${state.profile.deal_breaker || "未填"}` }),
      el("p", { class: "hint", text: "看房後回寫須你確認才寫入，不會自動改。" })
    ])
  ]);
}

function moreSettings() {
  mount(appEl, [
    backLink(),
    el("div", { class: "card", id: "mainSettings" }, [
      el("h2", { text: "設定" }),
      el("label", { text: "可承受上限（萬，本人手打）" }, [el("input", { id: "b01", inputmode: "decimal", placeholder: "可填 1500、1,500、1500萬" })]),
      input("progStart", "計畫開始日", { type: "date" }),
      input("goalCommit", "目標間數（想看幾間）", { inputmode: "numeric" }),
      el("label", { text: "已採用半天長度" }, [
        el("select", { id: "halfDay" }, [
          el("option", { value: "", text: "未採用" }),
          el("option", { value: "3.5", text: "3.5 小時" }),
          el("option", { value: "4", text: "4 小時" })
        ])
      ]),
      el("label", { text: "線上轉文字允許" }, [
        el("select", { id: "sttAllow" }, [el("option", { value: "否", text: "否" }), el("option", { value: "是", text: "是" })])
      ]),
      input("coolReason", "調鬆理由（調高上限這類調鬆才需要寫）"),
      state.cooling?.until ? el("p", { text: `冷靜期截止：${state.cooling.until}，欄位 ${fieldLabel(state.cooling.field)}，理由：${state.cooling.reason || "未填"}` }) : null,
      el("button", { class: "primary", id: "saveSet", text: "存設定" }),
      el("button", { type: "button", id: "startCoolSet", text: "開始 7 天冷靜期" })
    ]),
    el("details", { class: "fold", id: "tenWeekFold" }, [
      el("summary", { text: "十週計畫追蹤(進階)" }),
      el("label", { class: "check-item" }, [el("input", { type: "checkbox", id: "offlineVerified" }), " 離線實測已通過"]),
      input("partnerConsentAt", "共同決策人同意日期", { type: "date" }),
      input("partnerConsentHow", "共同決策人同意方式"),
      input("commuteMeasured", "實測單程分鐘", { inputmode: "numeric" }),
      el("label", { class: "check-item" }, [el("input", { type: "checkbox", id: "agenciesSelected" }), " 第一組三家已選並查過營業時間"]),
      el("label", { class: "check-item" }, [el("input", { type: "checkbox", id: "slotPlanned" }), " 下週看房半天已用時段規則決定"]),
      el("h3", { text: "W6 檢查點證據" }),
      el("label", { class: "check-item" }, [el("input", { type: "checkbox", id: "s1Complete" }), " 安全里程碑 S1 已完成"]),
      el("label", { class: "check-item" }, [el("input", { type: "checkbox", id: "s2Complete" }), " 安全里程碑 S2 已完成"]),
      el("label", { class: "check-item" }, [el("input", { type: "checkbox", id: "w3GoalRechecked" }), " W3 的 45 或 50 決定已複核"]),
      el("h3", { text: "W3 檢查點證據" }),
      input("remainingWeeks", "剩七週推估", { inputmode: "decimal" }),
      el("label", { text: "45 或 50 最終決定" }, [
        el("select", { id: "goalCommitChoice" }, [
          el("option", { value: "", text: "未決定" }),
          el("option", { value: "45", text: "45" }),
          el("option", { value: "50", text: "50" })
        ])
      ]),
      input("courseBBlank", "課程 B 空白比例", { inputmode: "decimal" }),
      input("courseBDrafts", "課程 B 十張表初稿張數", { inputmode: "numeric" }),
      input("overtimeHours", "本週已用工時（小時）", { inputmode: "decimal" }),
      el("label", { class: "check-item" }, [el("input", { type: "checkbox", id: "overtimeConsent" }), " 加碼超過工時上限已經本人同意"]),
      el("h3", { text: "W10 結案證據" }),
      el("label", { class: "check-item" }, [el("input", { type: "checkbox", id: "sopV2" }), " 個人看房 SOP v2 已完成"]),
      el("label", { class: "check-item" }, [el("input", { type: "checkbox", id: "profileFinal" }), " 理想輪廓已定稿"]),
      el("label", { class: "check-item" }, [el("input", { type: "checkbox", id: "courseBComplete" }), " 課程 B 盤點表已補完"]),
      el("label", { class: "check-item" }, [el("input", { type: "checkbox", id: "courseBCoreUnknown" }), " 課程 B 核心欄位仍有 UNKNOWN"]),
      el("label", { class: "check-item" }, [el("input", { type: "checkbox", id: "combatSelfAssess" }), " 實戰課準備度自評已填"]),
      el("label", { class: "check-item" }, [el("input", { type: "checkbox", id: "s3Complete" }), " 安全里程碑 S3 已完成"]),
      el("label", { class: "check-item" }, [el("input", { type: "checkbox", id: "gapDocumented" }), " 看房間數差距已明寫"]),
      el("label", { text: "有沒有把「待核」寫成「通過」" }, [
        el("select", { id: "w10UnknownAsPass" }, ["", "沒有", "有"].map((o) => el("option", { value: o, text: o || "未填" })))
      ]),
      el("label", { text: "有沒有出現不是本人做的出價、申貸或付款紀錄" }, [
        el("select", { id: "w10NonSelfAction" }, ["", "沒有", "有"].map((o) => el("option", { value: o, text: o || "未填" })))
      ])
    ]),
    el("details", { class: "fold", id: "weightsFold" }, [
      el("summary", { text: "評分權重(進階)" }),
      input("wscreen", "九項初篩權重", { inputmode: "decimal", value: String(state.scoring.w_screen ?? 0.4) }),
      input("wcond", "屋況權重", { inputmode: "decimal", value: String(state.scoring.w_condition ?? 0.35) }),
      input("wprice", "價格權重", { inputmode: "decimal", value: String(state.scoring.w_price ?? 0.25) }),
      el("button", { type: "button", id: "saveW", text: "存權重" })
    ])
  ]);
  $("#sttAllow").value = state.settings.online_transcribe || "否";
  if (state.settings.program_start) $("#progStart").value = state.settings.program_start;
  if (state.settings.goal_commit != null) $("#goalCommit").value = String(state.settings.goal_commit);
  if (state.settings.half_day_hours) $("#halfDay").value = String(state.settings.half_day_hours);
  if (isFlagOn(state.settings.offline_verified)) $("#offlineVerified").checked = true;
  if (state.settings.partner_consent_at) $("#partnerConsentAt").value = state.settings.partner_consent_at;
  if (state.settings.partner_consent_how) $("#partnerConsentHow").value = state.settings.partner_consent_how;
  if (state.settings.commute_measured_min != null) $("#commuteMeasured").value = state.settings.commute_measured_min;
  if (isFlagOn(state.settings.agencies_selected)) $("#agenciesSelected").checked = true;
  if (isFlagOn(state.settings.slot_planned)) $("#slotPlanned").checked = true;
  if (isFlagOn(state.settings.s1_complete)) {
    const n = $("#s1Complete");
    if (n) n.checked = true;
  }
  if (isFlagOn(state.settings.s2_complete)) {
    const n = $("#s2Complete");
    if (n) n.checked = true;
  }
  if (isFlagOn(state.settings.w3_goal_rechecked)) {
    const n = $("#w3GoalRechecked");
    if (n) n.checked = true;
  }
  if (state.settings.course_b_drafts != null && $("#courseBDrafts")) $("#courseBDrafts").value = String(state.settings.course_b_drafts);
  if (state.settings.overtime_hours_used != null && $("#overtimeHours")) $("#overtimeHours").value = String(state.settings.overtime_hours_used);
  if (isFlagOn(state.settings.overtime_consent)) {
    const n = $("#overtimeConsent");
    if (n) n.checked = true;
  }
  if (isFlagOn(state.settings.sop_v2_complete)) $("#sopV2").checked = true;
  if (isFlagOn(state.settings.profile_final)) $("#profileFinal").checked = true;
  if (isFlagOn(state.settings.course_b_complete)) $("#courseBComplete").checked = true;
  if (isFlagOn(state.settings.course_b_core_unknown)) $("#courseBCoreUnknown").checked = true;
  if (isFlagOn(state.settings.combat_self_assess)) $("#combatSelfAssess").checked = true;
  if (isFlagOn(state.settings.s3_complete)) $("#s3Complete").checked = true;
  if (isFlagOn(state.settings.gap_documented)) $("#gapDocumented").checked = true;
  const declSelect = (v) => (isFlagOn(v) ? "有" : v === false || v === "否" ? "沒有" : "");
  if ($("#w10UnknownAsPass")) $("#w10UnknownAsPass").value = declSelect(state.settings.w10_unknown_as_pass);
  if ($("#w10NonSelfAction")) $("#w10NonSelfAction").value = declSelect(state.settings.w10_nonself_action);
  if (state.settings.remaining_weeks_estimate != null && $("#remainingWeeks")) $("#remainingWeeks").value = String(state.settings.remaining_weeks_estimate);
  if (state.settings.goal_commit_choice != null && $("#goalCommitChoice")) $("#goalCommitChoice").value = String(state.settings.goal_commit_choice);
  if (state.settings.course_b_blank_ratio != null && $("#courseBBlank")) $("#courseBBlank").value = String(state.settings.course_b_blank_ratio);
  $("#saveW").onclick = async () => {
    const wn = readNumbers(
      { w_screen: $("#wscreen").value, w_condition: $("#wcond").value, w_price: $("#wprice").value },
      { w_screen: "九項初篩權重", w_condition: "屋況權重", w_price: "價格權重" }
    );
    if (!wn.ok) return;
    const r = await runCommand(() => ctrl.setScoringWeights(wn.patch));
    if (r.ok) render();
  };
  const saveSettings = async (startCooling) => {
    const prevAt = state.settings.partner_consent_at;
    const prevHow = state.settings.partner_consent_how;
    const form = settingsPatchFromForm({
      sttAllow: $("#sttAllow").value,
      progStart: $("#progStart").value || state.settings.program_start,
      goalCommit: $("#goalCommit").value,
      halfDay: $("#halfDay").value,
      offlineVerified: $("#offlineVerified").checked,
      partnerConsentAt: $("#partnerConsentAt").value,
      partnerConsentHow: $("#partnerConsentHow").value,
      commuteMeasured: $("#commuteMeasured").value,
      agenciesSelected: $("#agenciesSelected").checked,
      slotPlanned: $("#slotPlanned").checked,
      sopV2: $("#sopV2").checked,
      profileFinal: $("#profileFinal").checked,
      courseBComplete: $("#courseBComplete").checked,
      courseBCoreUnknown: $("#courseBCoreUnknown").checked,
      combatSelfAssess: $("#combatSelfAssess").checked,
      s3Complete: $("#s3Complete").checked,
      gapDocumented: $("#gapDocumented").checked,
      s1Complete: $("#s1Complete")?.checked,
      s2Complete: $("#s2Complete")?.checked,
      w3GoalRechecked: $("#w3GoalRechecked")?.checked,
      courseBDrafts: $("#courseBDrafts")?.value,
      overtimeHours: $("#overtimeHours")?.value,
      overtimeConsent: $("#overtimeConsent")?.checked,
      remainingWeeks: $("#remainingWeeks")?.value,
      goalCommitChoice: $("#goalCommitChoice")?.value,
      courseBBlank: $("#courseBBlank")?.value,
      w10UnknownAsPass: $("#w10UnknownAsPass")?.value,
      w10NonSelfAction: $("#w10NonSelfAction")?.value
    });
    if (!form.ok) {
      showError(form.errors.map((e) => e.message).join("；"));
      return;
    }
    const patch = form.patch;
    const b01raw = ($("#b01").value || "").trim();
    if (b01raw !== "") {
      patch.finance = { budget_cap_total: b01raw };
      patch.settings.self_entered_cap = true;
    }
    const gated = await ctrl.applyThreshold(patch, { reason: $("#coolReason").value, startCooling });
    if (!gated.ok) {
      if (gated.startedCooling && gated.cooling) {
        showError(`已開始冷靜期，截止 ${gated.cooling.until}`);
        render();
        return;
      }
      if (gated.requiresCooling) {
        showError(`${gated.message || gated.error || "調鬆須冷靜期"}。請填理由後按「開始 7 天冷靜期」。`);
        return;
      }
      showError(gated.message || gated.error);
      return;
    }
    if (Array.isArray(gated.warnings) && gated.warnings.length) {
      showError(gated.warnings.map((w) => w.message || w).join("；"));
    }
    const nextAt = $("#partnerConsentAt").value;
    const nextHow = $("#partnerConsentHow").value;
    if (nextAt && nextHow && (nextAt !== prevAt || nextHow !== prevHow)) {
      try {
        await ctrl.appendAudit({
          type: "partner_consent",
          at: nextAt,
          how: nextHow
        });
      } catch (err) {
        showError(`稽核寫入失敗：${err.message || err}`);
      }
    }
    render();
  };
  $("#saveSet").onclick = () => saveSettings(false);
  $("#startCoolSet").onclick = () => saveSettings(true);
}

function moreSlots() {
  mount(appEl, [
    backLink(),
    el("div", { class: "card" }, [
      el("h2", { text: "看房時段建議（你自己填行程，App 不讀行事曆、不呼叫地圖）" }),
      input("half", "半天（小時）", { inputmode: "decimal" }),
      input("slotStart", "時段開始（HH:MM）"),
      input("slotEnd", "時段結束（HH:MM，選填）"),
      input("outm", "去程分鐘", { inputmode: "numeric" }),
      input("backm", "回程分鐘", { inputmode: "numeric" }),
      input("evStart", "重疊行程開始（HH:MM，選填）"),
      input("evEnd", "重疊行程結束（HH:MM，選填）"),
      el("button", { type: "button", id: "slotBtn", text: "試算" }),
      el("button", { type: "button", id: "slotAdopt", text: "採用這個時段", disabled: true }),
      el("pre", { id: "slotOut" })
    ])
  ]);
  if (!$("#half").value && adoptedHalfDayHours(state.settings)) {
    $("#half").value = String(adoptedHalfDayHours(state.settings));
  }
  let adoptable = null; // 最近一次試算若可採用，記下要存的時段文字
  $("#slotBtn").onclick = () => {
    const start = parseHM($("#slotStart").value);
    const sn = readNumbers({ half: $("#half").value, outm: $("#outm").value, backm: $("#backm").value }, { half: "半天（小時）", outm: "去程分鐘", backm: "回程分鐘" });
    if (!sn.ok) return;
    const half = sn.patch.half ?? adoptedHalfDayHours(state.settings);
    const outm = sn.patch.outm;
    const backm = sn.patch.backm;
    const endHm = parseHM($("#slotEnd")?.value || "");
    if (start === null || half === null || outm === null || backm === null) {
      $("#slotOut").textContent = "資料不足";
      return;
    }
    const slotEnd = endHm !== null ? endHm : start + half * 60;
    const evs = [];
    if ($("#evStart").value || $("#evEnd").value) {
      evs.push({ start: $("#evStart").value, end: $("#evEnd").value });
    }
    // 試算只顯示結果，不寫入任何資料；要採用請按「採用這個時段」
    const trial = slotTrialResult({
      half,
      start,
      end: slotEnd,
      outm,
      backm,
      events: evs,
      areaCode: selectedProperty()?.area_code || String(state.profile?.target_areas || "").split(/[,，]/)[0]?.trim() || "AA01"
    });
    $("#slotOut").textContent = trial.label;
    adoptable = trial.status === "ok" ? `${$("#slotStart").value || formatHM(start)} 至 ${$("#slotEnd")?.value || formatHM(slotEnd)}` : null;
    $("#slotAdopt").disabled = !adoptable;
  };
  $("#slotAdopt").onclick = async () => {
    if (!adoptable) return;
    const picked = adoptable;
    const r = await runCommand(() => ctrl.setSelectedSlot(picked));
    if (r && r.ok === false) return; // 存檔沒成功就不更新草稿
  };
  // 改了任何時段輸入，上一次試算就失效，需要重新試算才能採用
  for (const id of ["half", "slotStart", "slotEnd", "outm", "backm", "evStart", "evEnd"]) {
    $("#" + id)?.addEventListener("input", () => {
      adoptable = null;
      $("#slotAdopt").disabled = true;
    });
  }
}

function moreDrafts() {
  const liveScores = (state.properties || []).map((p) => assessPropertyFromState(state, p.id)).filter((s) => s.ok);
  const list = propertiesForAgentDraft(state.properties, state.finance, liveScores)
    .map((p) => p.id)
    .join("、");
  const agentTxt = agentDraft({
    list,
    conditions: state.profile.layout_note || "",
    slots: (state.selectedSlotText || "").trim() || "時段未選"
  });
  const draftArea = el("textarea", { id: "draft", rows: "4" });
  draftArea.value = systemPartnerText(state, "before");
  let lastSystemDraft = draftArea.value;
  mount(appEl, [
    backLink(),
    el("div", { class: "card" }, [
      el("h2", { text: "訊息草稿掃描" }),
      el("label", { text: "給誰" }, [
        el("select", { id: "rcpt" }, [
          el("option", { value: "partner", text: "共同決策人" }),
          el("option", { value: "agent", text: "仲介" }),
          el("option", { value: "share", text: "分享摘要" }),
          el("option", { value: "upload", text: "上傳包" })
        ])
      ]),
      draftArea,
      el("button", { type: "button", id: "scanBtn", text: "掃描後複製（永不自動送出）" }),
      el("p", { id: "scanOut" }),
      el("label", { text: "共同決策人訊息的時間點" }, [
        el("select", { id: "partnerStage" }, PARTNER_STAGES.map((s) => el("option", { value: s.key, text: s.label })))
      ]),
      el("button", { type: "button", id: "useTemplate", text: "改用範本" }),
      el("h3", { text: "上傳包：逐張勾選現場照片後打包" }),
      el("div", { id: "uploadPick" },
        (state.media || [])
          .filter((m) => m.viewing_id === state.currentViewingId && m.type === "photo" && m.kind !== "visit_doc")
          .map((m) =>
            el("label", { class: "check-item" }, [
              el("input", { type: "checkbox", class: "upPhoto", "data-id": m.id }),
              ` ${m.name || m.id}`
            ])
          )
      ),
      el("button", { type: "button", id: "uploadZip", text: "產生上傳包 zip" }),
      el("p", { class: "hint", text: agentTxt ? `給仲介可用稿：${agentTxt.slice(0, 40)}…` : "資料不足" })
    ])
  ]);
  // 切換收件人或時間點：文字框是空的或仍等於上一份系統稿時才換成新的系統稿，使用者已編輯就不覆蓋
  const refillDraft = () => {
    const cur = $("#draft").value;
    if ($("#rcpt").value !== "partner") {
      if (cur === lastSystemDraft) $("#draft").value = "";
      lastSystemDraft = "";
      return;
    }
    if (cur.trim() === "" || cur === lastSystemDraft) {
      lastSystemDraft = systemPartnerText(state, $("#partnerStage").value);
      $("#draft").value = lastSystemDraft;
    }
  };
  $("#rcpt").onchange = refillDraft;
  $("#partnerStage").onchange = refillDraft;
  $("#useTemplate").onclick = () => {
    if ($("#rcpt").value === "partner") {
      lastSystemDraft = systemPartnerText(state, $("#partnerStage").value);
      $("#draft").value = lastSystemDraft;
    }
  };
  $("#scanBtn").onclick = async () => {
    const rcpt = $("#rcpt").value;
    const userText = ($("#draft").value || "").trim();
    const prepared = prepareOutbound({
      recipient: rcpt,
      state,
      userText: rcpt === "agent" ? userText : userText,
      property: selectedProperty() || {},
      viewing: state.viewings.find((v) => v.id === state.currentViewingId) || {},
      stage: $("#partnerStage")?.value
    });
    if (rcpt === "agent" && !(state.selectedSlotText || state.selectedSlot?.text)) {
      $("#scanOut").textContent = "時段未選，請先在時段建議選定後再複製";
      return;
    }
    // 輸出等於輸入：只有「使用者沒寫、由系統稿補上」時才把系統稿放進文字框，讓人看到實際會複製的內容
    if (prepared.ok && prepared.source === "system") $("#draft").value = prepared.text;
    if (prepared.ok && prepared.needsFill) {
      $("#scanOut").textContent = String(prepared.text).includes("＿＿") ? "還有空格（＿＿）沒填，請先補完再複製" : "這段文字還不能複製，請先照上面的提示補齊資料";
      return;
    }
    if (prepared.ok) {
      const copied = await writeClipboard(prepared);
      $("#scanOut").textContent = copied.ok ? "可複製。請你自己送到訊息 App。" : "剪貼簿寫入失敗";
    } else {
      $("#scanOut").textContent = `被擋：${(prepared.hits || []).map((h) => h.field).join("、")}`;
    }
  };
  $("#uploadZip").onclick = async () => {
    const ids = [...document.querySelectorAll(".upPhoto:checked")].map((i) => i.dataset.id);
    const viewing = state.viewings.find((v) => v.id === state.currentViewingId);
    const pack = await ctrl.buildUploadPack({
      propertyId: viewing?.property_id,
      viewingId: viewing?.id,
      mediaIds: ids
    });
    if (!pack.ok) {
      showError(pack.error || "無法產生上傳包");
      return;
    }
    const dl = downloadZipBytes(pack, "upload-pack.zip");
    $("#scanOut").textContent = dl.ok ? "已產生上傳包 zip" : dl.error;
  };
}

function moreBackup() {
  const passHint = el("p", { class: "hint", id: "passHint" });
  mount(appEl, [
    backLink(),
    el("div", { class: "card" }, [
      el("h2", { text: "加密備份" }),
      el("p", { text: "忘了通關詞就無法解開。資料檔與每一看房批次的媒體包會分成獨立檔案下載。" }),
      el("label", { text: "通關詞" }, [el("input", { id: "pass", type: "password", autocomplete: "new-password" })]),
      passHint,
      input("bakReason", "備份還原理由"),
      el("div", { class: "row" }, [
        el("button", { type: "button", id: "exp", text: "匯出加密備份" }),
        el("button", { type: "button", id: "impb", text: "匯入備份檔（可多選）" }),
        el("button", { type: "button", id: "startCoolBackup", text: "開始 7 天冷靜期" })
      ]),
      el("input", { id: "bakFile", type: "file", accept: "application/json", multiple: true, class: "hidden" }),
      el("p", { id: "bakMsg", class: "hint" })
    ])
  ]);
  $("#pass").oninput = () => {
    passHint.textContent = passphraseStrength($("#pass").value).message;
  };
  $("#exp").onclick = async () => {
    const pass = $("#pass").value;
    const strength = passphraseStrength(pass);
    passHint.textContent = strength.message;
    if (!strength.ok) return;
    try {
      const pack = await ctrl.exportBackup(pass);
      if (!pack.ok) {
        showError(pack.error);
        return;
      }
      for (const d of pack.downloads) downloadJson(d.json, d.filename);
      $("#bakMsg").textContent = exportDoneMessage(pack);
      if (pack.restoreWarning) showWarn(`備份已產生，但請注意：${pack.restoreWarning}`);
    } catch (err) {
      showError(`匯出失敗：${err.message || err}`);
    }
  };
  /** 本機和備份的內容有任何不同時，讓使用者二選一：先另存現況再完全取代，或合併（不會用備份覆蓋這台手機上已有的資料）。 */
  const showRestoreChoice = (diff) => {
    const desc = `${backupDiffSummary(diff)}請選一種處理方式。`;
    mount($("#bakMsg"), [
      el("span", { text: desc }),
      el("button", {
        type: "button",
        id: "bakReplace",
        text: "先自動另存現況，再完全取代",
        onclick: async () => {
          const exp = await ctrl.exportBackup($("#pass").value);
          if (!exp.ok) {
            showError(exp.error || "現況無法另存，已停止還原");
            return;
          }
          for (const d of exp.downloads) downloadJson(d.json, d.filename);
          await doBackupImport(false, "replace");
        }
      }),
      el("button", { type: "button", id: "bakMerge", text: "合併（不會用備份覆蓋這台手機上已有的資料）", onclick: () => doBackupImport(false, "merge") })
    ]);
  };
  const doBackupImport = async (startCooling, mode) => {
    const parsed = pendingBackupFiles;
    if (!parsed?.length) {
      showError("請先選備份檔");
      return;
    }
    const reason = $("#bakReason")?.value || "";
    const restored = await ctrl.importBackupFiles(parsed, $("#pass").value, { reason, schema, startCooling, mode });
    if (restored.needsChoice) {
      showRestoreChoice(restored.diff);
      return;
    }
    if (restored.ok && restored.unchanged) {
      $("#bakMsg").textContent = "備份的內容和這台手機完全相同，不需要還原。";
      pendingBackupFiles = null;
      return;
    }
    if (!restored.ok) {
      if (restored.startedCooling && restored.cooling) {
        showError(`已開始冷靜期，截止 ${restored.cooling.until}`);
        render();
        return;
      }
      if (restored.requiresCooling) {
        showError(`${restored.message || "還原調鬆須冷靜期"}。請填理由後按「開始 7 天冷靜期」。`);
      } else {
        showError(restored.error || restored.message || "還原失敗");
      }
      return;
    }
    refreshState();
    const c = backupCounts(restored.data);
    $("#bakMsg").textContent = `已還原物件 ${c.objects}、照片 ${c.photos}、錄音分片 ${c.audioChunks}。${restored.orphanCount ? `另有 ${restored.orphanCount} 筆對不到看房紀錄的照片或錄音沒有寫入。` : ""}`;
    pendingBackupFiles = null;
    render();
  };
  $("#impb").onclick = () => $("#bakFile").click();
  $("#startCoolBackup").onclick = () => doBackupImport(true);
  $("#bakFile").onchange = async (ev) => {
    const files = [...ev.target.files];
    if (!files.length) return;
    try {
      const parsed = [];
      for (const f of files) {
        const obj = JSON.parse(await f.text());
        const env = validateBackupEnvelope(obj);
        if (!env.ok) {
          showError(env.error);
          return;
        }
        parsed.push(obj);
      }
      pendingBackupFiles = parsed;
      ev.target.value = "";
      await doBackupImport(false);
    } catch (err) {
      showError(`匯入失敗：${err.message || err}`);
    }
  };
}

// ---------------------------------------------------------------------------
// 第 13 輪：口袋大叔（C3、C4、C7）與問價紀錄（C5）
// ---------------------------------------------------------------------------

/** 看房後要回口袋大叔的哪裡（C7）：方法包裡標了 visit_step 為 4 的第一個步驟所在的階段；沒標就用第 4 階段；教練不啟用就沒有。 */
function coachAfterViewingLink() {
  const info = stagesInfo(state.methodPack);
  if (!info.enabled) return null;
  const first = stepsForVisitStep(state.methodPack, 4)[0];
  const order = first ? first.stage_order : info.stages.find((s) => s.order === 4)?.order;
  if (!order) return null;
  return { href: `#coach/${order}`, focusId: first ? `step-${first.id}` : null };
}

/** 跳到某一題：有進行中的看房就到那一題所在的步驟；沒有就先請使用者選一間物件。 */
function goToChecklistItem(itemId) {
  const item = packChecklist(state).find((i) => i && i.id === itemId);
  if (!item) return;
  if (!currentOpenViewing(state)) {
    pushNotice("warn", "先到「看房」選一間物件開始看，才有這一題可以答");
    location.hash = "#visit";
    return;
  }
  ui.focusAfterRender = `item-${itemId}`;
  let hash = `#visit/${item.phase === "看房前" ? 2 : item.phase === "現場" ? 3 : 4}`;
  if (item.phase === "現場") {
    // 現場的題目要到它所在的那一站才畫得出來：用路線站找出是哪一站（可重複的站導到第一間還沒答的那一間）
    const viewing = state.viewings.find((v) => v.id === currentOpenViewing(state).id) || currentOpenViewing(state);
    const prop = state.properties.find((p) => p.id === viewing.property_id) || {};
    const coach = normalizeCoach(state.coach);
    const defs = routeStations(state.methodPack, ctrl.checklistSource(viewing), coach.hidden_items);
    const at = defs.length ? stationIndexForItem(viewing, item, resolveStations(viewing.sites, defs, prop)) : 0;
    if (at > 0) hash = `#visit/3/${at}`;
  }
  if (location.hash === hash) render();
  else location.hash = hash;
}

/** 話術只能顯示與複製，不替使用者送出任何訊息：複製一律先經出口閘門（prepareOutbound）掃描。 */
async function copyScriptLine(line, msgNode) {
  const prepared = prepareOutbound({ recipient: "agent", state, userText: line });
  if (!prepared.ok) {
    if (msgNode) msgNode.textContent = `這一句不能複製：${(prepared.hits || []).map((h) => h.rule || h.field).join("、")}`;
    return;
  }
  const copied = await writeClipboard(prepared);
  if (msgNode) msgNode.textContent = copied.ok ? "已複製。請你自己貼到訊息 App 送出，App 不會替你送。" : "剪貼簿寫入失敗";
}

function scriptCard(sc, msgNode) {
  const section = (title, cls, lines) =>
    lines.length
      ? el("div", { class: `script-sec ${cls}` }, [
          el("h4", { text: title }),
          ...lines.map((line) =>
            el("div", { class: "script-line" }, [
              el("span", { class: "script-text", text: line }),
              el("button", { type: "button", class: "copy-btn", "data-copy": "1", text: "複製", onclick: () => copyScriptLine(line, msgNode) })
            ])
          )
        ])
      : null;
  return el("div", { class: "script-card" }, [
    el("h4", { class: "script-title", text: sc.situation }),
    section("可以這樣說", "say", sc.say),
    section("要問的", "ask", sc.ask),
    section("注意對方說", "listen", sc.listen_for),
    section("不要說", "avoid", sc.avoid)
  ]);
}

function stepRow(st, coach, checklist, isNext = false, openHow = false) {
  const doneDate = coach.steps_done[st.id];
  const box = el("input", { type: "checkbox", "data-step": st.id, id: `stepbox-${st.id}`, "aria-label": st.text });
  box.checked = Boolean(doneDate);
  box.addEventListener("change", async () => {
    const r = await runCommand(() => ctrl.setCoachStepDone(st.id, box.checked), { keepNotices: true });
    if (!r?.ok) box.checked = !box.checked;
    render();
  });
  const link = parseLink(st.links_to, checklist);
  const tags = [
    st.optional ? el("span", { class: "tag", text: "選做" }) : null,
    st.visit_step === 4 ? el("span", { class: "tag ok", "data-after": "1", text: "看房後" }) : null,
    doneDate ? el("span", { class: "tag ok", text: `做完 ${doneDate}` }) : null
  ];
  // F-R14-12：第一個沒做的必要步驟標亮，「怎麼做」直接展開，連結按鈕一眼看得到
  return el("div", { class: `step-row check-item stack${st.visit_step === 4 ? " after-viewing" : ""}${isNext ? " next-step" : ""}`, id: `step-${st.id}`, "data-step-id": st.id, "data-next": isNext ? "1" : undefined, tabindex: "-1" }, [
    isNext ? el("p", { class: "tag ok next-tag", text: "現在做這一步" }) : null,
    el("label", { class: "step-line", for: `stepbox-${st.id}` }, [box, el("span", { class: "step-text", text: st.text })]),
    el("div", { class: "row" }, tags),
    el("details", { class: "fold how", "data-how": st.id, open: isNext && openHow ? true : undefined }, [el("summary", { text: "怎麼做" }), el("p", { text: st.how })]),
    link
      ? el("button", {
          type: "button",
          class: "link-btn",
          "data-link": st.links_to,
          text: link.label,
          onclick: () => {
            if (link.kind === "checklist") goToChecklistItem(link.itemId);
            else location.hash = link.href;
          }
        })
      : null
  ]);
}

function pageCoach(route) {
  const info = stagesInfo(state.methodPack);
  if (!info.enabled) {
    mount(appEl, [
      backLink("#home", "← 回首頁"),
      el("div", { class: "card", id: "coachOff" }, [
        el("h2", { text: "口袋大叔" }),
        el("p", { text: info.present ? "這個方法包的教練內容有地方不對，口袋大叔先不啟用（看房清單照常能用）：" : "目前的方法包沒有教練內容，口袋大叔先不啟用（看房清單照常能用）。" }),
        ...(info.errors.length ? [el("ul", { id: "coachErrors" }, info.errors.slice(0, 8).map((e) => el("li", { text: `${e.stage ? `${e.stage}：` : ""}${e.message}` })))] : [])
      ])
    ]);
    return;
  }
  const coach = normalizeCoach(state.coach);
  const cur = currentStageOf(info.stages, coach);
  const stage = info.stages.find((s) => s.order === route.id) || cur;
  const idx = info.stages.indexOf(stage);
  const prog = stageProgress(stage, coach);
  const checklist = packChecklist(state);
  const copyMsg = el("p", { class: "hint", id: "copyMsg" });
  const nextStepId = nextStepOf(stage, coach)?.id || null;
  const arrivalStep = ui.coachArrival || null;
  ui.coachArrival = null;

  // F-R14-12：八個階段排成一行、可以左右滑動的小格，不再佔滿第一個畫面
  const map = el("div", { class: "card stage-map", id: "stageMap" }, [
    el("p", { class: "hint small", text: `共 ${info.stages.length} 個階段，左右滑動看全部` }),
    el(
      "div",
      { class: "stage-chips strip", id: "stageStrip" },
      info.stages.map((s) => {
        const p = stageProgress(s, coach);
        return el("a", {
          class: `stage-chip${s.id === cur.id ? " on" : ""}${s.id === stage.id ? " viewing" : ""}`,
          href: `#coach/${s.order}`,
          "data-stage": s.order,
          "aria-current": s.id === cur.id ? "step" : undefined,
          text: `第 ${s.order} 階段 ${s.title}　${p.done}/${p.total}`
        });
      })
    )
  ]);

  const noteBox = el("textarea", { id: "noteText", rows: "3", placeholder: "寫下你看到、聽到、想到的重點" });
  const notePick = el("select", { id: "notePick" }, [
    el("option", { value: "", text: "不指定物件" }),
    ...state.properties.map((p) => el("option", { value: p.id, text: p.id }))
  ]);
  const noteMsg = el("p", { class: "hint", id: "noteMsg" });
  const noteSave = el("button", { type: "button", id: "noteSave", text: "存" });
  noteSave.onclick = async () => {
    const r = await runCommand(() => ctrl.addStageNote({ stage_id: stage.id, property_code: notePick.value, text: noteBox.value }));
    if (!r?.ok) return;
    ui.noteFor = notePick.value;
    render();
  };
  if (ui.noteFor && state.properties.some((p) => p.id === ui.noteFor)) notePick.value = ui.noteFor;
  const notes = coach.stage_notes.filter((n) => n.stage_id === stage.id).slice().reverse();
  const noteList = el(
    "div",
    { id: "noteList" },
    notes.map((n) => {
      let armed = false;
      const del = el("button", { type: "button", class: "note-del", text: "刪除" });
      del.onclick = async () => {
        if (!armed) {
          armed = true;
          del.textContent = "再按一次確定刪除";
          return;
        }
        const r = await runCommand(() => ctrl.removeStageNote(n.id));
        if (r?.ok) render();
      };
      return el("div", { class: "note-item", "data-note": n.id }, [
        el("p", { class: "hint", text: `${String(n.at).slice(0, 10)}　${n.property_code ? `物件 ${n.property_code}` : "沒有指定物件"}` }),
        el("p", { class: "note-text", text: n.text }),
        del
      ]);
    })
  );

  // E1：階段建議分鐘與可開關的計時器（只在本機計時，不連網；超過建議時間只提示，不擋任何操作）
  const minutes = stageMinutes(stage);
  const timing = () => Boolean(ui.timer && ui.timer.key === stage.id);
  const timerBtn = el("button", { type: "button", id: "timerBtn", text: timing() ? "停止計時" : "開始計時" });
  const timerText = el("span", { class: "hint", id: "timerText" });
  const timerOver = el("p", { class: "tag warn hidden", id: "timerOver" });
  const paintTimer = () => {
    const tx = $("#timerText");
    if (!tx) {
      if (ui.timerHandle) clearInterval(ui.timerHandle);
      ui.timerHandle = null;
      return;
    }
    const over = $("#timerOver");
    if (!timing()) {
      tx.textContent = "";
      over?.classList.add("hidden");
      return;
    }
    const v = timerView({ startedAt: ui.timer.startedAt, nowMs: Date.now(), minutes });
    tx.textContent = v.text;
    if (over) {
      over.textContent = v.hint;
      over.classList.toggle("hidden", !v.over);
    }
  };
  timerBtn.onclick = () => {
    ui.timer = timing() ? null : { key: stage.id, startedAt: Date.now() };
    timerBtn.textContent = timing() ? "停止計時" : "開始計時";
    paintTimer();
    if (ui.timerHandle) clearInterval(ui.timerHandle);
    ui.timerHandle = null;
    if (timing()) {
      ui.timerHandle = setInterval(paintTimer, 1000);
      ui.timerHandle.unref?.();
    }
  };
  const bar = stepBar([
    el("button", { type: "button", id: "stagePrev", text: "上一階段", disabled: idx <= 0 }),
    el("button", { type: "button", class: "primary", id: "stageDone", text: "完成這階段", disabled: !prog.allRequiredDone }),
    el("button", { type: "button", id: "stageNext", text: "下一階段", disabled: idx >= info.stages.length - 1 })
  ]);

  mount(appEl, [
    stage.review_status === "待安家審" ? el("div", { class: "review-banner", id: "reviewBanner", text: "這段還在顧問審查中,先當參考" }) : null,
    map,
    el("div", { class: "card", id: "stageHead" }, [
      el("h2", { text: `第 ${stage.order} 階段 ${stage.title}` }),
      el("p", { id: "stageGoal", text: stage.goal }),
      minutes > 0 ? el("p", { class: "progress-line", id: "stageMinutes", text: `建議 ${minutes} 分鐘` }) : null,
      el("div", { class: "row", id: "timerRow" }, [timerBtn, timerText]),
      timerOver,
      el("p", { class: "hint", text: `什麼時候進來這一階段：${stage.enter_when}` }),
      el("p", { class: "hint", text: `做到這樣就可以往下：${stage.next_when}` }),
      el("p", { class: "progress-line", id: "stageProgress", text: `已完成 ${prog.done}/${prog.total} 步（必要 ${prog.requiredDone}/${prog.required}）` }),
      stage.id === cur.id
        ? el("p", { class: "tag ok", id: "stageIsCurrent", text: "這是你現在的階段" })
        : el("button", { type: "button", id: "stageSetCurrent", text: "把這裡設為我現在的階段" })
    ]),
    el("div", { class: "card", id: "blockUncle" }, [
      el("h3", { text: "大叔說" }),
      ...(stage.uncle_says.length
        ? stage.uncle_says.map((u) => el("div", { class: "uncle-card" }, [el("p", { class: "uncle-text", text: u.text }), el("p", { class: "uncle-source hint", text: `出處：${u.source}` })]))
        : [el("p", { class: "hint", text: "這一階段沒有原則卡。" })])
    ]),
    el("div", { class: "card", id: "blockSteps" }, [el("h3", { text: "你要做" }), ...stage.steps.map((st) => stepRow(st, coach, checklist, st.id === nextStepId, st.id === arrivalStep))]),
    el("div", { class: "card", id: "blockScripts" }, [
      el("h3", { text: "怎麼說、問什麼" }),
      el("p", { class: "hint", text: "只顯示與複製，不會替你送出。複製之前會先過一次出口檢查。" }),
      ...(stage.scripts.length ? stage.scripts.map((sc) => scriptCard(sc, copyMsg)) : [el("p", { class: "hint", text: "這一階段沒有話術卡。" })]),
      copyMsg
    ]),
    el("div", { class: "card", id: "blockNotes" }, [
      el("h3", { text: "記下來" }),
      ...(stage.record.length ? [el("p", { class: "hint", text: `建議記：${stage.record.join("、")}` })] : []),
      el("label", { text: "關聯物件" }, [notePick]),
      noteBox,
      noteSave,
      noteMsg,
      noteList
    ]),
    el("div", { class: "card stop-card", id: "blockStop" }, [
      el("h3", { text: "停下來的訊號" }),
      ...(stage.stop_signals.length ? [el("ul", {}, stage.stop_signals.map((s) => el("li", { text: s })))] : [el("p", { class: "hint", text: "這一階段沒有特別的停止訊號。" })])
    ]),
    bar
  ]);

  paintTimer();
  if (timing()) {
    ui.timerHandle = setInterval(paintTimer, 1000);
    ui.timerHandle.unref?.();
  }
  $("#stageSetCurrent")?.addEventListener("click", async () => {
    const r = await runCommand(() => ctrl.setCoachStage(stage.id));
    if (r?.ok) render();
  });
  $("#stagePrev").onclick = () => {
    location.hash = `#coach/${info.stages[idx - 1].order}`;
  };
  $("#stageNext").onclick = () => {
    location.hash = `#coach/${info.stages[idx + 1].order}`;
  };
  $("#stageDone").onclick = async () => {
    const r = await runCommand(() => ctrl.completeCoachStage(stage.id));
    if (!r?.ok) return;
    const next = info.stages.find((s) => s.id === r.next);
    if (next) location.hash = `#coach/${next.order}`;
    else render();
  };
}

function pagePriceLog(route) {
  const props = state.properties;
  if (!props.length) {
    mount(appEl, [
      backLink("#more", "← 回「更多」"),
      el("div", { class: "card", id: "plEmpty" }, [el("h2", { text: "問價紀錄" }), el("p", { class: "hint", text: "還沒有物件。先從筆記匯入，或到「看房」新增一間，再來記每一次問價。" })])
    ]);
    return;
  }
  const pickId = route.id && props.some((p) => p.id === route.id) ? route.id : ui.priceLogFor && props.some((p) => p.id === ui.priceLogFor) ? ui.priceLogFor : props[0].id;
  ui.priceLogFor = pickId;
  const pick = el("select", { id: "plPick" }, props.map((p) => el("option", { value: p.id, text: p.id, selected: p.id === pickId })));
  pick.onchange = () => {
    ui.priceLogFor = pick.value;
    location.hash = `#price_log/${encodeURIComponent(pick.value)}`;
  };
  const date = el("input", { id: "plDate", type: "date" });
  date.value = localDate(Date.now());
  const kind = el("select", { id: "plKind" }, PRICE_LOG_KINDS.map((k) => el("option", { value: k, text: k })));
  const amount = el("input", { id: "plAmount", inputmode: "decimal", placeholder: "例如 1180（萬），可以不填" });
  const who = el("input", { id: "plWho", placeholder: "例如 仲介、屋主、我" });
  const note = el("input", { id: "plNote", placeholder: "備註（選填）" });
  const msg = el("p", { class: "hint", id: "plMsg" });
  const save = el("button", { type: "button", class: "primary", id: "plSave", text: "存這一筆" });
  save.onclick = async () => {
    const nums = readNumbers({ amount: amount.value }, { amount: "金額" }, { amount: "wan" });
    if (!nums.ok) return;
    const r = await runCommand(() => ctrl.addPriceLog({ property_id: pickId, date: date.value, kind: kind.value, amount: nums.patch.amount, who: who.value, note: note.value }));
    if (!r?.ok) return;
    render();
  };
  const rows = priceLogFor(state.priceLog, pickId);
  mount(appEl, [
    backLink(`#property/detail/${encodeURIComponent(pickId)}`, "← 回這間物件"),
    el("div", { class: "card", id: "plForm" }, [
      el("h2", { text: "問價紀錄" }),
      el("p", { class: "hint", text: "每一次對方開價、你詢問、你回應、仲介轉述、斡旋，都記一筆。只留在這支手機，不會自動寫進任何給仲介的草稿。" }),
      el("label", { text: "物件" }, [pick]),
      el("label", { text: "日期" }, [date]),
      el("label", { text: "類型" }, [kind]),
      el("label", { text: "金額（萬，選填）" }, [amount]),
      el("label", { text: "誰說的" }, [who]),
      el("label", { text: "備註" }, [note]),
      save,
      msg
    ]),
    el("div", { class: "card", id: "plList" }, [
      el("h3", { text: `${pickId} 的紀錄（最新的在上面）` }),
      ...(rows.length
        ? rows.map((r) => {
            let armed = false;
            const del = el("button", { type: "button", class: "note-del", text: "刪除" });
            del.onclick = async () => {
              if (!armed) {
                armed = true;
                del.textContent = "再按一次確定刪除";
                return;
              }
              const res = await runCommand(() => ctrl.removePriceLog(r.id));
              if (res?.ok) render();
            };
            return el("div", { class: "pl-item", "data-pl": r.id }, [el("p", { class: "pl-line", text: priceLogLine(r) }), del]);
          })
        : [el("p", { class: "hint", text: "這間物件還沒有問價紀錄。" })])
    ])
  ]);
}

function moreExport() {
  const exportMsg = el("p", { id: "exportNotesMsg", class: "hint" });
  mount(appEl, [
    backLink(),
    el("div", { class: "card" }, [
      el("h2", { text: "匯出到筆記" }),
      el("p", { class: "hint", text: "把每間物件的狀態、分數、屋況、功課完成度、複盤文字、問價紀錄，加上口袋大叔的進度與階段筆記，整理成一個檔案，分享到雲端硬碟的「看房同步」資料夾。可承受上限與財務數字、錄音與逐字稿全文、照片本身、共同決策人同意紀錄都不會出現在檔案裡。" }),
      el("button", { type: "button", class: "primary", id: "exportNotes", text: "匯出到筆記" }),
      exportMsg
    ])
  ]);
  $("#exportNotes").onclick = async () => {
    const r = await exportToNotes();
    exportMsg.textContent = r.message;
  };
}

// ---------------------------------------------------------------------------
// 第 13 輪短時高效（E1 到 E7）：建議分鐘與計時器、現場照路線分站、一按作答、自動帶入請確認、防漏清單、客製化增減
// ---------------------------------------------------------------------------

/** 一行「建議大約 N 分鐘」（沒有建議就不放）。 */
function minutesNode(minutes, text, id) {
  return minutes > 0 ? el("p", { class: "hint", id, text }) : null;
}

/** 這間看房還沒答的必做題清單（phase 是看房前、現場、看房後，或 "all"）。 */
function computeMissing(cur, phase) {
  const viewing = state.viewings.find((v) => v.id === cur.id) || cur;
  const items = ctrl.checklistSource(viewing);
  const coach = normalizeCoach(state.coach);
  const prop = state.properties.find((p) => p.id === viewing.property_id) || {};
  const defs = routeStations(state.methodPack, items, coach.hidden_items);
  const stations = defs.length ? resolveStations(viewing.sites, defs, prop) : [];
  return missingItems({ viewing, items, defs, stations }, phase);
}

/** 跳到遺漏清單裡的某一題：到那一步（現場就到那一站），游標落在那一題。 */
function jumpToMissing(m) {
  ui.visit.confirmSkip = false;
  ui.visit.confirmSave = false;
  ui.focusAfterRender = `item-${m.itemId}`;
  const hash = m.step === 3 && m.stationIndex ? `#visit/3/${m.stationIndex}` : `#visit/${m.step}`;
  if (location.hash === hash) render();
  else location.hash = hash;
}

/** 「還漏這幾項」清單卡：每一項點了直接跳過去補。 */
function missingCard(list, intro) {
  return el("div", { class: "card missing-card", id: "missingList" }, [
    el("h3", { text: "還漏這幾項" }),
    el("p", { class: "hint", text: intro }),
    ...list.map((m) =>
      el("button", {
        type: "button",
        class: "missing-item",
        "data-missing": m.itemId,
        "data-station": m.stationKey || "",
        text: missingLine(m),
        onclick: () => jumpToMissing(m)
      })
    )
  ]);
}

/**
 * 看房前與現場的「下一步」確認列（放在固定於畫面底部的那一列）：還差幾項、回去補、先跳過、先跳過並標待核。
 * 清單本身放在頁面最上面（missingCard），這一列只放文字與按鈕，手機上才不會被長清單擠出畫面。
 */
function skipConfirmBar(count, goLabel) {
  return stepBar(
    [
      el("div", { class: "confirm-bar", id: "skipConfirm" }, [
        el("p", { id: "skipText", text: `還差 ${count} 項,之後補也可以` }),
        el("div", { class: "confirm-actions" }, [
          el("button", { type: "button", id: "skipBack", text: "回去補" }),
          el("button", { type: "button", id: "skipPending", text: "先跳過,標待核" }),
          el("button", { type: "button", class: "primary", id: "skipGo", text: goLabel })
        ])
      ])
    ],
    { confirming: true }
  );
}

/** 掛上確認列的三個按鈕。next 是跳過之後要去的網址；phase 是要標待核的範圍。 */
function wireSkipConfirm(cur, phase, nextHash) {
  $("#skipGo")?.addEventListener("click", () => {
    ui.visit.confirmSkip = false;
    location.hash = nextHash;
  });
  $("#skipBack")?.addEventListener("click", () => {
    ui.visit.confirmSkip = false;
    render();
  });
  $("#skipPending")?.addEventListener("click", async () => {
    const list = computeMissing(cur, phase);
    const r = await runCommand(() => ctrl.markMissingPending(cur.id, list.map((m) => ({ itemId: m.itemId, stationKey: m.stationKey }))));
    if (!r?.ok) return;
    ui.visit.confirmSkip = false;
    location.hash = nextHash;
  });
}

/** 離開現場（第 3 步）去看房後：現場必做題有沒答的，先跳出「還漏這幾項」。 */
function tryLeaveOnsite(cur) {
  if (computeMissing(cur, "現場").length) {
    ui.visit.confirmSkip = true;
    ui.scrollTop = true;
    render();
    return;
  }
  ui.visit.confirmSkip = false;
  location.hash = "#visit/4";
}

/** 只拍照的接線（現場頁與每一站共用）；stationKey 有給就把照片記在那一站。 */
function wirePhoto(viewingId, { stationKey } = {}) {
  const btn = $("#photoBtn");
  const file = $("#photoFile");
  if (!btn || !file) return;
  btn.onclick = () => file.click();
  file.onchange = async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    if (isStaleFieldView(ui.fieldViewingId, state.currentViewingId)) {
      staleFieldNotice();
      return;
    }
    const r = await ctrl.takePhoto({ blob: f, name: f.name, viewingId, stationKey });
    refreshState();
    if (!r.ok) showError(r.error);
    updatePhotoCount(viewingId, stationKey);
  };
}

/** 「這次已拍 N 張」（在某一站時，另外說這一站拍了幾張）。 */
function updatePhotoCount(viewingId, stationKey) {
  const n = $("#photoCount");
  if (!n) return;
  const all = state.viewings.find((v) => v.id === viewingId)?.photos || [];
  n.textContent = stationKey ? `這次已拍 ${all.length} 張（這一站 ${all.filter((p) => p.station_key === stationKey).length} 張）` : `這次已拍 ${all.length} 張`;
}

/** 站的完成情形：必做題答了幾題（可重複的站，是這一間答了幾題）。 */
function stationCounts(viewing, st, itemsOf) {
  const core = itemsOf(st).filter((i) => i.core === true);
  return { total: core.length, done: core.filter((i) => answered(viewing, i, st)).length };
}

/** 現場的一題（在某一站、某一間）：選項是大按鈕，選到「有問題」或「嚴重」跳出拍照與一行備註，另有不適用、隱藏選做、刪掉自訂題。 */
function siteItemRow(cur, st, item, { onSaved } = {}) {
  const view = () => state.viewings.find((v) => v.id === cur.id) || cur;
  const key = responseKeyOf(item.id, st);
  const getRec = () => (item.custom ? view().custom_answers?.[key] : view().responses?.[key]) || {};
  const opts = optionsOf(item);
  const wrap = el("div", { class: "check-item stack site-item", id: `item-${item.id}`, "data-item-row": item.id });
  let naOpen = false;
  const save = async (status, value, extra = {}) => {
    const r = await runCommand(() => ctrl.setSiteResponse(cur.id, item.id, st.key, { status, value, ...extra }), { keepNotices: true });
    if (r?.ok) {
      draw();
      onSaved?.();
    }
    return r;
  };
  const draw = () => {
    const rec = getRec();
    const current = String(rec.value ?? rec.status ?? "");
    const kids = [
      el("div", { class: "site-title" }, [el("strong", { text: item.text }), item.core === true ? null : el("span", { class: "tag", text: item.custom ? "自訂" : "選做" })])
    ];
    if (!item.custom && item.how_to_check) kids.push(el("p", { class: "hint", text: item.how_to_check }));
    if (rec.status === "不適用") kids.push(el("p", { class: "tag warn na-tag", text: `已標不適用${rec.reason ? `：${rec.reason}` : ""}` }));
    if (opts) {
      const group = el("div", { class: "choices", "data-item": item.id });
      for (const o of opts) {
        const b = el("button", { type: "button", class: `choice${current === o ? " on" : ""}`, "data-id": item.id, "data-value": o, text: o });
        b.onclick = () => save(o, o, isProblemValue(o) && rec.note ? { note: rec.note } : {});
        group.appendChild(b);
      }
      kids.push(group);
    } else if (item.input_type === "number") {
      const inp = el("input", { inputmode: "decimal", "data-id": item.id, value: rec.value ?? "" });
      inp.onchange = () => {
        const f = readNumbers({ v: inp.value }, { v: item.text }, { v: item.unit === "萬" ? "wan" : item.unit === "元" ? "yuan" : "plain" });
        if (f.ok) save(inp.value.trim() ? "是" : "待核", f.patch.v);
      };
      kids.push(inp);
    } else {
      const inp = el("input", { "data-id": item.id, value: rec.value ?? "", placeholder: "請填原因或說明" });
      inp.onchange = () => save(inp.value.trim() ? "是" : "待核", inp.value);
      kids.push(inp);
    }
    // 選到有問題或嚴重：直接跳出拍照與一行備註
    if (isProblemValue(current)) {
      const msg = el("p", { class: "hint", "data-photo-msg": item.id });
      const photoInput = el("input", { type: "file", accept: "image/*", capture: "environment", class: "hidden", "data-problem-file": item.id });
      photoInput.onchange = async (ev) => {
        const f = ev.target.files[0];
        if (!f) return;
        const r = await ctrl.takePhoto({ blob: f, name: f.name, viewingId: cur.id, stationKey: st.key, itemId: item.id });
        refreshState();
        if (!r.ok) showError(r.error);
        else {
          msg.textContent = "照片已存。";
          updatePhotoCount(cur.id, st.key);
        }
      };
      const note = el("input", { class: "problem-note", "data-note": item.id, placeholder: "一行備註（選填）", value: rec.note ?? "" });
      note.onchange = () => save(rec.status ?? current, rec.value ?? current, { note: note.value.trim() });
      kids.push(
        el("div", { class: "problem-box", "data-problem": item.id }, [
          el("p", { class: "hint", text: "這題有狀況：拍一張照片，再寫一行重點。" }),
          el("button", { type: "button", class: "problem-photo", text: "拍這題的照片", onclick: () => photoInput.click() }),
          photoInput,
          note,
          msg
        ])
      );
    }
    // 其他動作：不適用、隱藏選做、刪掉自訂題
    const actions = [];
    actions.push(
      el("button", { type: "button", class: "na-btn", text: "這題不適用", onclick: () => { naOpen = !naOpen; draw(); } })
    );
    if (item.core !== true && !item.custom) {
      actions.push(
        el("button", {
          type: "button",
          class: "hide-btn",
          text: "隱藏這題（選做）",
          onclick: async () => {
            const r = await runCommand(() => ctrl.setItemHidden(item.id, true), { keepNotices: true });
            if (r?.ok) render();
          }
        })
      );
    }
    if (item.custom) {
      actions.push(
        el("button", {
          type: "button",
          class: "ci-del",
          text: "刪掉這題",
          onclick: async () => {
            const r = await runCommand(() => ctrl.removeCustomItem({ id: item.id }), { keepNotices: true });
            if (r?.ok) render();
          }
        })
      );
    }
    kids.push(el("div", { class: "row item-actions" }, actions));
    if (naOpen) {
      const reason = el("input", { class: "na-reason", placeholder: item.core === true ? "寫一句原因（必做題一定要寫）" : "寫一句原因（選填）" });
      kids.push(
        el("div", { class: "na-box" }, [
          reason,
          el("button", {
            type: "button",
            class: "na-save",
            text: "標不適用",
            onclick: async () => {
              const r = await runCommand(() => ctrl.markItemNotApplicable({ viewingId: cur.id, itemId: item.id, stationKey: st.key, reason: reason.value }), { keepNotices: true });
              if (r?.ok) {
                naOpen = false;
                draw();
                onSaved?.();
              }
            }
          })
        ])
      );
    }
    mount(wrap, kids);
  };
  draw();
  return wrap;
}

/** 現場照路線分站（E2、E3、E7）：一站一頁。idx 是第幾站（從 1 開始）。 */
function visitStationPage(cur, defs, idx) {
  const view = () => state.viewings.find((v) => v.id === cur.id) || cur;
  const prop = state.properties.find((p) => p.id === cur.property_id) || {};
  const coach = normalizeCoach(state.coach);
  const stations = resolveStations(view().sites, defs, prop);
  const total = stations.length;
  const at = Math.min(Math.max(idx, 1), total);
  const st = stations[at - 1];
  const itemsOf = (s) => stationItems(s, { customAll: coach.custom_items, customHere: view().sites?.custom || [], hiddenIds: coach.hidden_items });
  const items = itemsOf(st);
  const stationHash = (n) => `#visit/3/${n}`;
  const chips = el(
    "div",
    { class: "station-chips hidden", id: "stationChips" },
    stations.map((s, i) => {
      const c = stationCounts(view(), s, itemsOf);
      return el("a", {
        class: `stage-chip${i + 1 === at ? " on" : ""}`,
        href: stationHash(i + 1),
        "data-station-chip": s.key,
        text: `${i + 1} ${s.name}（${c.done}/${c.total}）`
      });
    })
  );
  const refreshChips = () => {
    stations.forEach((s, i) => {
      const node = document.querySelector(`[data-station-chip="${s.key}"]`);
      const c = stationCounts(view(), s, itemsOf);
      if (node) node.textContent = `${i + 1} ${s.name}（${c.done}/${c.total}）`;
    });
  };
  const rows = items.map((i) => siteItemRow(cur, st, i, { onSaved: refreshChips }));
  const msg = el("p", { class: "hint", id: "stationMsg" });
  const normalBtn = el("button", { type: "button", class: "normal-all", id: "stationNormal", text: "這站都正常" });
  const nameInput = el("input", { id: "stationName", value: st.name, maxlength: "20" });
  const hiddenNow = st.def.hiddenItems.filter((i) => i.core !== true);
  const removing = ui.visit.removeAsk === st.key;
  const impact = removing ? stationImpact(view(), st) : null;
  // F-R14-13：頂端只有「第 N 站/共 M 站 站名」和一個「全部站」按鈕；全部站與完成數點開才列，大叔提醒與題目在第一個畫面就看得到
  const allBtn = el("button", { type: "button", class: "station-all", id: "stationAll", "aria-expanded": "false", text: "全部站" });
  allBtn.onclick = () => {
    const open = chips.classList.toggle("hidden") === false;
    allBtn.setAttribute("aria-expanded", open ? "true" : "false");
  };
  const stationBar = el("div", { class: "station-bar", id: "stationBar" }, [
    el("strong", { class: "station-pos", id: "stationPos", text: `第 ${at} 站/共 ${total} 站 ${st.name}` }),
    allBtn
  ]);
  const nodes = [
    removing
      ? el("div", { class: "card confirm-card", id: "removeConfirm" }, [
          el("h3", { text: `要刪掉「${st.name}」嗎？` }),
          el("p", { id: "removeImpact", text: `會一起刪掉：${impact.answers} 題答案、${impact.photos} 張照片。刪掉就找不回來。` }),
          el("button", { type: "button", id: "removeYes", text: "確定刪掉" }),
          el("button", { type: "button", id: "removeNo", text: "不刪" })
        ])
      : null,
    stationBar,
    chips,
    el("div", { class: "card", id: "stationCard", "data-station": st.key }, [
      // 站名與第幾站已經在頂端那一行；這兩個保留給輔助與舊的找法，不佔畫面
      el("h2", { class: "hidden", id: "stationTitle", text: st.name }),
      el("p", { class: "hidden", id: "stationIndex", text: `第 ${at} 站，共 ${total} 站` }),
      minutesNode(st.def.minutes, `這一站建議大約 ${st.def.minutes} 分鐘`, "stationMinutes"),
      ...st.def.tips.map((t) => el("div", { class: "tip-card", text: t })),
      normalBtn,
      msg,
      ...rows,
      el("details", { class: "fold", id: "addItemFold" }, [
        el("summary", { text: "加一題" }),
        el("label", { text: "題目" }, [el("input", { id: "ciText", placeholder: "例如 有沒有聞到霉味" })]),
        el("label", { text: "選項（用逗號分開，不填就是 正常、有問題、待查）" }, [el("input", { id: "ciOptions", placeholder: "正常,有問題,待查" })]),
        el("label", { text: "要問幾次" }, [
          el("select", { id: "ciScope" }, [el("option", { value: "this", text: "只這間" }), el("option", { value: "all", text: "以後每間都問" })])
        ]),
        el("button", { type: "button", id: "ciAdd", text: "加這一題" })
      ]),
      hiddenNow.length
        ? el("details", { class: "fold", id: "hiddenFold" }, [
            el("summary", { text: `已隱藏 ${hiddenNow.length} 題選做` }),
            ...hiddenNow.map((i) =>
              el("div", { class: "check-item" }, [
                el("span", { text: i.text }),
                el("button", {
                  type: "button",
                  class: "unhide-btn",
                  "data-unhide": i.id,
                  text: "取消隱藏",
                  onclick: async () => {
                    const r = await runCommand(() => ctrl.setItemHidden(i.id, false), { keepNotices: true });
                    if (r?.ok) render();
                  }
                })
              ])
            )
          ])
        : null,
      el("details", { class: "fold", id: "stationTools" }, [
        el("summary", { text: "調整這一站（改名、換順序、增減間數）" }),
        el("label", { text: "站名" }, [nameInput]),
        el("button", { type: "button", id: "stationRename", text: "改站名" }),
        st.key === CATCH_ALL_KEY
          ? null
          : el("div", { class: "row" }, [
              el("button", { type: "button", id: "stationUp", text: "往前移", disabled: at <= 1 }),
              el("button", { type: "button", id: "stationDown", text: "往後移", disabled: at >= total || stations[at]?.key === CATCH_ALL_KEY })
            ]),
        st.def.repeatable
          ? el("div", { class: "row" }, [
              el("button", { type: "button", id: "stationAdd", text: "再加一間" }),
              el("button", { type: "button", id: "stationRemove", class: "danger", text: "刪掉這間" })
            ])
          : null
      ])
    ]),
    el("p", { class: "hint", id: "photoCount", text: `這次已拍 ${(view().photos || []).length} 張（這一站 ${(view().photos || []).filter((p) => p.station_key === st.key).length} 張）` }),
    el("button", { type: "button", class: "fab", id: "photoBtn", text: "拍照" }),
    el("input", { id: "photoFile", type: "file", accept: "image/*", capture: "environment", class: "hidden" })
  ];
  const last = at >= total;
  const confirming = ui.visit.confirmSkip && last && computeMissing(cur, "現場").length > 0;
  let bar;
  if (confirming) {
    bar = skipConfirmBar(computeMissing(cur, "現場").length, "先跳過，到看房後");
    nodes.unshift(missingCard(computeMissing(cur, "現場"), "點一項就跳過去補；不想現在補，可以先跳過並標成待核（還不確定，之後要查）。"));
  } else {
    bar = stepBar([
      el("button", { type: "button", id: "stepBack", text: at <= 1 ? "回到場確認" : "上一站" }),
      el("button", { type: "button", class: "primary", id: "stepNext", text: last ? "下一步" : "下一站" })
    ]);
  }
  return {
    nodes,
    bar,
    after() {
      wirePhoto(cur.id, { stationKey: st.key });
      if (!view().sites) {
        // 第一次走到站：依物件的房數、衛浴數把站建起來（沒有數字就先建 1 間），建好再重畫一次
        runCommand(() => ctrl.ensureSites(cur.id), { keepNotices: true }).then((r) => {
          if (r?.ok && !r.none) {
            refreshState();
            render();
          }
        });
      }
      $("#stepBack")?.addEventListener("click", () => {
        location.hash = at <= 1 ? "#visit/3" : stationHash(at - 1);
      });
      $("#stepNext")?.addEventListener("click", () => {
        if (last) tryLeaveOnsite(cur);
        else location.hash = stationHash(at + 1);
      });
      if (confirming) wireSkipConfirm(cur, "現場", "#visit/4");
      normalBtn.onclick = async () => {
        const r = await runCommand(() => ctrl.markStationNormal(cur.id, st.key), { keepNotices: true });
        if (!r?.ok) return;
        // F-R14-16：固定一行，說清楚幫你填了幾題、還有幾題一票否決類（碰到就直接淘汰的條件）要逐題按
        ui.stationMsg = `已幫你填 ${r.filled} 題;有 ${r.skippedVeto?.length || 0} 題一票否決類要逐題按`;
        render();
      };
      if (ui.stationMsg) {
        msg.textContent = ui.stationMsg;
        ui.stationMsg = "";
      }
      $("#stationRename").onclick = async () => {
        const r = await runCommand(() => ctrl.renameStation(cur.id, st.key, nameInput.value), { keepNotices: true });
        if (r?.ok) render();
      };
      $("#stationUp")?.addEventListener("click", async () => {
        const r = await runCommand(() => ctrl.moveStation(cur.id, st.key, -1), { keepNotices: true });
        if (r?.ok) location.hash = stationHash(at - 1);
      });
      $("#stationDown")?.addEventListener("click", async () => {
        const r = await runCommand(() => ctrl.moveStation(cur.id, st.key, 1), { keepNotices: true });
        if (r?.ok) location.hash = stationHash(at + 1);
      });
      $("#stationAdd")?.addEventListener("click", async () => {
        const r = await runCommand(() => ctrl.addStation(cur.id, st.stepId), { keepNotices: true });
        if (!r?.ok) return;
        refreshState();
        const now = resolveStations(state.viewings.find((v) => v.id === cur.id)?.sites, defs, prop);
        const where = now.findIndex((s) => s.key === r.key);
        location.hash = stationHash(where >= 0 ? where + 1 : at);
      });
      $("#stationRemove")?.addEventListener("click", () => {
        ui.visit.removeAsk = st.key;
        ui.scrollTop = true;
        render();
      });
      $("#removeNo")?.addEventListener("click", () => {
        ui.visit.removeAsk = null;
        render();
      });
      $("#removeYes")?.addEventListener("click", async () => {
        const r = await runCommand(() => ctrl.removeStation(cur.id, st.key, { confirmed: true }));
        ui.visit.removeAsk = null;
        if (!r?.ok) return;
        location.hash = stationHash(Math.max(1, at - 1));
        render();
      });
      $("#ciAdd").onclick = async () => {
        const r = await runCommand(() => ctrl.addCustomItem({ viewingId: cur.id, stepId: st.stepId, text: $("#ciText").value, options: $("#ciOptions").value, scope: $("#ciScope").value }), { keepNotices: true });
        if (r?.ok) render();
      };
    }
  };
}

/** 現場第一頁（有路線站時）：先確認開價、坪數、車位與屋況，再看這間有幾個房間與浴室，然後開始走路線。 */
function routeOverviewCard(cur, defs) {
  const view = () => state.viewings.find((v) => v.id === cur.id) || cur;
  const prop = state.properties.find((p) => p.id === cur.property_id) || {};
  const coach = normalizeCoach(state.coach);
  const stations = resolveStations(view().sites, defs, prop);
  const itemsOf = (s) => stationItems(s, { customAll: coach.custom_items, customHere: view().sites?.custom || [], hiddenIds: coach.hidden_items });
  const built = Boolean(view().sites);
  const roomsInput = el("input", { id: "sRooms", inputmode: "numeric", value: prop.rooms ?? "", placeholder: "幾間房" });
  const bathsInput = el("input", { id: "sBaths", inputmode: "numeric", value: prop.baths ?? "", placeholder: "幾間浴室" });
  const save = async (field, input, label) => {
    const nums = readNumbers({ [field]: input.value }, { [field]: label });
    if (!nums.ok) return;
    const r = await runCommand(() => ctrl.saveFieldInputs(cur.property_id, nums.patch), { keepNotices: true });
    if (r?.ok) render();
  };
  roomsInput.onchange = () => save("rooms", roomsInput, "房數");
  bathsInput.onchange = () => save("baths", bathsInput, "衛浴數");
  return [
    el("div", { class: "card", id: "countsCard" }, [
      el("h2", { text: "這間有幾個房間、幾間浴室？" }),
      el("label", { text: "房數" }, [roomsInput]),
      el("label", { text: "衛浴數" }, [bathsInput]),
      el("p", { class: "hint", id: "countsHint", text: built ? "路線已經建好了。要增減，請到那一站按「再加一間」或「刪掉這間」。" : "按「開始走路線」時，會依這兩個數字建立對應數量的站；沒有填就先各建 1 間。" })
    ]),
    el("div", { class: "card", id: "routeCard" }, [
      el("h2", { text: `現場路線（${stations.length} 站）` }),
      el("p", { class: "hint", text: "一站一頁，照順序走；每一站的大叔提醒與要答的題目都在那一頁。" }),
      el(
        "div",
        { class: "station-chips" },
        stations.map((s, i) => {
          const c = stationCounts(view(), s, itemsOf);
          return el("a", { class: "stage-chip", href: `#visit/3/${i + 1}`, "data-station-chip": s.key, text: `${i + 1} ${s.name}（${c.done}/${c.total}）` });
        })
      )
    ])
  ];
}

boot();
