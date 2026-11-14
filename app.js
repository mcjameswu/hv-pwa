import * as db from "./db.js";
import { loadImportSchema, setImportSchema } from "./js/schema.js";
import { splitList, joinList } from "./js/lists.js";
import { diffDataset } from "./js/merge.js";
import { parseSheetCsv, sheetsToImportJson, mergeWithCurrent } from "./js/csv.js";
import { readXlsx } from "./js/xlsx.js";
import { scoreProperty, priceDropToCapReminder, propertiesForAgentDraft, isStretchProperty, assessPropertyFromState, latestAnswerClearsVeto, orderedViewings } from "./js/scoring.js";
import { runAffordability, DOWN_PENDING } from "./js/affordability.js";
import { scanDraft, whitelistUploadPack } from "./js/scanner.js";
import { prepareOutbound, writeClipboard, downloadOutbound, displayDiffChanges, downloadBackupJson, downloadZipBytes, systemPartnerText } from "./js/egress.js";
import { parseHM, formatHM } from "./js/slots.js";
import { countViewing, uniqueCounted, w3OnsiteAudit, sameDaySoftWarning } from "./js/counting.js";
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
import { validateMethodPack } from "./js/method-pack.js";
import { canEnableOnlineStt, auditSttEnable, createBrowserStt, sttMayStart } from "./js/speech.js";
import { APP_VERSION, DEFAULT_SCORING, CONDITION_KEYS, CONDITION_LABELS, FIELD_LABELS } from "./js/defaults.js";
import { el, mount } from "./js/dom.js";
import { applyThresholdChange, parseThresholdNumber, fieldLabel } from "./js/thresholds.js";
import { isFlagOn, SCREEN_BINDINGS } from "./js/fields.js";
import { collectNumericForm, settingsPatchFromForm, scoreLineText, scoreBreakdownText, sheetRowsToCsvText, trustLabel, weekOf, hasOfferFlag, onsiteQuickItems, isRevealed, nextReveal, slotTrialResult, visitFormModel, bannerModel, afterCommand, noticesFromResult, backupDiffSummary, exportDoneMessage, numberHint, propertySelfFitLine, compareRankedText, affordLines, makeVisitDraftSaver, isStaleFieldView, afterReload } from "./js/ui-logic.js";
import { rankEligible } from "./js/rank-eligible.js";
import { applyGatedThresholdChange } from "./js/validate.js";
import { createController } from "./js/controller.js";
import { financeTrust } from "./js/finance-trust.js";

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
  tabNotice: "",
  _recStopExpected: false
};
let pendingBackupFiles = null;
let lastImportFile = null; // 匯入預覽解鎖或遮住時，要用同一個檔案重畫預覽
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

async function loadGeneric() {
  try {
    const res = await fetch("./methods/generic/method.json");
    if (!res.ok) throw new Error("無法載入通用方法包");
    return await res.json();
  } catch (err) {
    showError(`方法包載入失敗：${err.message || err}，仍可繼續使用已存資料`);
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
  }
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
    if (blank) msgs.push("上限待填：請在設定裡由本人手打可承受總價上限。");
    const visRed = state.visits.some((v) => vis17RedFlag(v).red);
    if (visRed) msgs.push("紅旗：已簽文件含服務費或排除他店條款。");
    if (!ui.httpsLive) msgs.push("目前不是 https，W0「計畫開跑」不能勾。本機開發除外。");
    if (state.cooling?.until) {
      msgs.push(`冷靜期至 ${state.cooling.until}，欄位 ${fieldLabel(state.cooling.field)}。`);
    }
    if (ui.tabNotice) msgs.push(ui.tabNotice);
    standingDanger = !!(blank || visRed);
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

function nav() {
  document.querySelectorAll(".nav a").forEach((a) => {
    const h = location.hash || "#home";
    a.classList.toggle("active", a.getAttribute("href") === h);
  });
}

function render() {
  visitDraftSaver?.flushPending(); // 換頁前，還在等待的門市草稿先送出（F9-07）
  refreshState();
  nav();
  showBanner();
  const page = (location.hash || "#home").slice(1);
  // 換頁一律收起私密數字
  if (ui.lastPage !== null && ui.lastPage !== page) ui.reveal = nextReveal(ui.reveal, { type: "tab" });
  ui.lastPage = page;
  const map = {
    home: pageHome,
    import: pageImport,
    field: pageField,
    property: pageProperty,
    agency: pageAgency,
    compare: pageCompare,
    aff: pageAff,
    more: pageMore
  };
  (map[page] || pageHome)();
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
  if (issue.table === "finance" || issue.table === "settings" || issue.table === "profile" || issue.table === "scoring") return "#more";
  if (issue.table === "areas" || issue.table === "agents" || issue.table === "travel") return "#import";
  if (issue.table === "visits") return "#agency";
  return "#property";
}

function pageHome() {
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
  const vaultBtn = el("button", { type: "button", id: "toggleVault", text: isRevealed(ui.reveal, "home") ? "重新遮住" : "長按顯示" });
  const issues = typeof ctrl.getLoadIssues === "function" ? ctrl.getLoadIssues() : [];
  mount(appEl, [
    issues.length
      ? el("div", { class: "card", id: "loadIssues" }, [
          el("h2", { class: "danger-text", text: `有 ${issues.length} 項資料需要修正` }),
          el("p", { class: "hint", text: "這些是舊資料裡不合目前規則的地方。不影響你繼續記錄，但修正後計算才會準。" }),
          ...issues.map((i) => el("p", {}, [`${i.message}　`, el("a", { href: issueHref(i), text: "去修正" })]))
        ])
      : null,
    el("div", { class: "card" }, [
      el("h2", { text: "進度" }),
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
    ]),
    el("div", { class: "card" }, [
      el("h2", { text: "私密區" }),
      el("p", {}, [
        "可承受上限（萬）：",
        el("span", { class: isRevealed(ui.reveal, "home") ? "" : "mask", text: mask(state.finance.budget_cap_total, "home") }),
        financeTrust(state.finance, state.finance_meta) === "unverified" ? ` ${trustLabel("unverified")}` : ""
      ]),
      el("p", { class: "hint", text: "畫面預設遮住。不進摘要與草稿。請長按才顯示。" }),
      vaultBtn
    ]),
    el("div", { class: "card" }, [
      el("h2", { text: "今日注意" }),
      el("p", { text: "App 不送出任何訊息、出價或付款。草稿請你自己複製去送。" }),
      el("p", { text: "唯一對外連線：你手動打開的線上即時轉文字。" })
    ])
  ]);
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

function pageImport() {
  const preview = el("div", { id: "preview" });
  const restoreMsg = el("p", { class: "hint", id: "restoreMsg" });
  const reason = el("input", { id: "restoreReason", placeholder: "調鬆理由" });
  mount(appEl, [
    el("div", { class: "card" }, [
      el("h2", { text: "匯入表格或方法包" }),
      el("p", { class: "hint", text: "可選 JSON、各分頁 CSV，或 Excel（.xlsx）。上限這一格若在檔裡，不會直接寫入，要你自己再打一次。" }),
      el("label", { text: "選檔" }, [el("input", { id: "file", type: "file", accept: ".json,.csv,.xlsx,application/json" })]),
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
  $("#file").onchange = onFile;
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
    box.appendChild(el("li", { text: `${e.level || "註"}：${label} ${e.message}` }));
  }
  return box;
}

async function onFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  lastImportFile = file;
  const buf = await file.arrayBuffer();
  const preview = $("#preview");
  let data;
  try {
    if (file.name.endsWith(".json")) data = JSON.parse(new TextDecoder().decode(buf));
    else if (file.name.endsWith(".xlsx")) {
      const { sheets } = await readXlsx(buf);
      const parsed = {};
      const map = { A設定: "settings", B財務: "finance", C輪廓: "profile", D區域: "areas", E評分: "scoring", F仲介: "agents", G自住適配: "travel", G通勤: "travel" };
      let matched = 0;
      for (const [name, rows] of Object.entries(sheets)) {
        const key = map[name];
        if (!key) continue;
        matched += 1;
        const csv = sheetRowsToCsvText(rows);
        const p = parseSheetCsv(key, csv);
        if (!p.ok) throw new Error(p.errors[0].message);
        parsed[key] = p.records;
      }
      if (!matched) throw new Error("Excel 沒有可辨識的分頁名稱，已拒收");
      data = mergeWithCurrent(sheetsToImportJson(parsed), state);
    } else if (file.name.endsWith(".csv")) {
      const text = new TextDecoder().decode(buf);
      const tryKeys = ["settings", "finance", "profile", "areas", "scoring", "agents", "travel"];
      let parsed = null;
      for (const k of tryKeys) {
        const p = parseSheetCsv(k, text);
        if (p.ok) {
          parsed = { [k]: p.records };
          break;
        }
      }
      if (!parsed) throw new Error("無法辨識 CSV 分頁");
      data = mergeWithCurrent(sheetsToImportJson(parsed), state);
    } else throw new Error("不支援的檔名");
  } catch (err) {
    mount(preview, [el("p", { class: "banner danger", text: String(err.message || err) })]);
    return;
  }
  if (data.checklist) {
    const v = validateMethodPack(data);
    const kids = v.ok
      ? [
          el("p", { text: `方法包「${data.meta?.title || ""}」可載入，${data.checklist.length} 項。` }),
          el("button", { class: "primary", id: "applyPack", text: "確認載入方法包" })
        ]
      : [el("p", { text: v.errors.map((er) => er.message).join("；") })];
    mount(preview, kids);
    $("#applyPack")?.addEventListener("click", async () => {
      await ctrl.loadMethodPack(data);
      render();
    });
    return;
  }
  const hash = await sha256hex(new Uint8Array(buf));
  const report = ctrl.previewImport(data, schema, { reason: $("#restoreReason")?.value });
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
  const confirm = el("button", {
    class: "primary",
    id: "confirmImport",
    disabled: !(report.ok && !report.unchanged),
    text: "確認寫入"
  });
  const coolBtn = report.canStartCooling
    ? el("button", { type: "button", id: "startCoolImport", text: "登記調鬆理由並開始 7 天冷靜期" })
    : null;
  const changeList = displayDiffChanges(report.diff || [], { vaultOpen: isRevealed(ui.reveal, "import") }).map((d) => d.text);
  const diffVaultBtn = el("button", { type: "button", id: "diffVault", text: isRevealed(ui.reveal, "import") ? "重新遮住" : "長按顯示完整變更" });
  mount(preview, [
    el("p", { text: report.ok ? "驗證通過（仍請看預覽）" : "有錯誤，已擋下" }),
    listMessages(report),
    changeList.length ? el("p", { text: "變更預覽" }) : null,
    changeList.length ? el("ul", {}, changeList.map((t) => el("li", { text: t }))) : null,
    changeList.length ? diffVaultBtn : null,
    typedB01,
    suggestBox,
    report.unchanged ? el("p", { text: "沒有變更" }) : null,
    confirm,
    coolBtn
  ]);
  bindLongPress(diffVaultBtn, () => {
    ui.reveal = nextReveal(ui.reveal, { type: "reveal", scope: "import" });
    onFile({ target: { files: [lastImportFile] } });
  });
  diffVaultBtn.onclick = () => {
    if (isRevealed(ui.reveal, "import")) {
      ui.reveal = nextReveal(ui.reveal, { type: "conceal" });
      onFile({ target: { files: [lastImportFile] } });
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
      startCooling
    });
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
      showError(applied.message || "門檻調鬆須冷靜期");
      return;
    }
    location.hash = "#home";
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

function checklistRow(i, v) {
  const rec = v?.responses?.[i.id] || {};
  const opts = i.options && i.options.length ? i.options : ["是", "否", "不適用", "待核"];
  const save = (status, value) => {
    if (!v) return;
    // 一律明確帶「畫面上這一間」的看房代號，不靠「目前選定」，快速切換看房也不會寫到前一間（F9-08）
    runCommand(() => ctrl.setChecklistResponse(i.id, { status, value }, v.id)).then(() => {
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
    return el("div", { class: "check-item" }, [
      el("span", {}, [el("strong", { text: i.text }), el("br"), el("span", { class: "hint", text: i.how_to_check || "" })]),
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
    return el("div", { class: "check-item" }, [el("span", {}, [el("strong", { text: i.text })]), inp]);
  }
  if (i.input_type === "text") {
    const inp = el("input", { value: rec.value ?? "", "data-id": i.id, placeholder: "請填原因或說明" });
    inp.onchange = () => save(inp.value ? "是" : "待核", inp.value);
    return el("div", { class: "check-item" }, [el("span", {}, [el("strong", { text: i.text })]), inp]);
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
    return el("div", { class: "check-item" }, [el("span", {}, [el("strong", { text: i.text })]), sel]);
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
  return el("div", { class: "check-item" }, [
    el("span", {}, [el("strong", { text: i.text }), el("br"), el("span", { class: "hint", text: i.how_to_check || "" })]),
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

function pageProperty() {
  const pack = state.methodPack;
  mount(appEl, [
    el("div", { class: "card" }, [
      el("h2", { text: "物件資料" }),
      viewingPicker(() => render()),
      input("pcode", "物件代號", { placeholder: "例如 A01，不要寫門牌" }),
      input("parea", "區域代號", { placeholder: "AA01" }),
      input("prooms", "房數", { inputmode: "numeric" }),
      input("ptype", "產品類型", { placeholder: "大樓" }),
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
      input("pschoolyear", "學區適用學年度", { inputmode: "numeric" }),
      input("pfake", "假價格警訊項數", { inputmode: "numeric" }),
      input("pfakealt", "假價格替代解釋"),
      input("page", "屋齡（年）", { inputmode: "numeric" }),
      el("label", { text: "管理費（元／月，可寫 1萬 或 3千）" }, [el("input", { id: "pmgmt" }), el("span", { class: "hint", id: "pmgmtHint" })]),
      input("pprev", "前次開價（萬，選填）", { inputmode: "decimal" }),
      el("label", { text: "一票否決命中（逗號分隔）" }, [el("input", { id: "pdeal", placeholder: "例如 嚴重漏水" })]),
      el("button", { class: "primary", id: "addProp", text: "新增物件並開始看房" }),
      el("button", { type: "button", id: "saveProp", text: "存成目前物件" })
    ]),
    el("div", { class: "card" }, [
      el("h2", { text: "看房前／看房後清單" }),
      el("div", { id: "otherList" }),
      el("button", { class: "primary", id: "savePost", text: "看房後存檔並評分" })
    ]),
    el("div", { class: "card", id: "propList" })
  ]);
  fillPropForm(selectedProperty());
  const showMgmtHint = () => {
    const hint = $("#pmgmtHint");
    if (hint) hint.textContent = numberHint($("#pmgmt")?.value, "yuan");
  };
  $("#pmgmt")?.addEventListener("input", showMgmtHint);
  showMgmtHint();
  const v = state.viewings.find((x) => x.id === state.currentViewingId);
  const source = ctrl.checklistSource(v);
  const other = source.filter((i) => i.phase !== "現場");
  mount($("#otherList"), other.map((i) => checklistRow(i, v)));
  const kids = [el("h2", { text: "已存物件" })];
  if (!state.properties.length) kids.push(el("p", { text: "尚未新增" }));
  for (const p of state.properties) {
    const vs = state.viewings.filter((x) => x.property_id === p.id);
    const c = vs.map((x) => countViewing(x, p, pack).counts);
    const sc = assessPropertyFromState(state, p.id);
    const alerts = (sc?.alerts || []).join("；");
    kids.push(
      el("p", {
        text: `${p.id}　${p.area_code || ""}　開價 ${p.ask_total ?? "待核"}　持有年數 ${p.hold_years ?? "待核"}　交通 ${p.transit_status || "待核"}／${p.walk_mode || "待核"}　時間點 ${p.timing_score ?? "待核"}　學區 ${p.school_zone_claimed || "無"}（${p.school_zone_verified || "待核"} ${p.school_zone_verified_date || ""}）　計入：${c.some(Boolean) ? "是" : "否"}　評分：${scoreLineText(sc)}${alerts ? `　提醒：${alerts}` : ""}`
      }),
      scoreBreakdownText(sc) ? el("p", { class: "hint", text: `評分來源：${scoreBreakdownText(sc)}` }) : null,
      el("p", { class: "hint", text: propertySelfFitLine(state, p) }),
      el("button", {
        type: "button",
        text: "接續這筆",
        onclick: async (ev) => {
          const btn = ev.currentTarget;
          const latest = vs.at(-1);
          if (!latest) {
            // 這間還沒有看房紀錄：不跳頁，提示並提供「新增看房」
            showWarn("這間還沒有看房紀錄");
            if (![...btn.parentElement.querySelectorAll(".add-viewing")].some((b) => b.dataset.pid === p.id)) {
              btn.after(
                el("button", {
                  type: "button",
                  class: "add-viewing",
                  "data-pid": p.id,
                  text: "新增看房",
                  onclick: async () => {
                    const added = await runCommand(() => ctrl.addViewing(p.id, "初看"));
                    if (added?.ok) location.hash = "#field";
                  }
                })
              );
            }
            return;
          }
          btn.disabled = true; // 等「選定這間」存完才跳到現場頁
          const r = await runCommand(() => ctrl.selectViewing(latest.id));
          btn.disabled = false;
          if (!r?.ok) return;
          location.hash = "#field";
        }
      })
    );
  }
  mount($("#propList"), kids);
  $("#addProp").onclick = async () => {
    stopStt();
    const form = readPropForm();
    if (!form.ok) return;
    const r = await ctrl.addProperty(form.fields);
    if (!r.ok) {
      showError((r.errors || []).map((e) => e.message).join("；") || "無法新增");
      return;
    }
    location.hash = "#field";
    render();
  };
  $("#saveProp").onclick = async () => {
    const p = selectedProperty();
    if (!p) {
      showError("請先新增或選定物件");
      return;
    }
    const form = readPropForm();
    if (!form.ok) return;
    const raw = form.fields;
    const { patch, changedKeys } = diffPropForm(p, raw);
    const r = await ctrl.updateProperty(p.id, { ...patch, id: raw.id }, { changedKeys: [...changedKeys, "id"] });
    if (!r.ok) showError((r.errors || []).map((e) => e.message).join("；") || r.error);
    else render();
  };
  $("#savePost").onclick = async () => {
    const r = await ctrl.scoreCurrent();
    if (!r.ok) {
      showError(r.error || "無法評分");
      return;
    }
    const prop = selectedProperty();
    const drop = priceDropToCapReminder(prop, state.finance);
    if (drop) showError(drop);
    render();
  };
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
  set("#prooms", p.rooms);
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
      rooms: $("#prooms")?.value,
      walk_min: $("#pwalkmin")?.value,
      hold_years: $("#phold")?.value,
      commute_min: $("#pcommute")?.value,
      timing_score: $("#ptiming")?.value,
      school_zone_year: $("#pschoolyear")?.value,
      fake_alerts: $("#pfake")?.value,
      age: $("#page")?.value,
      mgmt_fee_yuan: $("#pmgmt")?.value,
      prev_ask_total: $("#pprev")?.value
    },
    {
      rooms: "房數",
      walk_min: "步行分鐘",
      hold_years: "可持有年數",
      commute_min: "到強勢辦公區分鐘",
      timing_score: "時間點分數",
      school_zone_year: "學區適用學年度",
      fake_alerts: "假價格警訊項數",
      age: "屋齡",
      mgmt_fee_yuan: "管理費",
      prev_ask_total: "前次開價"
    },
    { mgmt_fee_yuan: "yuan", prev_ask_total: "wan" }
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

function pageMore() {
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
  const passHint = el("p", { class: "hint", id: "passHint" });
  mount(appEl, [
    el("div", { class: "card" }, [
      el("h2", { text: "設定" }),
      el("label", { text: "線上轉文字允許" }, [
        el("select", { id: "sttAllow" }, [el("option", { value: "否", text: "否" }), el("option", { value: "是", text: "是" })])
      ]),
      input("progStart", "計畫開始日", { type: "date" }),
      el("label", { text: "可承受上限（萬，本人手打）" }, [el("input", { id: "b01", inputmode: "decimal", placeholder: "可填 1500、1,500、1500萬" })]),
      el("label", { text: "已採用半天長度" }, [
        el("select", { id: "halfDay" }, [
          el("option", { value: "", text: "未採用" }),
          el("option", { value: "3.5", text: "3.5 小時" }),
          el("option", { value: "4", text: "4 小時" })
        ])
      ]),
      el("label", { class: "check-item" }, [
        el("input", { type: "checkbox", id: "offlineVerified" }),
        " 離線實測已通過"
      ]),
      input("partnerConsentAt", "共同決策人同意日期", { type: "date" }),
      input("partnerConsentHow", "共同決策人同意方式"),
      input("commuteMeasured", "實測單程分鐘", { inputmode: "numeric" }),
      el("label", { class: "check-item" }, [
        el("input", { type: "checkbox", id: "agenciesSelected" }),
        " 第一組三家已選並查過營業時間"
      ]),
      el("label", { class: "check-item" }, [
        el("input", { type: "checkbox", id: "slotPlanned" }),
        " 下週看房半天已用時段規則決定"
      ]),
      el("h3", { text: "W6 檢查點證據" }),
      el("label", { class: "check-item" }, [
        el("input", { type: "checkbox", id: "s1Complete" }),
        " 安全里程碑 S1 已完成"
      ]),
      el("label", { class: "check-item" }, [
        el("input", { type: "checkbox", id: "s2Complete" }),
        " 安全里程碑 S2 已完成"
      ]),
      el("label", { class: "check-item" }, [
        el("input", { type: "checkbox", id: "w3GoalRechecked" }),
        " W3 的 45 或 50 決定已複核"
      ]),
      el("h3", { text: "W3 檢查點證據" }),
      input("remainingWeeks", "剩七週推估 remaining_weeks_estimate", { inputmode: "decimal" }),
      el("label", { text: "45 或 50 最終決定 goal_commit_choice" }, [
        el("select", { id: "goalCommitChoice" }, [
          el("option", { value: "", text: "未決定" }),
          el("option", { value: "45", text: "45" }),
          el("option", { value: "50", text: "50" })
        ])
      ]),
      input("courseBBlank", "課程 B 空白比例 course_b_blank_ratio", { inputmode: "decimal" }),
      input("courseBDrafts", "課程 B 十張表初稿張數", { inputmode: "numeric" }),
      input("overtimeHours", "本週已用工時（小時）", { inputmode: "decimal" }),
      el("label", { class: "check-item" }, [
        el("input", { type: "checkbox", id: "overtimeConsent" }),
        " 加碼超過工時上限已經本人同意"
      ]),
      el("h3", { text: "W10 結案證據" }),
      el("label", { class: "check-item" }, [
        el("input", { type: "checkbox", id: "sopV2" }),
        " 個人看房 SOP v2 已完成"
      ]),
      el("label", { class: "check-item" }, [
        el("input", { type: "checkbox", id: "profileFinal" }),
        " 理想輪廓已定稿"
      ]),
      el("label", { class: "check-item" }, [
        el("input", { type: "checkbox", id: "courseBComplete" }),
        " 課程 B 盤點表已補完"
      ]),
      el("label", { class: "check-item" }, [
        el("input", { type: "checkbox", id: "courseBCoreUnknown" }),
        " 課程 B 核心欄位仍有 UNKNOWN"
      ]),
      el("label", { class: "check-item" }, [
        el("input", { type: "checkbox", id: "combatSelfAssess" }),
        " 實戰課準備度自評已填"
      ]),
      el("label", { class: "check-item" }, [
        el("input", { type: "checkbox", id: "s3Complete" }),
        " 安全里程碑 S3 已完成"
      ]),
      el("label", { class: "check-item" }, [
        el("input", { type: "checkbox", id: "gapDocumented" }),
        " 看房間數差距已明寫"
      ]),
      el("label", { text: "有沒有把「待核」寫成「通過」" }, [
        el("select", { id: "w10UnknownAsPass" }, ["", "沒有", "有"].map((o) => el("option", { value: o, text: o || "未填" })))
      ]),
      el("label", { text: "有沒有出現不是本人做的出價、申貸或付款紀錄" }, [
        el("select", { id: "w10NonSelfAction" }, ["", "沒有", "有"].map((o) => el("option", { value: o, text: o || "未填" })))
      ]),
      input("coolReason", "調鬆理由"),
      input("bakReason", "備份還原理由"),
      state.cooling?.until ? el("p", { text: `冷靜期截止：${state.cooling.until}，欄位 ${fieldLabel(state.cooling.field)}，理由：${state.cooling.reason || "未填"}` }) : null,
      el("button", { class: "primary", id: "saveSet", text: "存設定" }),
      el("button", { type: "button", id: "startCoolSet", text: "開始 7 天冷靜期" })
    ]),
    el("div", { class: "card" }, [
      el("h2", { text: "評分權重" }),
      input("wscreen", "九項初篩權重", { inputmode: "decimal", value: String(state.scoring.w_screen ?? 0.4) }),
      input("wcond", "屋況權重", { inputmode: "decimal", value: String(state.scoring.w_condition ?? 0.35) }),
      input("wprice", "價格權重", { inputmode: "decimal", value: String(state.scoring.w_price ?? 0.25) }),
      el("button", { type: "button", id: "saveW", text: "存權重" })
    ]),
    el("div", { class: "card" }, [
      el("h2", { text: "理想輪廓" }),
      el("p", { text: `目標區域：${state.profile.target_areas || "未填"}` }),
      el("p", { text: `最少房數：${state.profile.rooms_min || "未填"}　偏好：${state.profile.rooms_preferred || "未填"}` }),
      el("p", { text: `一票否決：${state.profile.deal_breaker || "未填"}` }),
      el("p", { class: "hint", text: "POST 回寫須你確認才寫入，不會自動改。" })
    ]),
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
    ]),
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
    ]),
    el("div", { class: "card" }, [
      el("h2", { text: "加密備份" }),
      el("p", { text: "忘了通關詞就無法解開。資料檔與每一看房批次的媒體包會分成獨立檔案下載。" }),
      el("label", { text: "通關詞" }, [el("input", { id: "pass", type: "password", autocomplete: "new-password" })]),
      passHint,
      el("div", { class: "row" }, [
        el("button", { type: "button", id: "exp", text: "匯出加密備份" }),
        el("button", { type: "button", id: "impb", text: "匯入備份檔（可多選）" }),
        el("button", { type: "button", id: "startCoolBackup", text: "開始 7 天冷靜期" })
      ]),
      el("input", { id: "bakFile", type: "file", accept: "application/json", multiple: true, class: "hidden" }),
      el("p", { id: "bakMsg", class: "hint" })
    ]),
    el("div", { class: "card" }, [
      el("h2", { text: "隱私" }),
      el("p", { text: `沒有分析、遙測或廣告。版本 app-v${APP_VERSION}。課程方法包不會打進託管版本。` })
    ])
  ]);
  $("#sttAllow").value = state.settings.online_transcribe || "否";
  if (state.settings.program_start) $("#progStart").value = state.settings.program_start;
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
  $("#pass").oninput = () => {
    passHint.textContent = passphraseStrength($("#pass").value).message;
  };
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
    const live = ctrl.scanAgentDraft();
    if ($("#rcpt")?.value === "agent") {
      $("#draft").value = live.text;
    }
  };
  // 改了任何時段輸入，上一次試算就失效，需要重新試算才能採用
  for (const id of ["half", "slotStart", "slotEnd", "outm", "backm", "evStart", "evEnd"]) {
    $("#" + id)?.addEventListener("input", () => {
      adoptable = null;
      $("#slotAdopt").disabled = true;
    });
  }
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
  if ($("#uploadZip")) {
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
    const reason = $("#bakReason")?.value || $("#coolReason")?.value || "";
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

boot();
