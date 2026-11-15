export const SCHEMA_VERSION = "import_v1";
export const APP_VERSION = "1.19.1";
export const DB_VERSION = 8; // R13：新增口袋教練（coach）與問價紀錄（priceLog）兩張表，資料庫升到第 8 版

export const FIELD_LABELS = {
  call_name: "草稿裡的稱呼",
  partner_label: "共同決策人的稱謂",
  partner_gate: "出價前是否需共同決策人同意",
  purpose: "購屋用途",
  goal_commit: "承諾看房間數",
  goal_stretch: "加碼目標間數",
  program_weeks: "計畫週數",
  sessions_per_week: "每週看房半天數",
  checkpoint_week: "判定是否加碼的週次",
  weekly_hour_cap: "每週工時上限(小時)",
  half_day_hours: "已採用的半天長度(小時)",
  online_transcribe: "允許線上即時轉文字",
  device_note: "主要使用的手機型號",
  budget_cap_total: "可承受總價上限(萬)",
  search_range_low: "對外說的搜尋總價下緣(萬)",
  search_range_high: "對外說的搜尋總價上緣或約數(萬)",
  search_ratio_max: "搜尋上緣占上限的建議最高比例",
  own_funds_down: "可用於頭期的自有資金(萬)",
  down_has_borrowed: "頭期資金是否含借款",
  reserve_months: "預備金月數",
  essential_monthly: "每月必要支出(萬)",
  stable_monthly_income: "家庭穩定月收入(萬)",
  max_payment_ratio: "月付上限占穩定月收入比例",
  rate_shock_pp: "升息壓力測試(百分點)",
  hold_years_min: "至少能持有不賣的年數",
  tighten_only: "門檻只能調嚴",
  ltv_assumed: "預估貸款成數",
  staged_offer_steps: "分段出價數字(萬)",
  finance_as_of: "財務數字基準日",
  base_rate_assumed: "預估基準貸款利率(%)",
  loan_years_assumed: "預估貸款年限(年)",
  liquid_funds_total: "購屋前可動用的流動資金(萬)",
  closing_cost_ratio: "購屋雜費比例",
  holding_cost_monthly: "月化持有成本(萬)",
  borrowed_down_monthly: "頭期借款的月付(萬)",
  borrowed_down_amount: "頭期借款的金額(萬)",
  price_band: "合理總價帶(萬)",
  target_areas: "目標區域",
  rooms_min: "最少房數",
  rooms_preferred: "偏好房數",
  age_max: "屋齡上限(年)",
  product_type: "產品類型",
  mgmt_fee_max: "管理費上限(元/月)",
  deal_breaker: "一票否決",
  common_ratio_max: "公設比上限(%)",
  w_screen: "九項初篩權重",
  w_condition: "屋況社區權重",
  w_price: "價格權重",
  over_cap_action: "超過上限時",
  stretch_min_total: "延伸帶物件進候選的最低總分",
  stretch_min_price: "延伸帶物件進候選的最低價格分",
  about_markup: "約數模式上浮倍數",
  slot_id: "格位",
  branch_label: "門店代稱",
  agent_alias: "主責仲介稱呼",
  place_alias: "地點代稱",
  commute_target: "強勢辦公區錨點代稱與上限分鐘",
  commute_min: "本區到強勢辦公區分鐘",
  area_code: "區域代號",
  area_label: "區域名稱",
  pop_net_inflow: "區段人口淨流入",
  avg_income: "平均收入",
  cre_report: "商業不動產報告重點與出處",
  research_as_of: "區域功課查詢基準日",
  property_code: "物件代號",
  notes_status: "筆記裡的狀態",
  community_name: "社區名稱",
  ask_total: "開價(萬)",
  ping_total: "登記總坪",
  has_parking: "有無車位",
  parking_included_in_ask: "車位是否含在開價",
  parking_ping: "車位坪",
  parking_price: "車位開價(萬)",
  rooms: "房數",
  baths: "衛浴數",
  memory_note: "記憶備註",
  age: "屋齡(年)",
  floor_note: "樓層備註",
  mgmt_fee: "管理費(元/月)",
  agent_company: "仲介公司",
  planned_date: "預計看房日",
  source_note: "來源備註",
  notes_ref: "筆記頁代號",
  notes_updated_at: "筆記最後更新時間"
};

/**
 * 「自住適配」是使用者本人的通勤（G 分頁常用地點通勤表）：在物件頁與比較頁另欄顯示，
 * 不計入九項初篩分數，也不取代初篩第 2 項「到強勢辦公區」（2026-11-14 擁有者更正）。
 */
export const SELF_FIT_LABEL = "自住適配";

export const DEFAULT_SCORING = {
  w_screen: 0.4,
  w_condition: 0.35,
  w_price: 0.25,
  walk_multiplier: 1.5,
  premium_penalty_per_pct: 5,
  fake_price_penalty: 10,
  over_cap_action: "淘汰",
  cold_tactics_after_n: 20,
  stretch_min_total: 75,
  stretch_min_price: 80,
  about_markup: 1.15
};

/** 選填欄留空時可以提供的建議值（預備金月數是必填欄，不在這裡，F9-19 第 7 點）。 */
export const SUGGESTED_OPTIONAL = {
  search_ratio_max: 0.9,
  rate_shock_pp: 2,
  checkpoint_week: 3
};

/** 必填但匯入檔留空的財務欄：不提供建議值，只列待核並提醒本人填寫；目前已有值時保留目前的值。 */
export const REQUIRED_NO_SUGGESTION = ["reserve_months"];

export const WEIGHT_SUM_TOLERANCE = 0.001;

export const YES = "是";
export const NO = "否";

export const SLOT_IDS = ["G1-1", "G1-2", "G1-3", "G2-1", "G2-2", "G2-3", "G3-1", "G3-2", "G3-3"];

export const AGENT_STATUSES = ["未排", "已約", "已訪", "已完成該組目的", "列為主要合作", "不列合作"];

export const SCREEN_KEYS = [
  "location",
  "commute",
  "walk",
  "unit_price",
  "price_band",
  "product",
  "volume",
  "timing",
  "cashflow"
];

/**
 * 初篩第 2 項量的是「從本區到強勢辦公區」的時間（平日早上 7:30 開車、門到門；30 分內符合、31 到 40 分部分符合、超過 40 分不符合），
 * 目的是日後接手的買方夠多、好賣抗跌（房價跟人、人跟工作），不是使用者本人的通勤；內部代號沿用 commute 不改。
 */
export const SCREEN_LABELS = {
  location: "地段",
  commute: "到強勢辦公區",
  walk: "步行到站",
  unit_price: "單價",
  price_band: "總價帶",
  product: "產品",
  volume: "量",
  timing: "時間點",
  cashflow: "現金流"
};

export const CONDITION_KEYS = [
  "light_air",
  "leak",
  "neighbors",
  "window_view",
  "community",
  "amenities",
  "parking_product"
];

export const CONDITION_LABELS = {
  light_air: "採光通風",
  leak: "漏水",
  neighbors: "鄰居",
  window_view: "窗外",
  community: "社區維護",
  amenities: "生活機能",
  parking_product: "車位與產品"
};

export const HARD_GATES_ALWAYS = ["PV-02", "PV-08", "PV-10"];
export const HARD_GATE_STRETCH = "PV-11";
export const HARD_GATE_CAP_BLANK = "PV-12";

export const REMINDER_GATES = ["PV-01", "PV-03", "PV-04", "PV-05", "PV-06", "PV-07", "PV-09"];

export const CSV_SHEETS = {
  A: "settings",
  B: "finance",
  C: "profile",
  D: "areas",
  E: "scoring",
  F: "agents",
  G: "travel",
  H: "properties"
};

/** Row 1 Chinese titles and row 2 English codes, in order. Order change is rejected. */
export const SHEET_COLUMNS = {
  settings: [
    ["草稿裡的稱呼", "call_name"],
    ["共同決策人的稱謂", "partner_label"],
    ["出價前是否需共同決策人同意", "partner_gate"],
    ["購屋用途", "purpose"],
    ["承諾看房間數", "goal_commit"],
    ["加碼目標間數", "goal_stretch"],
    ["計畫週數", "program_weeks"],
    ["每週看房半天數", "sessions_per_week"],
    ["判定是否加碼的週次", "checkpoint_week"],
    ["每週工時上限(小時)", "weekly_hour_cap"],
    ["允許線上即時轉文字", "online_transcribe"],
    ["主要使用的手機型號", "device_note"]
  ],
  finance: [
    ["可承受總價上限(萬)", "budget_cap_total"],
    ["對外說的搜尋總價下緣(萬)", "search_range_low"],
    ["對外說的搜尋總價上緣或約數(萬)", "search_range_high"],
    ["搜尋上緣占上限的建議最高比例", "search_ratio_max"],
    ["可用於頭期的自有資金(萬)", "own_funds_down"],
    ["頭期資金是否含借款", "down_has_borrowed"],
    ["預備金月數", "reserve_months"],
    ["每月必要支出(萬)", "essential_monthly"],
    ["家庭穩定月收入(萬)", "stable_monthly_income"],
    ["月付上限占穩定月收入比例", "max_payment_ratio"],
    ["升息壓力測試(百分點)", "rate_shock_pp"],
    ["至少能持有不賣的年數", "hold_years_min"],
    ["門檻只能調嚴", "tighten_only"],
    ["預估貸款成數", "ltv_assumed"],
    ["分段出價數字(萬)", "staged_offer_steps"],
    ["財務數字基準日", "finance_as_of"],
    ["預估基準貸款利率(%)", "base_rate_assumed"],
    ["預估貸款年限(年)", "loan_years_assumed"],
    ["購屋前可動用的流動資金(萬)", "liquid_funds_total"],
    ["購屋雜費比例", "closing_cost_ratio"],
    ["月化持有成本(萬)", "holding_cost_monthly"],
    ["頭期借款的月付(萬)", "borrowed_down_monthly"],
    ["頭期借款的金額(萬)", "borrowed_down_amount"]
  ],
  profile: [
    ["合理總價帶(萬)", "price_band"],
    ["目標區域", "target_areas"],
    ["強勢辦公區錨點代稱與上限分鐘", "commute_target"],
    ["步行到交通站上限分鐘與替代方式", "walk_to_transit"],
    ["單價區間(萬/坪)", "unit_price_range"],
    ["面積區間(坪)", "area_range"],
    ["公設比上限(%)", "common_ratio_max"],
    ["最少房數", "rooms_min"],
    ["偏好房數", "rooms_preferred"],
    ["格局備註", "layout_note"],
    ["車位需求", "parking"],
    ["樓層偏好", "floor_pref"],
    ["屋齡上限(年)", "age_max"],
    ["產品類型", "product_type"],
    ["管理費上限(元/月)", "mgmt_fee_max"],
    ["生活機能必備", "amenities"],
    ["必備條件", "must_have"],
    ["一票否決", "deal_breaker"]
  ],
  areas: [
    ["區域代號", "area_code"],
    ["區域名稱", "area_label"],
    ["可比成交中位單價(萬/坪)", "comps_median_unit"],
    ["可比成交第25百分位單價", "comps_q1_unit"],
    ["可比成交第75百分位單價", "comps_q3_unit"],
    ["可比成交筆數", "comps_sample_n"],
    ["區域常見議價率", "nego_rate"],
    ["本區到強勢辦公區分鐘(平日 7:30 開車門到門)", "commute_min"],
    ["本區到交通站步行分鐘", "walk_min"],
    ["行情資料基準日", "data_as_of"],
    ["區域類型", "area_type"],
    ["優先順序", "priority"],
    ["錨點代稱", "anchor"],
    ["步行分鐘半徑", "radius_min"],
    ["區段人口淨流入", "pop_net_inflow"],
    ["平均收入", "avg_income"],
    ["商業不動產報告重點與出處", "cre_report"],
    ["區域功課查詢基準日", "research_as_of"]
  ],
  scoring: [
    ["九項初篩權重", "w_screen"],
    ["屋況社區權重", "w_condition"],
    ["價格權重", "w_price"],
    ["步行到站加權倍數", "walk_multiplier"],
    ["溢價每1%扣幾分", "premium_penalty_per_pct"],
    ["假價格警訊每項扣分", "fake_price_penalty"],
    ["超過上限時", "over_cap_action"],
    ["冷處理類技巧在第幾間後才可開啟", "cold_tactics_after_n"],
    ["延伸帶物件進候選的最低總分", "stretch_min_total"],
    ["延伸帶物件進候選的最低價格分", "stretch_min_price"],
    ["約數模式上浮倍數", "about_markup"]
  ],
  agents: [
    ["格位", "slot_id"],
    ["仲介品牌", "brand"],
    ["門店代稱", "branch_label"],
    ["連鎖或在地", "chain_or_local"],
    ["主責仲介稱呼", "agent_alias"],
    ["狀態", "status"]
  ],
  travel: [
    ["地點代稱", "place_alias"],
    ["交通方式", "mode"],
    ["到各目標區代號的去程分鐘", "minutes_to_area"],
    ["從各目標區回到本地點的分鐘", "minutes_back"],
    ["基準日", "as_of"]
  ],
  properties: [
    ["物件代號", "property_code"],
    ["筆記裡的狀態", "notes_status"],
    ["區域代號", "area_code"],
    ["社區名稱", "community_name"],
    ["開價(萬)", "ask_total"],
    ["登記總坪", "ping_total"],
    ["有無車位", "has_parking"],
    ["車位是否含在開價", "parking_included_in_ask"],
    ["車位坪", "parking_ping"],
    ["車位開價(萬)", "parking_price"],
    ["房數", "rooms"],
    ["屋齡(年)", "age"],
    ["樓層備註", "floor_note"],
    ["產品類型", "product_type"],
    ["管理費(元/月)", "mgmt_fee"],
    ["仲介公司", "agent_company"],
    ["門店代稱", "branch_label"],
    ["主責仲介稱呼", "agent_alias"],
    ["預計看房日", "planned_date"],
    ["來源備註", "source_note"],
    ["筆記頁代號", "notes_ref"],
    ["筆記最後更新時間", "notes_updated_at"],
    ["衛浴數", "baths"]
  ]
};

/**
 * 第 12 輪以前下載的範本欄數：區域分頁當時只有前 14 欄。只多出新欄位的舊範本仍接受（前 14 欄的標題與代號一個字都不能錯），
 * 不讓使用者因為範本加了欄位就整張被拒收；其他任何欄數或順序不符仍然拒收。key 是分頁名稱，值是舊版的欄數。
 */
export const LEGACY_SHEET_WIDTHS = { areas: 14, properties: 22 };

/**
 * 舊版範本的第 1 列標題（2026-11-14 以前下載的 CSV 與 Excel 範本）：改名後仍然接受，
 * 不讓使用者因為範本改了標題就整張被拒收。key 是欄位代號，值是舊標題清單。
 */
export const LEGACY_SHEET_TITLES = {
  commute_target: ["通勤目的地代稱與上限分鐘"],
  commute_min: ["本區到通勤目的地分鐘"]
};

export const NUMBER_FIELDS = new Set([
  "goal_commit",
  "goal_stretch",
  "program_weeks",
  "sessions_per_week",
  "checkpoint_week",
  "weekly_hour_cap",
  "budget_cap_total",
  "search_range_low",
  "search_range_high",
  "search_ratio_max",
  "own_funds_down",
  "reserve_months",
  "essential_monthly",
  "stable_monthly_income",
  "max_payment_ratio",
  "rate_shock_pp",
  "hold_years_min",
  "ltv_assumed",
  "base_rate_assumed",
  "loan_years_assumed",
  "liquid_funds_total",
  "closing_cost_ratio",
  "holding_cost_monthly",
  "borrowed_down_monthly",
  "borrowed_down_amount",
  "common_ratio_max",
  "rooms_min",
  "rooms_preferred",
  "age_max",
  "mgmt_fee_max",
  "comps_median_unit",
  "comps_q1_unit",
  "comps_q3_unit",
  "comps_sample_n",
  "nego_rate",
  "commute_min",
  "walk_min",
  "priority",
  "radius_min",
  "w_screen",
  "w_condition",
  "w_price",
  "walk_multiplier",
  "premium_penalty_per_pct",
  "fake_price_penalty",
  "cold_tactics_after_n",
  "stretch_min_total",
  "stretch_min_price",
  "about_markup"
]);

export const OPTIONAL_WITH_SUGGESTION = { ...SUGGESTED_OPTIONAL };
