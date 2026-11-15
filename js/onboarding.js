/**
 * 第 15 輪 F-R15-11、F-R15-12：「開始使用」上手步驟的判斷（純函式，不碰畫面、不寫資料）。
 * 白話：第一次打開 App 的人要照順序做五件事。每一步做完了沒有，全部從手機裡的資料自動判斷，不靠記憶；
 * 只有三件「資料看不出來」的事（已經加到主畫面、先用內建通用版、試走過了）才讓使用者手動標。
 * 首頁的上手卡與「更多」的「上手步驟」頁共用這一個判斷函式，不會有兩份邏輯。
 * 這裡的文字是公開網站上的畫面，一律用通用說法，不放任何私人檔名、課程名稱或講師名。
 */
import { normalizeCoach, ONBOARDING_FLAGS } from "./coach.js";
import { capIsBlank } from "./fields.js";
import { isGenericPack } from "./method-pack.js";

export { ONBOARDING_FLAGS };

export const ONBOARDING_TOTAL = 5;

/** 加到主畫面的做法（兩種手機各一行）。 */
export const INSTALL_HOW = "Android Chrome:右上角選單 → 加到主畫面;iPhone Safari:分享 → 加入主畫面";

/**
 * 第 16 輪 F-R16-11、F-R16-12：依瀏覽器自報的身分（使用者代理字串）判斷是哪一種手機或瀏覽器，給對的「加到主畫面」做法，
 * 並判斷是不是在別的 App 裡打開的（那種內建瀏覽器的選單裡通常沒有安裝或加到主畫面）。
 * 白話：每家瀏覽器把「加到主畫面」藏的位置不一樣，所以依手機種類各給一句做法；偵測不到時（字串空白或看不懂）仍然顯示原本的通用兩行說法，不出錯。
 * 偵測靠瀏覽器自己報的字串，不一定準，所以畫面上永遠留著文字做法，不會只靠偵測。
 */
export function detectBrowser(userAgent) {
  const ua = typeof userAgent === "string" ? userAgent : "";
  const ios = /iPhone|iPad|iPod/i.test(ua);
  const android = /Android/i.test(ua);
  const inApp = /\bLine\/|FBAN|FBAV|Instagram/i.test(ua) || (android && /;\s*wv\)|\bwv\b/.test(ua));
  let kind = "unknown";
  if (ios) kind = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//i.test(ua) || inApp || !/Safari/i.test(ua) ? "ios-other" : "ios-safari";
  else if (android) kind = /Chrome\//i.test(ua) && !/EdgA|OPR\/|SamsungBrowser|Firefox/i.test(ua) && !inApp ? "android-chrome" : "android-other";
  else if (/Windows NT|Macintosh|X11|CrOS|Linux/i.test(ua) && !/Mobile/i.test(ua)) kind = "desktop";
  return { kind, inApp };
}

/** 各種手機的「加到主畫面」做法（未知就用通用的兩行說法）。 */
export const INSTALL_GUIDES = {
  "android-chrome": "Android Chrome:右上角 ⋮ → 安裝應用程式(有些版本叫加到主畫面)",
  "android-other": "Android:這個瀏覽器可能沒有安裝選項，請改用 Chrome 開啟，再按右上角 ⋮ → 安裝應用程式(有些版本叫加到主畫面)",
  "ios-safari": "iPhone Safari:下方分享鍵 → 加入主畫面",
  "ios-other": "iPhone:網址列旁分享鍵 → 加入主畫面,找不到就改用 Safari 開",
  desktop: "電腦:網址列右邊的安裝圖示"
};

/** 在別的 App 裡打開時的提醒（第 1 步顯示，旁邊有「複製網址」按鈕）。 */
export const IN_APP_NOTICE = "如果選單裡沒有安裝或加到主畫面,你可能是在別的 App 裡打開的:按右上角選單選『在 Chrome 中開啟』";

/** 要不要顯示「可能在別的 App 裡打開」的提醒：偵測到內建瀏覽器，或載入 5 秒後仍沒有安裝事件而且不是從主畫面開啟（iPhone Safari 本來就沒有安裝事件，不算）。 */
export function showInAppNotice({ inApp = false, waited = false, standalone = false, canInstall = false, kind = "unknown" } = {}) {
  if (standalone || kind === "desktop") return false; // 電腦不顯示「在別的 App 裡打開」（F-R16B-13）
  if (inApp) return true;
  return waited === true && !canInstall && kind !== "ios-safari";
}

/** 第 5 步的試走路線（約 10 分鐘），展開後逐項列出。 */
export const TRIAL_ROUTE = [
  "按首頁的「照著做」，看第 1 階段",
  "回首頁按「開始看一間」，選一間",
  "看房前，看自動帶入的單價，對就按「對」",
  "現場走 2 站，按一次「這站都正常」，在房間站試「再加一間」",
  "重新整理頁面，確認資料都還在"
];

function hasStages(pack) {
  return Array.isArray(pack?.stages) && pack.stages.length > 0;
}

/**
 * @param {object} state App 狀態
 * @param {{standalone?: boolean, canInstall?: boolean}} env 瀏覽器環境：是不是從主畫面開啟、有沒有收到「可以安裝」的事件
 */
export function onboardingModel(state, env = {}) {
  const browser = detectBrowser(env.userAgent);
  const flags = normalizeCoach(state?.coach).onboarding || {};
  const standalone = env.standalone === true;
  const pack = state?.methodPack;
  // 內建通用方法包每次開 App 都會自動載入，不算「匯入課程方法包」；有自己的方法包（有教練階段）才算，或手動按「先用內建通用版」
  const coursePack = hasStages(pack) && !isGenericPack(pack);
  const done = [
    standalone || flags.pwa_done === true,
    ((state?.properties || []).length >= 1 && (state?.areas || []).length >= 1) || flags.import_skipped === true, // F-R16-45：沒有區域功課也能手動往下走
    coursePack || flags.builtin_pack === true,
    !capIsBlank(state?.finance || {}),
    (state?.viewings || []).length >= 1 || flags.tried === true
  ];
  const defs = [
    { id: "pwa", title: "加到主畫面", how: INSTALL_GUIDES[browser.kind] || INSTALL_HOW, action: "install" },
    { id: "import", title: "匯入待看物件與區域功課", how: "到雲端硬碟「看房同步」資料夾，選同步匯入檔", action: "import" },
    { id: "pack", title: "匯入課程方法包", how: "選你的課程方法包檔案；沒有的話可以先用內建通用版", action: "import" },
    { id: "cap", title: "填可承受上限", how: "只有你自己看得到，畫面上不會顯示數字", action: "cap" },
    { id: "trial", title: "試走一次（約 10 分鐘）", how: "照下面的路線走一遍，確認每一步都順", action: "trial" }
  ];
  const currentIndex = done.findIndex((d) => !d);
  const steps = defs.map((d, i) => ({ n: i + 1, ...d, done: done[i], current: i === currentIndex }));
  const allDone = currentIndex === -1;
  return {
    total: ONBOARDING_TOTAL,
    steps,
    doneCount: done.filter(Boolean).length,
    allDone,
    currentN: allDone ? null : currentIndex + 1,
    title: allDone ? "上手完成,之後照口袋大叔走就好" : `開始使用:第 ${currentIndex + 1} 步/共 ${ONBOARDING_TOTAL} 步`,
    collapsed: flags.collapsed === true,
    visibleOnHome: flags.collapsed !== true,
    canInstall: env.canInstall === true,
    browser: browser.kind,
    inApp: browser.inApp,
    inAppNotice: showInAppNotice({ inApp: browser.inApp, waited: env.installWaited === true, standalone, canInstall: env.canInstall === true, kind: browser.kind }),
    standalone,
    hasCoursePack: coursePack,
    flags: { ...flags }
  };
}
