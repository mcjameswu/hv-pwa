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
  const flags = normalizeCoach(state?.coach).onboarding || {};
  const standalone = env.standalone === true;
  const pack = state?.methodPack;
  // 內建通用方法包每次開 App 都會自動載入，不算「匯入課程方法包」；有自己的方法包（有教練階段）才算，或手動按「先用內建通用版」
  const coursePack = hasStages(pack) && !isGenericPack(pack);
  const done = [
    standalone || flags.pwa_done === true,
    (state?.properties || []).length >= 1 && (state?.areas || []).length >= 1,
    coursePack || flags.builtin_pack === true,
    !capIsBlank(state?.finance || {}),
    (state?.viewings || []).length >= 1 || flags.tried === true
  ];
  const defs = [
    { id: "pwa", title: "加到主畫面", how: INSTALL_HOW, action: "install" },
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
    standalone,
    hasCoursePack: coursePack,
    flags: { ...flags }
  };
}
