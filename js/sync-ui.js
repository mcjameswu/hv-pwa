/**
 * 雲端同步的執行器與「雲端同步」頁(S1 同步,F-S1-24、F-S1-26)。
 * 白話:這個檔案做三件事。一、同步執行器:決定什麼時候上傳(存檔後等 30 秒、離開畫面、網路恢復、按「立即同步」)、什麼時候下載、失敗後隔多久再試,
 * 任何同步錯誤都不會讓存檔失敗或畫面卡住。二、「更多」裡的「雲端同步」頁。三、網址含 -test 時在頂端顯示「測試站」標籤。
 * 預設關閉:沒有設定、或是關掉開關,這個檔案不會發出任何網路請求(連探測都不會),除非使用者在同步頁按了「檢查這個網址能不能同步」。
 * 下載來的內容只能交給控制器的 applyDeskSync(它走既有的合併規則);「對方手機的結果」只放在記憶體,不寫進本機資料。
 */
import { el, mount } from "./dom.js";
import { call as netCall } from "./sync-net.js";
import { openEnvelope, generateSyncPassphrase, syncPassphraseStrength, SYNC_ENV_RE } from "./sync-crypto.js";
import { planDownload, nextRetryMs, peerResultRows, ROLE_TITLES } from "./sync-engine.js";

export const SYNC_TEXT = {
  offline: "離線,恢復後自動同步",
  paused: "同步暫停:雲端暫時無法使用,稍後會自動再試",
  blocked: "有內容被擋,未上傳",
  closed: "保險箱已關閉,請輸入新密語",
  gone: "雲端保險箱不存在,或這支手機的密語已失效,請重新設定同步",
  syncing: "同步中…",
  disabled: "同步已關閉(這支手機不會連網)",
  unsupported: "這個網址不支援自動同步。要用自動同步請改用另一個網址開啟 App;手動匯出匯入在這裡照常可用。",
  rejected: "雲端內容不合規格,已拒絕",
  rollback: "雲端資料比上次看到的還舊,先不採用"
};

const ROLE_OPTIONS = [
  ["owner", "我的手機"],
  ["partner", "共同決策人的手機"],
  ["desk", "電腦"]
];

function pad(n) {
  return String(n).padStart(2, "0");
}

/** 把時間字串轉成「11/15 10:20」(手機本地時間);沒有就回空字串。 */
export function formatSyncTime(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// 同步執行器
// ---------------------------------------------------------------------------

/**
 * 建立同步執行器。ctrl 是控制器;net、now、setTimer、clearTimer、win、doc 都可以注入(測試用假時鐘與假網路)。
 * 觸發:存檔(防抖動 30 秒)、App 進入背景(有待上傳就立刻試一次,用 keepalive)、打開 App、回前景超過 5 分鐘、網路恢復、按「立即同步」。
 */
export function createSyncRunner({
  ctrl,
  net = netCall,
  now = () => Date.now(),
  setTimer = (fn, ms) => {
    const h = setTimeout(fn, ms);
    if (h && typeof h.unref === "function") h.unref(); // Node 測試環境:計時器不要拖住程序結束
    return h;
  },
  clearTimer = (h) => clearTimeout(h),
  win = globalThis.window,
  doc = globalThis.document,
  debounceMs = 30000,
  recheckMs = 300000
} = {}) {
  let enabled = false;
  let configured = false;
  let pendingMarked = false;
  let debounceHandle = null;
  let retryHandle = null;
  let attempt = 0;
  let running = null;
  let again = null;
  let lastCheckAt = 0;
  let started = false;
  const peers = new Map();
  const listeners = new Set();
  const view = { state: "idle", text: "", error: null, blocked: null, notice: "", pendingDesk: null, lastUploadAt: null, lastDownloadAt: null };

  const emit = () => {
    for (const fn of [...listeners]) {
      try {
        fn();
      } catch {
        /* 畫面更新出錯不影響同步 */
      }
    }
  };
  const setView = (patch) => {
    Object.assign(view, patch);
    emit();
  };
  const iso = () => new Date(now()).toISOString();
  const clearTimers = () => {
    if (debounceHandle !== null) clearTimer(debounceHandle);
    if (retryHandle !== null) clearTimer(retryHandle);
    debounceHandle = null;
    retryHandle = null;
  };

  async function refresh() {
    const st = await ctrl.syncStatus();
    if (!st || st.ok === false) return st;
    configured = st.configured === true;
    enabled = configured && st.enabled === true;
    pendingMarked = st.pendingUpload === true;
    view.lastUploadAt = st.lastUploadAt || view.lastUploadAt;
    view.lastDownloadAt = st.lastDownloadAt || view.lastDownloadAt;
    if (!enabled) {
      clearTimers();
      attempt = 0;
      if (view.state === "syncing") view.state = "idle";
    }
    if (!configured) peers.clear();
    emit();
    return st;
  }

  function schedule(ms, reason) {
    retryHandle = setTimer(() => {
      retryHandle = null;
      void syncNow({ reason });
    }, ms);
  }

  function markPending() {
    if (pendingMarked) return;
    pendingMarked = true;
    Promise.resolve(ctrl.syncRecord({ pending_upload: true })).catch(() => {});
  }

  /** 控制器每次提交成功都會通知這裡(同步的本機資料變動只更新開關狀態,其他變動才排上傳)。 */
  function notify(name) {
    try {
      if (name === "syncPutLocal") {
        void refresh().catch(() => {});
        return;
      }
      if (!enabled) return;
      markPending();
      if (debounceHandle !== null) clearTimer(debounceHandle);
      debounceHandle = setTimer(() => {
        debounceHandle = null;
        void syncNow({ reason: "commit" });
      }, debounceMs);
    } catch {
      /* 同步通知出錯不影響存檔 */
    }
  }

  /** 同步還開著嗎(讀本機狀態,不連網)。使用者在請求進行中關閉同步時,後面的步驟都不准再發請求或掛計時器(F-S1B-01)。 */
  async function stillOn() {
    try {
      const s = await ctrl.syncStatus();
      const on = !!(s && s.ok !== false && s.configured === true && s.enabled === true);
      if (!on) {
        enabled = false;
        clearTimers();
        attempt = 0;
      }
      return on;
    } catch {
      return false;
    }
  }

  async function failed(kind, r) {
    if (!(await stillOn())) {
      if (view.state === "syncing") setView({ state: "idle", text: "" });
      return { ok: true, skipped: true, reason: "disabled" };
    }
    attempt += 1;
    const text = kind === "offline" ? SYNC_TEXT.offline : SYNC_TEXT.paused;
    view.error = kind;
    Promise.resolve(ctrl.syncRecord({ pending_upload: true, last_error: kind })).catch(() => {});
    pendingMarked = true;
    setView({ state: kind, text });
    const ms = nextRetryMs(attempt);
    if (ms !== null) schedule(ms, "retry");
    return { ok: false, kind, status: r?.status || 0 };
  }

  async function handleDesk(slot, opened, patch, choices, confirm) {
    const r = await ctrl.applyDeskSync(opened.payload, { choices, confirm });
    if (r.ok === false) {
      patch.seen[slot.slot_id] = slot.seq;
      setView({ notice: SYNC_TEXT.rejected, pendingDesk: null });
      return;
    }
    const parts = [];
    if (r.areasSkipped) setView({ notice: "電腦傳來的區域功課這次套用不上,先只套用待看物件" });
    if (r.created) parts.push(`新增 ${r.created} 間`);
    if (r.updated) parts.push(`更新 ${r.updated} 間`);
    if (r.areas) parts.push(`區域功課 ${r.areas} 個`);
    if (r.needsConfirm || r.needsDecision > 0) {
      setView({
        pendingDesk: { slot_id: slot.slot_id, seq: slot.seq, payload: opened.payload, needsConfirm: r.needsConfirm === true, conflicts: r.conflicts || [], needsDecision: r.needsDecision || 0 },
        notice: parts.length ? `已套用:${parts.join("、")}` : view.notice
      });
      return;
    }
    patch.seen[slot.slot_id] = slot.seq;
    setView({ pendingDesk: null, notice: parts.length ? `已套用:${parts.join("、")}` : view.notice });
  }

  async function cycle({ reason, keepalive }) {
    const st = await ctrl.syncStatus({ withKeys: true });
    if (!st || st.ok === false || !st.configured || !st.enabled) {
      await refresh();
      return { ok: true, skipped: true };
    }
    enabled = true;
    configured = true;
    const k = st.keys;
    const hdr = { "X-Sync-Access": k.access };
    lastCheckAt = now();
    setView({ state: "syncing", text: SYNC_TEXT.syncing });

    // 一、上傳
    let up = await ctrl.buildSyncUpload();
    if (up.blocked) {
      setView({ blocked: up.error || SYNC_TEXT.blocked });
    } else if (up.ok === false) {
      setView({ error: "build" });
    } else {
      view.blocked = null;
      if (up.skipped) {
        if (pendingMarked) {
          pendingMarked = false;
          await ctrl.syncRecord({ pending_upload: false });
        }
      } else {
        const path = `vaults/${k.vault_id}/slots/${k.slot_id}`;
        let put = await net("PUT", path, { headers: { ...hdr, "X-Sync-Write": k.write_token }, body: up.envelope, keepalive: keepalive === true });
        if (!put.ok && put.status === 409 && put.error === "seq_conflict") {
          // 雲端的版本號比本機記的大(例如本機資料重設過):以雲端的為準再試一次
          // 重試前先確認同步還開著(F-S1C-04):關閉了就不再送任何請求
          if (!(await stillOn())) return { ok: true, skipped: true, reason: "disabled" };
          const list = await net("GET", `vaults/${k.vault_id}/slots`, { headers: hdr });
          const mine = list.ok ? (list.body.slots || []).find((s) => s.slot_id === k.slot_id) : null;
          if (mine && Number.isInteger(mine.seq)) {
            await ctrl.syncRecord({ my_seq: mine.seq });
            up = await ctrl.buildSyncUpload();
            if (up.ok && !up.skipped && !(await stillOn())) return { ok: true, skipped: true, reason: "disabled" };
            if (up.ok && !up.skipped) put = await net("PUT", path, { headers: { ...hdr, "X-Sync-Write": k.write_token }, body: up.envelope, keepalive: keepalive === true });
          }
        }
        if (put.ok) {
          pendingMarked = false;
          const at = iso();
          await ctrl.syncRecord({ my_seq: up.seq, last_hash: up.hash, pending_upload: false, last_upload_at: at, last_error: null });
          view.lastUploadAt = at;
        } else if (put.closed || put.status === 410) {
          await ctrl.syncRecord({ last_error: "closed" });
          setView({ state: "closed", text: SYNC_TEXT.closed, error: "closed" });
          return { ok: false, kind: "closed" };
        } else {
          return failed(put.offline ? "offline" : "paused", put);
        }
      }
    }

    // 二、下載
    if (!(await stillOn())) return { ok: true, skipped: true, reason: "disabled" };
    const list = await net("GET", `vaults/${k.vault_id}/slots`, { headers: hdr });
    if (!list.ok) {
      if (list.closed || list.status === 410) {
        await ctrl.syncRecord({ last_error: "closed" });
        setView({ state: "closed", text: SYNC_TEXT.closed, error: "closed" });
        return { ok: false, kind: "closed" };
      }
      if (list.status === 404) {
        // 保險箱已不存在(例如換密語刪舊成功但建新失敗):不要顯示成連不上雲端(F-S1C-03)
        await ctrl.syncRecord({ last_error: "gone" });
        setView({ state: "gone", text: SYNC_TEXT.gone, error: "gone" });
        return { ok: false, kind: "gone" };
      }
      return failed(list.offline ? "offline" : "paused", list);
    }
    const remote = Array.isArray(list.body.slots) ? list.body.slots : [];
    const plan = planDownload(remote, st.local.seen, k.slot_id);
    if (plan.rollback.length) setView({ notice: SYNC_TEXT.rollback });
    const want = new Map(plan.fetch.map((s) => [s.slot_id, s]));
    for (const s of remote) {
      if (s.slot_id !== k.slot_id && s.kind === "phone_notes" && !peers.has(s.slot_id) && !want.has(s.slot_id) && !plan.rollback.some((x) => x.slot_id === s.slot_id)) want.set(s.slot_id, s);
    }
    for (const gone of [...peers.keys()]) if (!remote.some((s) => s.slot_id === gone)) peers.delete(gone);
    const patch = { seen: {} };
    let fetched = 0;
    for (const s of want.values()) {
      if (view.pendingDesk && view.pendingDesk.slot_id === s.slot_id && view.pendingDesk.seq === s.seq) continue;
      if (!(await stillOn())) return { ok: true, skipped: true, reason: "disabled" };
      const got = await net("GET", `vaults/${k.vault_id}/slots/${s.slot_id}`, { headers: hdr });
      if (!got.ok) {
        if (got.offline || got.status >= 500 || got.limited) return failed(got.offline ? "offline" : "paused", got);
        continue;
      }
      fetched += 1;
      const opened = await openEnvelope({ v: got.body.v, kind: got.body.kind, seq: got.body.seq, iv: got.body.iv, ct: got.body.ct }, { env: st.env, vault_id: k.vault_id, slot_id: s.slot_id, enc: k.enc });
      if (!opened.ok) {
        setView({ notice: "有一份雲端內容解不開,已略過" });
        continue;
      }
      const slot = { slot_id: s.slot_id, seq: got.body.seq };
      if (opened.kind === "desk_import") {
        await handleDesk(slot, opened, patch, {}, false);
      } else {
        peers.set(s.slot_id, { slot_id: s.slot_id, role: opened.role, label: opened.device_label, createdAt: opened.created_at, rows: peerResultRows(opened.payload) });
        patch.seen[s.slot_id] = slot.seq;
      }
    }
    if (fetched || Object.keys(patch.seen).length) {
      const at = iso();
      view.lastDownloadAt = at;
      await ctrl.syncRecord({ seen: patch.seen, last_download_at: at, last_error: null });
    } else {
      await ctrl.syncRecord({ last_error: null });
    }
    attempt = 0;
    setView({ state: view.blocked ? "blocked" : "ok", text: view.blocked ? SYNC_TEXT.blocked : "", error: null });
    return { ok: true, reason };
  }

  /** 立刻同步一次(先上傳待傳的,再下載);同一時間只跑一個,跑的時候又被叫就在它結束後再補一次。 */
  function syncNow({ reason = "manual", keepalive = false } = {}) {
    if (!enabled && reason !== "manual" && reason !== "setup") return Promise.resolve({ ok: true, skipped: true });
    if (reason !== "retry") attempt = 0;
    if (running) {
      again = { reason, keepalive };
      return running;
    }
    clearTimers();
    running = (async () => {
      try {
        return await cycle({ reason, keepalive });
      } catch {
        return failed("paused", null);
      }
    })().finally(() => {
      running = null;
      if (again) {
        const next = again;
        again = null;
        void syncNow(next);
      }
    });
    return running;
  }

  function onOnline() {
    if (enabled) void syncNow({ reason: "online" });
  }

  function onVisibility() {
    if (!enabled) return;
    const hidden = doc?.visibilityState === "hidden" || doc?.hidden === true;
    if (hidden) {
      if (pendingMarked) void syncNow({ reason: "hidden", keepalive: true });
    } else if (now() - lastCheckAt > recheckMs) {
      void syncNow({ reason: "foreground" });
    }
  }

  /** 開始:先讀本機狀態;已開啟才會同步一次(打開 App 的那次)。沒開啟就什麼都不做。 */
  async function start() {
    if (started) return;
    started = true;
    win?.addEventListener?.("online", onOnline);
    doc?.addEventListener?.("visibilitychange", onVisibility);
    await refresh();
    if (enabled) void syncNow({ reason: "open" });
  }

  function stop() {
    started = false;
    clearTimers();
    win?.removeEventListener?.("online", onOnline);
    doc?.removeEventListener?.("visibilitychange", onVisibility);
  }

  /** 檢查這個網址能不能同步:只打一次 health,失敗不重試。 */
  async function checkHealth() {
    const r = await net("GET", "health");
    if (r.ok && r.body?.ok === true && typeof r.body.env === "string" && SYNC_ENV_RE.test(r.body.env)) return { ok: true, env: r.body.env };
    return { ok: false, offline: r.offline === true, unsupported: !r.offline, message: r.offline ? "連不上網路,請確認網路後再試" : SYNC_TEXT.unsupported };
  }

  /** 使用者對「有 N 項要你決定」或「區域行情有變」做了選擇:帶著選擇再套用一次。 */
  async function resolveDesk({ choices = {}, confirm = true } = {}) {
    const p = view.pendingDesk;
    if (!p) return { ok: false };
    const patch = { seen: {} };
    await handleDesk({ slot_id: p.slot_id, seq: p.seq }, { payload: p.payload }, patch, choices, confirm);
    if (Object.keys(patch.seen).length) await ctrl.syncRecord({ seen: patch.seen });
    return { ok: true };
  }

  async function dismissDesk() {
    const p = view.pendingDesk;
    if (!p) return;
    await ctrl.syncRecord({ seen: { [p.slot_id]: p.seq } });
    setView({ pendingDesk: null, notice: "已先不套用這次的電腦內容" });
  }

  /** 換密語:用新密語建立新的保險箱(要開通碼),成功後刪掉舊的;其他裝置下次同步會看到「保險箱已關閉」。 */
  async function rotate({ passphrase, enrollCode }) {
    const old = await ctrl.syncStatus({ withKeys: true });
    if (!old.configured) return { ok: false, error: "還沒設定雲端同步" };
    // 先驗新密語強度(F-S1C-05):太弱就直接回錯誤,不刪雲端舊保險箱、本機設定不變
    const strength = syncPassphraseStrength(passphrase);
    if (!strength.ok) return { ok: false, weak: true, error: strength.message };
    // 先確定舊保險箱真的刪掉(F-S1B-02):刪除沒成功就停在這裡,本機維持舊設定,不建新的
    const del = await net("DELETE", `vaults/${old.keys.vault_id}`, { headers: { "X-Sync-Access": old.keys.access, "X-Sync-Admin": old.keys.admin } });
    const gone = del.ok === true || del.status === 404 || del.status === 410 || del.closed === true;
    if (!gone) return { ok: false, error: "舊的雲端資料沒刪掉,密語沒換。請確認網路後再試一次;這支手機仍用舊密語同步。" };
    const r = await ctrl.syncSetup({ passphrase, mode: "create", enrollCode, role: old.role, replace: true });
    if (!r.ok) return { ...r, error: `${r.error || "新密語沒設定成功"}(舊的雲端資料已刪除,請修正後再按一次「換密語」)` };
    peers.clear();
    await refresh();
    void syncNow({ reason: "setup" });
    return { ok: true };
  }

  return {
    start,
    stop,
    refresh,
    notify,
    syncNow,
    checkHealth,
    resolveDesk,
    dismissDesk,
    rotate,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    status: () => ({ ...view, configured, enabled }),
    /** 目前沒有同步在跑(測試與頁面用:等一輪同步完整結束)。 */
    async whenIdle() {
      while (running) await running;
    },
    peers: () => [...peers.values()]
  };
}

// ---------------------------------------------------------------------------
// 模組層級的單一執行器(App 啟動時建立)
// ---------------------------------------------------------------------------

let active = null;

/** 控制器的提交通知(app.js 把它接到 createController 的 onCommitted)。 */
export function onCommitted(name) {
  active?.runner.notify(name);
}

/** 網址的主機名稱含 -test 就是測試站(純本機判斷,不連網)。 */
export function isTestSite(loc = globalThis.location) {
  return String(loc?.hostname || "").includes("-test");
}

function markTestSite(doc = globalThis.document, loc = globalThis.location) {
  if (!isTestSite(loc) || !doc || doc.getElementById?.("testSiteTag")) return;
  const header = doc.querySelector?.("header.app");
  if (!header) return;
  const tag = el("span", { id: "testSiteTag", class: "test-site-tag", text: "測試站" });
  header.insertBefore(tag, header.firstChild);
}

/** App 載入完成後呼叫一次:建立同步執行器並開始(沒開啟同步就什麼都不做),網址含 -test 時顯示「測試站」標籤。 */
export function onAppReady({ ctrl, rerender } = {}) {
  markTestSite();
  Object.assign(page, { form: null, health: null, message: "", confirmWipe: false, confirmLeave: false, busy: false });
  if (!ctrl || typeof ctrl.syncStatus !== "function") return null;
  if (active) active.runner.stop();
  const runner = createSyncRunner({ ctrl });
  active = { ctrl, runner, rerender };
  // 執行器的狀態有變、而且同步頁正顯示著,就重畫(畫的途中又有變動會合併)
  runner.onChange(() => {
    if (!page.mount) return;
    if (drawing) {
      dirty = true;
      return;
    }
    if (page.mount.container?.querySelector?.("#syncStatusLine")) void drawCoalesced();
  });
  void runner.start().catch(() => {});
  return runner;
}

// ---------------------------------------------------------------------------
// 「雲端同步」頁
// ---------------------------------------------------------------------------

const page = { form: null, health: null, message: "", confirmWipe: false, confirmLeave: false, busy: false, mount: null };

function statusLine(st, run) {
  if (!st.configured) return "尚未設定。預設關閉,這支手機現在完全不連網。";
  if (!st.enabled) return SYNC_TEXT.disabled;
  if (run.state === "syncing") return SYNC_TEXT.syncing;
  if (run.state === "offline" || st.lastError === "offline") return SYNC_TEXT.offline;
  if (run.state === "paused") return SYNC_TEXT.paused;
  if (run.state === "closed" || st.lastError === "closed") return SYNC_TEXT.closed;
  if (run.state === "gone" || st.lastError === "gone") return SYNC_TEXT.gone;
  if (run.blocked) return SYNC_TEXT.blocked;
  const up = formatSyncTime(run.lastUploadAt || st.lastUploadAt);
  return `已開啟,上次上傳:${up || "還沒有"}`;
}

/** 提供日後主線的「和筆記同步」卡呼叫:在 container 裡加一行雲端同步狀態與連到同步頁的連結。 */
export function renderCloudSyncRow(container, status = {}) {
  const text = status.text || (status.configured ? (status.enabled ? "雲端同步:已開啟" : SYNC_TEXT.disabled) : "雲端同步:尚未設定");
  const row = el("div", { class: "cloud-sync-row" }, [el("span", { class: "hint", text }), " ", el("a", { href: "#sync", text: "雲端同步" })]);
  container?.appendChild(row);
  return row;
}

function roleRadios(selected) {
  return el("div", { class: "field", id: "syncRoles" }, [
    el("div", { class: "hint", text: "這支裝置是誰的(只能從這三個選)" }),
    ...ROLE_OPTIONS.map(([value, label]) =>
      el("label", { class: "check" }, [el("input", { type: "radio", name: "syncRole", value, checked: value === selected }), ` ${label}`])
    )
  ]);
}

function pickedRole(root) {
  return [...root.querySelectorAll('input[name="syncRole"]')].find((i) => i.checked)?.value || "owner";
}

function setupForm(ctx, st) {
  const mode = page.form;
  const strength = el("p", { class: "hint", id: "syncStrength", text: "" });
  const pass = el("input", {
    type: "text",
    id: "syncPass",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    "aria-label": "同步密語",
    placeholder: mode === "join" ? "輸入同一組同步密語" : "按下面的按鈕產生,或自己輸入(至少 16 個字元)",
    oninput: (e) => {
      const v = e.target?.value ?? "";
      strength.textContent = v ? syncPassphraseStrength(v).message : "";
    }
  });
  const enroll = mode === "create" ? el("input", { type: "text", id: "syncEnroll", autocomplete: "off", "aria-label": "開通碼", placeholder: "開通碼(8 個字元)" }) : null;
  const msg = el("p", { class: "hint", id: "syncFormMsg", text: "" });
  const gen = el("button", {
    type: "button",
    id: "syncGen",
    text: "幫我產生同步密語",
    onclick: () => {
      pass.value = generateSyncPassphrase();
      strength.textContent = "夠強(App 產生的密語)。上面這一格就是你的密語,請現在抄在紙上;抄好之後按「開始同步」,密語就不會再顯示。";
    }
  });
  const go = el("button", {
    type: "button",
    class: "primary",
    id: "syncGo",
    text: "開始同步",
    onclick: async () => {
      if (page.busy) return;
      page.busy = true;
      go.disabled = true;
      msg.textContent = "處理中…";
      const input = { passphrase: pass.value, mode, enrollCode: enroll ? enroll.value : "", role: pickedRole(ctx.container) };
      let r;
      try {
        r = mode === "rotate" ? await ctx.runner.rotate({ passphrase: input.passphrase, enrollCode: input.enrollCode }) : await ctx.ctrl.syncSetup(input);
      } finally {
        page.busy = false;
      }
      input.passphrase = "";
      if (r?.ok) {
        pass.value = "";
        page.form = null;
        page.message = mode === "rotate" ? "已換成新的密語,其他裝置下次同步時請輸入新密語" : "已設定,開始同步";
        await ctx.runner.refresh();
        void ctx.runner.syncNow({ reason: "setup" });
        await ctx.rerender();
      } else {
        go.disabled = false;
        msg.textContent = r?.error || "設定失敗,請再試一次";
      }
    }
  });
  const title = mode === "create" ? "建立新的保險箱" : mode === "join" ? "加入既有的保險箱" : "換密語";
  return el("div", { class: "card", id: "syncForm" }, [
    el("h3", { text: title }),
    el("p", { class: "hint", text: "這組密語是雲端資料唯一的鎖:別人拿到密文可以離線一直猜,所以要比解鎖手機的密碼長很多。建議直接按「幫我產生」,再抄在紙上。" }),
    mode === "rotate" ? null : roleRadios(st.role || "owner"),
    pass,
    mode === "join" ? null : gen,
    strength,
    enroll,
    go,
    msg
  ]);
}

function decisionsCard(ctx, run) {
  const p = run.pendingDesk;
  if (!p) return null;
  const choices = {};
  const rows = [];
  if (p.needsConfirm) {
    rows.push(el("p", { text: "電腦傳來新的區域行情(可比成交中位單價、樣本數或資料基準日)。套用後相關分數會標待重評,按確認才會寫入。" }));
  }
  if (p.needsDecision > 0) {
    rows.push(el("p", { id: "syncNeedDecide", text: `有 ${p.needsDecision} 項要你決定` }));
    for (const c of p.conflicts) {
      const key = `${c.id}|${c.field}`;
      choices[key] = "phone";
      rows.push(
        el("div", { class: "field" }, [
          el("div", { text: `${c.id} 的${c.label || c.field}:你手機上是 ${c.phone ?? "(空白)"},電腦給的是 ${c.notes ?? "(空白)"}` }),
          el("select", { "aria-label": `${c.id} ${c.label || c.field}`, onchange: (e) => (choices[key] = e.target.value === "notes" ? "notes" : "phone") }, [
            el("option", { value: "phone", text: "保留手機的" }),
            el("option", { value: "notes", text: "改用電腦的" })
          ])
        ])
      );
    }
  }
  return el("div", { class: "card", id: "syncDecisions" }, [
    el("h3", { text: p.needsConfirm ? "要你確認" : "要你決定" }),
    ...rows,
    el("button", { type: "button", class: "primary", id: "syncApplyChoices", text: p.needsConfirm ? "確認套用" : "照這樣套用", onclick: async () => { await ctx.runner.resolveDesk({ choices, confirm: true }); await ctx.rerender(); } }),
    p.needsConfirm ? el("button", { type: "button", text: "先不套用", onclick: async () => { await ctx.runner.dismissDesk(); await ctx.rerender(); } }) : null
  ]);
}

function peersCard(ctx) {
  const list = ctx.runner.peers();
  const nodes = list.length
    ? list.map((p) =>
        el("div", { class: "field" }, [
          el("h4", { text: `${ROLE_TITLES[p.role] || "對方"}${p.label ? `(${p.label})` : ""}` }),
          p.rows.length
            ? el("ul", {}, p.rows.map((r) =>
                el("li", {
                  text: [
                    `${r.code}:${r.status || "—"}`,
                    r.total !== null ? `總分 ${r.total}` : r.scoreNote,
                    r.vetoes.length ? `一票否決:${r.vetoes.join("、")}` : "",
                    r.condition ? `屋況:${r.condition}` : "",
                    r.review ? `複盤:${r.review}` : "",
                    r.priceLog.length ? `問價紀錄:${r.priceLog.join(";")}` : ""
                  ].filter(Boolean).join(",")
                })
              ))
            : el("p", { class: "hint", text: "對方還沒有物件的結果" })
        ])
      )
    : [el("p", { class: "hint", text: "還沒有收到對方手機的結果(對方要開啟雲端同步並存過檔)。這裡只讀,不會寫進你的資料。" })];
  return el("div", { class: "card", id: "syncPeers" }, [el("h3", { text: "對方手機的結果" }), ...nodes]);
}

/** 畫出「雲端同步」頁(路由 #sync)。ctx: { ctrl, runner, rerender }。不把字串當網頁碼塞進畫面,所有文字都走 textContent。 */
/** 畫面重畫要「合併」:畫的途中又有新狀態進來,就在畫完之後再畫一次,不會漏掉最後的狀態。 */
let drawing = false;
let dirty = false;
async function drawCoalesced() {
  if (drawing) {
    dirty = true;
    return;
  }
  drawing = true;
  try {
    do {
      dirty = false;
      const m = page.mount;
      if (!m) break;
      await drawSyncPage(m.container, m.ctx);
    } while (dirty);
  } finally {
    drawing = false;
  }
}

export async function renderSyncPage(container, ctx = {}) {
  page.mount = { container, ctx };
  await drawCoalesced();
}

async function drawSyncPage(container, ctx = {}) {
  const c = { ctrl: ctx.ctrl || active?.ctrl, runner: ctx.runner || active?.runner, rerender: ctx.rerender || active?.rerender || (async () => {}), container };
  if (!c.ctrl || !c.runner) {
    mount(container, [el("div", { class: "card" }, [el("h2", { text: "雲端同步" }), el("p", { text: "同步功能尚未準備好,請稍後再開啟這一頁。" })])]);
    return;
  }
  const again = () => drawCoalesced();
  c.rerender = async () => {
    await again();
  };
  const st = await c.ctrl.syncStatus();
  if (st?.ok === false) {
    mount(container, [el("div", { class: "card" }, [el("h2", { text: "雲端同步" }), el("p", { text: "資料還在載入,請稍後再開啟這一頁。" })])]);
    return;
  }
  const run = c.runner.status();
  const head = el("div", { class: "card" }, [
    el("h2", { text: "雲端同步" }),
    el("p", { id: "syncStatusLine", text: statusLine(st, run) }),
    run.blocked ? el("p", { class: "hint", id: "syncBlocked", text: run.blocked }) : null,
    run.notice ? el("p", { class: "hint", id: "syncNotice", text: run.notice }) : null,
    page.message ? el("p", { class: "hint", id: "syncMessage", text: page.message }) : null
  ]);
  const nodes = [head];

  if (!st.configured) {
    const healthMsg = el("p", { class: "hint", id: "syncHealthMsg", text: page.health ? page.health.message : "" });
    head.appendChild(
      el("button", {
        type: "button",
        class: "primary",
        id: "syncCheck",
        text: "檢查這個網址能不能同步",
        onclick: async () => {
          const r = await c.runner.checkHealth();
          page.health = { ok: r.ok, message: r.ok ? `可以同步(${r.env === "test" ? "測試站" : r.env})` : r.message };
          healthMsg.textContent = page.health.message;
        }
      })
    );
    head.appendChild(healthMsg);
    head.appendChild(el("button", { type: "button", id: "syncCreate", text: "建立新的保險箱", onclick: async () => { page.form = "create"; await again(); } }));
    head.appendChild(el("button", { type: "button", id: "syncJoin", text: "加入既有的保險箱", onclick: async () => { page.form = "join"; await again(); } }));
    if (page.form) nodes.push(setupForm(c, st));
  } else {
    const toggle = el("input", {
      type: "checkbox",
      id: "syncEnabled",
      checked: st.enabled,
      onchange: async (e) => {
        await c.ctrl.syncSetEnabled(e.target.checked === true);
        await c.runner.refresh();
        if (e.target.checked === true) void c.runner.syncNow({ reason: "manual" });
        await again();
      }
    });
    head.appendChild(el("label", { class: "check" }, [toggle, " 開啟雲端同步"]));
    head.appendChild(el("p", { class: "hint", id: "syncTimes", text: `上次上傳:${formatSyncTime(run.lastUploadAt || st.lastUploadAt) || "還沒有"};上次下載:${formatSyncTime(run.lastDownloadAt || st.lastDownloadAt) || "還沒有"}。這支裝置是「${st.deviceLabel || ""}」` }));
    head.appendChild(
      el("button", {
        type: "button",
        class: "primary",
        id: "syncNow",
        text: "立即同步",
        disabled: !st.enabled,
        onclick: async () => {
          page.message = "";
          await c.runner.syncNow({ reason: "manual" });
          await again();
        }
      })
    );
    const dec = decisionsCard(c, run);
    if (dec) nodes.push(dec);
    nodes.push(peersCard(c));
    if (page.form === "rotate") nodes.push(setupForm(c, st));
    const danger = el("div", { class: "card", id: "syncDanger" }, [
      el("h3", { text: "退出與清除" }),
      el("button", { type: "button", id: "syncRotate", text: "換密語", onclick: async () => { page.form = page.form === "rotate" ? null : "rotate"; await again(); } }),
      el("button", {
        type: "button",
        id: "syncLeave",
        text: page.confirmLeave ? "再按一次,這支手機就退出同步" : "這支手機退出同步",
        onclick: async () => {
          if (!page.confirmLeave) {
            page.confirmLeave = true;
            await again();
            return;
          }
          page.confirmLeave = false;
          const r = await c.ctrl.syncLeave({ wipeCloud: false });
          await c.runner.refresh();
          page.message = r?.cloud && !r.cloud.ok ? "已退出同步(雲端那一格這次沒刪成功,下次可用「刪除雲端資料」清掉)" : "已退出同步,這支手機不再連網";
          await again();
        }
      }),
      el("button", {
        type: "button",
        id: "syncWipe",
        text: page.confirmWipe ? "再按一次確認刪除雲端資料" : "刪除雲端資料",
        onclick: async () => {
          if (!page.confirmWipe) {
            page.confirmWipe = true;
            await again();
            return;
          }
          page.confirmWipe = false;
          const r = await c.ctrl.syncLeave({ wipeCloud: true });
          await c.runner.refresh();
          page.message = r?.cloud && r.cloud.ok ? "雲端資料已刪除,這支手機也退出同步了" : "這支手機已退出同步,但雲端那份這次沒刪成功,請稍後再試";
          await again();
        }
      }),
      el("p", { class: "hint", text: page.confirmWipe ? "雲端那份刪掉就不能復原;本機資料不受影響,之後可以重新建立保險箱再上傳。" : "「刪除雲端資料」會把整個保險箱從雲端刪掉(要按兩次確認),雲端那份不能復原,本機資料不受影響。" })
    ]);
    nodes.push(danger);
  }
  nodes.push(el("div", { class: "card" }, [el("p", { class: "hint", text: "雲端上放的是加密後的亂碼,只有知道同步密語的裝置能打開。可承受上限、財務數字、地址、照片、錄音都不會上傳。手動匯出匯入永遠可以用。" })]));
  mount(container, nodes);
}
