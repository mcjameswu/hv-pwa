/**
 * Field registry: one table for type, range, privacy and B13 direction.
 * 欄位規格表：型別、單位、上下限、可否空白、隱私等級、是否掃個資、調鬆方向只寫一次。
 */
import { findPii } from "./pii.js";
import { FIELD_LABELS } from "./defaults.js";

export const PII_MESSAGE = "這格不能放可識別個人或登入的資料";

export const CONDITION_OPTIONS = ["無問題", "輕微", "嚴重", "看不出來"];
export const TIMING_OPTIONS = [0, 1, 2];

const YES_NO = ["是", "否"];

/** 問價紀錄的類型（第 13 輪 C5）：對方開價、我方詢問、我方回應、仲介轉述、斡旋。 */
export const PRICE_LOG_KINDS = ["對方開價", "我方詢問", "我方回應", "仲介轉述", "斡旋"];

/** 筆記系統裡待看物件的狀態（第 12 輪）：待看、已約、已看、淘汰、觀察。 */
export const NOTES_STATUSES = ["待看", "已約", "已看", "淘汰", "觀察"];

/**
 * 匯入檔「待看物件」列（import_v1 的 properties）裡，欄位名稱和物件資料表不同的三個：
 * property_code 對應物件代號 id，parking_price 對應車位開價 parking_price_ask，mgmt_fee 對應管理費 mgmt_fee_yuan（元／月）。
 * 白話：匯入檔用筆記系統那邊的叫法，進到手機之後換成這個 App 原本的欄位名，欄位定義仍然只有 FIELD_TABLES 一份。
 */
export const NOTES_KEY_ALIASES = { property_code: "id", parking_price: "parking_price_ask", mgmt_fee: "mgmt_fee_yuan" };

/** 匯入檔「待看物件」每一列可以有的欄位（順序就是範本欄位順序）。 */
export const NOTES_ROW_KEYS = [
  "property_code", "notes_status", "area_code", "community_name", "ask_total", "ping_total", "has_parking",
  "parking_included_in_ask", "parking_ping", "parking_price", "rooms", "age", "floor_note", "product_type",
  "mgmt_fee", "agent_company", "branch_label", "agent_alias", "planned_date", "source_note", "notes_ref", "notes_updated_at", "memory_note", "baths"
];

/**
 * 只留在這支手機、永不同步的表(S2 F-S2-02):目前內容就是財務表。
 * 白話:雲端同步的守門規則要知道「哪些表絕對不能出現在要上傳的內容裡」,名稱統一從這份清單拿,
 * 同步模組自己不用寫死那張表的名字,也不用拆字繞過字樣檢查。
 */
export const LOCAL_ONLY_TABLES = ["finance"];

/** 匯入列的欄位名稱換成物件資料表的欄位名稱。 */
export function notesPropKey(importKey) {
  return NOTES_KEY_ALIASES[importKey] || importKey;
}

function spec(s) {
  return s;
}

/** @type {Record<string, Record<string, object>>} */
export const FIELD_TABLES = {
  settings: {
    call_name: spec({ type: "string", maxLength: 10, nullable: true, privacy: "P1", pii: true }),
    partner_label: spec({ type: "string", maxLength: 6, nullable: true, privacy: "P1", pii: true }),
    partner_gate: spec({ type: "enum", enum: YES_NO, nullable: true, privacy: "P1" }),
    purpose: spec({ type: "enum", enum: ["自住", "出租", "自住兼出租"], nullable: true, privacy: "P1" }),
    goal_commit: spec({ type: "integer", min: 1, max: 200, nullable: true, privacy: "P1" }),
    goal_stretch: spec({ type: "integer", min: 1, max: 200, nullable: true, privacy: "P1" }),
    program_weeks: spec({ type: "integer", min: 1, max: 52, nullable: true, privacy: "P1" }),
    sessions_per_week: spec({ type: "integer", min: 1, max: 7, nullable: true, privacy: "P1" }),
    checkpoint_week: spec({ type: "integer", min: 1, max: 52, nullable: true, privacy: "P1" }),
    weekly_hour_cap: spec({ type: "number", min: 1, max: 60, nullable: true, privacy: "P1" }),
    half_day_hours: spec({ type: "number", enum: [3.5, 4], nullable: true, privacy: "P1" }),
    online_transcribe: spec({ type: "enum", enum: YES_NO, nullable: true, privacy: "P1" }),
    device_note: spec({ type: "string", nullable: true, privacy: "P1", pii: true }),
    program_start: spec({ type: "date", nullable: true, privacy: "P1" }),
    commute_measured_min: spec({ type: "number", min: 0, max: 300, integer: true, nullable: true, privacy: "P1" }),
    remaining_weeks_estimate: spec({ type: "number", min: 0, max: 52, nullable: true, privacy: "P1" }),
    goal_commit_choice: spec({ type: "integer", enum: [45, 50], nullable: true, privacy: "P1" }),
    course_b_blank_ratio: spec({ type: "ratio", min: 0, max: 1, nullable: true, privacy: "P1" }),
    course_b_drafts: spec({ type: "integer", min: 0, max: 20, nullable: true, privacy: "P1" }),
    self_entered_cap: spec({ type: "boolean", nullable: true, privacy: "P2" }),
    partner_consent_at: spec({ type: "string", nullable: true, privacy: "P1" }),
    partner_consent_how: spec({ type: "string", nullable: true, privacy: "P1", pii: true }),
    offline_verified: spec({ type: "boolean", nullable: true, privacy: "P1" }),
    agencies_selected: spec({ type: "boolean", nullable: true, privacy: "P1" }),
    slot_planned: spec({ type: "boolean", nullable: true, privacy: "P1" }),
    sop_v2_complete: spec({ type: "boolean", nullable: true, privacy: "P1" }),
    profile_final: spec({ type: "boolean", nullable: true, privacy: "P1" }),
    course_b_complete: spec({ type: "boolean", nullable: true, privacy: "P1" }),
    course_b_core_unknown: spec({ type: "boolean", nullable: true, privacy: "P1" }),
    combat_self_assess: spec({ type: "boolean", nullable: true, privacy: "P1" }),
    s3_complete: spec({ type: "boolean", nullable: true, privacy: "P1" }),
    gap_documented: spec({ type: "boolean", nullable: true, privacy: "P1" }),
    s1_complete: spec({ type: "boolean", nullable: true, privacy: "P1" }),
    s2_complete: spec({ type: "boolean", nullable: true, privacy: "P1" }),
    w3_goal_rechecked: spec({ type: "boolean", nullable: true, privacy: "P1" }),
    w0_complete: spec({ type: "boolean", nullable: true, privacy: "P1" }),
    overtime_consent: spec({ type: "boolean", nullable: true, privacy: "P1" }),
    overtime_hours_used: spec({ type: "number", min: 0, max: 80, nullable: true, privacy: "P1" }),
    w10_unknown_as_pass: spec({ type: "boolean", nullable: true, privacy: "P1" }),
    w10_nonself_action: spec({ type: "boolean", nullable: true, privacy: "P1" })
  },
  finance: {
    budget_cap_total: spec({ type: "amount", exclusiveMin: 0, nullable: true, privacy: "P2", b13: "raise", capBlankIfMissing: true }),
    search_range_low: spec({ type: "amount", exclusiveMin: 0, nullable: true, privacy: "P2", b13: "none", outbound: "agent" }),
    search_range_high: spec({ type: "amount", exclusiveMin: 0, nullable: true, privacy: "P2", b13: "raise", outbound: "agent" }),
    search_ratio_max: spec({ type: "ratio", min: 0.5, max: 0.99, nullable: true, privacy: "P2", b13: "raise" }),
    own_funds_down: spec({ type: "amount", min: 0, nullable: true, privacy: "P2", b13: "raise" }),
    down_has_borrowed: spec({ type: "enum", enum: YES_NO, nullable: true, privacy: "P2" }),
    reserve_months: spec({ type: "integer", min: 0, max: 36, nullable: true, privacy: "P2", b13: "lower" }),
    essential_monthly: spec({ type: "amount", min: 0, nullable: true, privacy: "P2" }),
    stable_monthly_income: spec({ type: "amount", min: 0, nullable: true, privacy: "P2" }),
    max_payment_ratio: spec({ type: "ratio", min: 0, max: 1, nullable: true, privacy: "P2", b13: "raise" }),
    rate_shock_pp: spec({ type: "number", min: 0, max: 5, nullable: true, privacy: "P2", b13: "lower" }),
    hold_years_min: spec({ type: "integer", min: 0, max: 30, nullable: true, privacy: "P2", b13: "lower" }),
    tighten_only: spec({ type: "enum", enum: YES_NO, nullable: true, privacy: "P2" }),
    ltv_assumed: spec({ type: "ratio", min: 0, max: 1, nullable: true, privacy: "P2", b13: "raise" }),
    staged_offer_steps: spec({ type: "string", nullable: true, privacy: "P2", pii: false }),
    finance_as_of: spec({ type: "date", nullable: true, privacy: "P2" }),
    base_rate_assumed: spec({ type: "number", min: 0, max: 15, nullable: true, privacy: "P2", b13: "lower" }),
    loan_years_assumed: spec({ type: "integer", min: 1, max: 40, nullable: true, privacy: "P2", b13: "raise" }),
    liquid_funds_total: spec({ type: "amount", min: 0, nullable: true, privacy: "P2", b13: "raise" }),
    closing_cost_ratio: spec({ type: "ratio", min: 0, max: 0.1, nullable: true, privacy: "P2" }),
    holding_cost_monthly: spec({ type: "amount", min: 0, nullable: true, privacy: "P2" }),
    borrowed_down_monthly: spec({ type: "amount", min: 0, nullable: true, privacy: "P2" }),
    borrowed_down_amount: spec({ type: "amount", min: 0, nullable: true, privacy: "P2", b13: "raise" })
  },
  profile: {
    price_band: spec({ type: "string", nullable: true, privacy: "P1" }),
    target_areas: spec({ type: "string", nullable: true, privacy: "P1" }),
    commute_target: spec({ type: "string", nullable: true, privacy: "P1", pii: true }),
    walk_to_transit: spec({ type: "string", nullable: true, privacy: "P1" }),
    unit_price_range: spec({ type: "string", nullable: true, privacy: "P1" }),
    area_range: spec({ type: "string", nullable: true, privacy: "P1" }),
    common_ratio_max: spec({ type: "number", min: 0, max: 60, nullable: true, privacy: "P1", b13: "raise" }),
    rooms_min: spec({ type: "integer", min: 1, max: 9, nullable: true, privacy: "P1", b13: "lower" }),
    rooms_preferred: spec({ type: "integer", min: 1, max: 9, nullable: true, privacy: "P1" }),
    layout_note: spec({ type: "string", nullable: true, privacy: "P1", pii: true }),
    parking: spec({ type: "string", nullable: true, privacy: "P1" }),
    floor_pref: spec({ type: "string", nullable: true, privacy: "P1" }),
    age_max: spec({ type: "integer", min: 0, nullable: true, privacy: "P1", b13: "raise" }),
    product_type: spec({ type: "string", nullable: true, privacy: "P1" }),
    mgmt_fee_max: spec({ type: "amount_yuan", integer: true, min: 0, nullable: true, privacy: "P1", b13: "raise" }),
    amenities: spec({ type: "string", nullable: true, privacy: "P1" }),
    must_have: spec({ type: "string", nullable: true, privacy: "P1" }),
    deal_breaker: spec({ type: "string", nullable: true, privacy: "P1" })
  },
  scoring: {
    w_screen: spec({ type: "ratio", min: 0, max: 1, nullable: true, privacy: "P1" }),
    w_condition: spec({ type: "ratio", min: 0, max: 1, nullable: true, privacy: "P1" }),
    w_price: spec({ type: "ratio", min: 0, max: 1, nullable: true, privacy: "P1" }),
    walk_multiplier: spec({ type: "number", min: 1, max: 3, nullable: true, privacy: "P1" }),
    premium_penalty_per_pct: spec({ type: "number", min: 0, max: 20, nullable: true, privacy: "P1" }),
    fake_price_penalty: spec({ type: "number", min: 0, max: 30, nullable: true, privacy: "P1" }),
    over_cap_action: spec({ type: "enum", enum: ["淘汰", "觀察"], nullable: true, privacy: "P1" }),
    cold_tactics_after_n: spec({ type: "integer", min: 0, nullable: true, privacy: "P1" }),
    stretch_min_total: spec({ type: "number", min: 0, max: 100, nullable: true, privacy: "P1", b13: "lower" }),
    stretch_min_price: spec({ type: "number", min: 0, max: 100, nullable: true, privacy: "P1", b13: "lower" }),
    about_markup: spec({ type: "number", min: 1, max: 1.5, nullable: true, privacy: "P1", b13: "lower" }),
    version: spec({ type: "string", nullable: true, privacy: "P1", pii: false })
  },
  areas: {
    area_code: spec({ type: "string", pattern: "^[A-Z]{2}[0-9]{2}$", nullable: false, privacy: "P1" }),
    area_label: spec({ type: "string", nullable: true, privacy: "P2", outbound: "agent" }),
    comps_median_unit: spec({ type: "number", min: 0, nullable: true, privacy: "P1" }),
    comps_q1_unit: spec({ type: "number", min: 0, nullable: true, privacy: "P1" }),
    comps_q3_unit: spec({ type: "number", min: 0, nullable: true, privacy: "P1" }),
    comps_sample_n: spec({ type: "integer", min: 0, nullable: true, privacy: "P1" }),
    nego_rate: spec({ type: "ratio", min: 0, max: 0.3, nullable: true, privacy: "P1" }),
    commute_min: spec({ type: "integer", min: 0, nullable: true, privacy: "P1" }),
    walk_min: spec({ type: "integer", min: 0, nullable: true, privacy: "P1" }),
    data_as_of: spec({ type: "date", nullable: true, privacy: "P1" }),
    area_type: spec({ type: "enum", enum: ["行政區", "學區", "商圈", "路廊", "車站步行圈", "生活圈錨點"], nullable: true, privacy: "P1" }),
    priority: spec({ type: "integer", min: 1, max: 4, nullable: true, privacy: "P1" }),
    anchor: spec({ type: "string", nullable: true, privacy: "P2", pii: true }),
    radius_min: spec({ type: "integer", min: 1, max: 30, nullable: true, privacy: "P1" }),
    // 第 12 輪：區域功課三項（看房前必做功課的資料來源，只記錄、不計分）與查詢基準日
    pop_net_inflow: spec({ type: "string", maxLength: 200, nullable: true, privacy: "P1" }),
    avg_income: spec({ type: "string", maxLength: 200, nullable: true, privacy: "P1" }),
    cre_report: spec({ type: "string", maxLength: 2000, nullable: true, privacy: "P1" }),
    research_as_of: spec({ type: "date", nullable: true, privacy: "P1" })
  },
  agents: {
    slot_id: spec({ type: "string", pattern: "^G[123]-[123]$", nullable: true, privacy: "P1" }),
    brand: spec({ type: "string", nullable: true, privacy: "P1" }),
    branch_label: spec({ type: "string", nullable: true, privacy: "P1", pii: true }),
    chain_or_local: spec({ type: "enum", enum: ["大型連鎖", "在地"], nullable: true, privacy: "P1" }),
    agent_alias: spec({ type: "string", nullable: true, privacy: "P1", pii: true }),
    status: spec({ type: "string", nullable: true, privacy: "P1" }),
    id: spec({ type: "string", nullable: true, privacy: "P1", pii: false })
  },
  travel: {
    place_alias: spec({ type: "string", nullable: true, privacy: "P2", pii: true }),
    mode: spec({ type: "string", nullable: true, privacy: "P2" }),
    minutes_to_area: spec({ type: "string", nullable: true, privacy: "P2" }),
    minutes_back: spec({ type: "string", nullable: true, privacy: "P2" }),
    as_of: spec({ type: "date", nullable: true, privacy: "P2" }),
    id: spec({ type: "string", nullable: true, privacy: "P2", pii: false })
  },
  properties: {
    id: spec({ type: "string", nullable: false, privacy: "P1", pii: true }),
    area_code: spec({ type: "string", nullable: true, privacy: "P1" }),
    ask_total: spec({ type: "amount", exclusiveMin: 0, nullable: true, privacy: "P1" }),
    ping_total: spec({ type: "number", exclusiveMin: 0, nullable: true, privacy: "P1" }),
    rooms: spec({ type: "number", min: 0, max: 20, nullable: true, privacy: "P1" }),
    // 第 13 輪 E7：衛浴數。現場依房數、衛浴數建立對應數量的站；只記錄，不影響評分指紋
    baths: spec({ type: "number", min: 0, max: 20, nullable: true, privacy: "P1" }),
    parking_price_ask: spec({ type: "amount", min: 0, nullable: true, privacy: "P1" }),
    parking_ping: spec({ type: "number", min: 0, nullable: true, privacy: "P1" }),
    parking_included_in_ask: spec({ type: "boolean", nullable: true, privacy: "P1" }),
    has_parking: spec({ type: "boolean", nullable: true, privacy: "P1" }),
    hold_years: spec({ type: "number", min: 0, nullable: true, privacy: "P1" }),
    commute_min: spec({ type: "number", min: 0, nullable: true, privacy: "P1" }),
    walk_min: spec({ type: "number", min: 0, nullable: true, privacy: "P1" }),
    transit_status: spec({ type: "string", nullable: true, privacy: "P1" }),
    walk_mode: spec({ type: "string", nullable: true, privacy: "P1" }),
    timing_score: spec({ type: "integer", enum: [0, 1, 2], nullable: true, privacy: "P1" }),
    school_zone_claimed: spec({ type: "string", nullable: true, privacy: "P1" }),
    school_zone_verified: spec({ type: "string", nullable: true, privacy: "P1" }),
    school_zone_verified_date: spec({ type: "date", nullable: true, privacy: "P1", notAfterRef: true }),
    school_zone_year: spec({ type: "integer", min: 1, max: 3000, nullable: true, privacy: "P1" }),
    fake_alerts: spec({ type: "integer", min: 0, max: 99, nullable: true, privacy: "P1" }),
    fake_price_alt: spec({ type: "string", nullable: true, privacy: "P1" }),
    age: spec({ type: "number", min: 0, max: 200, nullable: true, privacy: "P1" }),
    mgmt_fee_yuan: spec({ type: "amount_yuan", min: 0, nullable: true, privacy: "P1" }),
    product_type: spec({ type: "string", nullable: true, privacy: "P1" }),
    prev_ask_total: spec({ type: "amount", exclusiveMin: 0, nullable: true, privacy: "P1" }),
    community_name: spec({ type: "string", nullable: true, privacy: "P1", pii: true }),
    // 第 16 輪 F-R16-53：記憶備註（幫自己記住這間：在哪個路段、靠近哪裡、第一印象；不要寫門牌號碼）。只記錄，不影響評分指紋
    memory_note: spec({ type: "string", maxLength: 200, nullable: true, privacy: "P1", pii: true }),
    // 第 17 輪 F-R17-04：加分項（書房、可放一套健身器材的空間），值只有有、無、未知；只記錄與顯示，不影響評分指紋，不進筆記匯出
    has_study: spec({ type: "enum", enum: ["有", "無", "未知"], nullable: true, privacy: "P1" }),
    gym_space: spec({ type: "enum", enum: ["有", "無", "未知"], nullable: true, privacy: "P1" }),
    // 第 12 輪：從筆記匯入的待看物件欄位（只記錄，不影響評分指紋）
    notes_status: spec({ type: "enum", enum: NOTES_STATUSES, nullable: true, privacy: "P1" }),
    floor_note: spec({ type: "string", maxLength: 100, nullable: true, privacy: "P1", pii: true }),
    agent_company: spec({ type: "string", maxLength: 60, nullable: true, privacy: "P1", pii: true }),
    branch_label: spec({ type: "string", maxLength: 60, nullable: true, privacy: "P1", pii: true }),
    agent_alias: spec({ type: "string", maxLength: 60, nullable: true, privacy: "P1", pii: true }),
    planned_date: spec({ type: "date", nullable: true, privacy: "P1" }),
    source_note: spec({ type: "string", maxLength: 300, nullable: true, privacy: "P1", pii: true }),
    notes_ref: spec({ type: "string", maxLength: 200, nullable: true, privacy: "P1", pii: false }),
    notes_updated_at: spec({ type: "datetime", nullable: true, privacy: "P1" }),
    from_notes: spec({ type: "boolean", nullable: true, privacy: "P1" })
  },
  // 第 13 輪 C5：問價紀錄（每間物件一份時間序紀錄）。金額單位是萬，照 amount 的規則解析；誰說的與備註要掃個資
  price_log: {
    date: spec({ type: "date", nullable: false, privacy: "P1" }),
    kind: spec({ type: "enum", enum: PRICE_LOG_KINDS, nullable: false, privacy: "P1" }),
    amount: spec({ type: "amount", exclusiveMin: 0, nullable: true, privacy: "P1" }),
    who: spec({ type: "string", maxLength: 30, nullable: true, privacy: "P1", pii: true }),
    note: spec({ type: "string", maxLength: 300, nullable: true, privacy: "P1", pii: true })
  },
  // 第 13 輪 C4：階段筆記的文字；E7：使用者自訂題目的文字（兩者都會進匯出到筆記，所以要掃個資）
  stage_note: {
    text: spec({ type: "string", maxLength: 500, nullable: false, privacy: "P1", pii: true })
  },
  coach_custom_item: {
    text: spec({ type: "string", maxLength: 60, nullable: false, privacy: "P1", pii: true })
  },
  visits: {
    id: spec({ type: "string", nullable: false, privacy: "P1", pii: false }),
    start: spec({ type: "datetime", nullable: true, privacy: "P1" }),
    end: spec({ type: "datetime", nullable: true, privacy: "P1" }),
    branch_label: spec({ type: "string", nullable: true, privacy: "P1" }),
    agent_alias: spec({ type: "string", nullable: true, privacy: "P1", pii: true }),
    slot_id: spec({ type: "string", nullable: true, privacy: "P1" }),
    n_listings: spec({ type: "integer", min: 0, nullable: true, privacy: "P1" }),
    occurred_at: spec({ type: "datetime", nullable: true, privacy: "P1" }),
    paper_makeup: spec({ type: "boolean", nullable: true, privacy: "P1" }),
    makeup_photo_id: spec({ type: "string", nullable: true, privacy: "P1", pii: false }),
    paper_makeup_reason: spec({ type: "string", nullable: true, privacy: "P1", pii: true })
  },
  evidence: {
    commute_measured_min: spec({ type: "number", min: 0, max: 300, integer: true, nullable: true, privacy: "P1" }),
    remaining_weeks_estimate: spec({ type: "number", min: 0, max: 52, nullable: true, privacy: "P1" }),
    goal_commit_choice: spec({ type: "integer", enum: [45, 50], nullable: true, privacy: "P1" }),
    course_b_blank_ratio: spec({ type: "ratio", min: 0, max: 1, nullable: true, privacy: "P1" }),
    course_b_drafts: spec({ type: "integer", min: 0, max: 20, nullable: true, privacy: "P1" }),
    overtime_consent: spec({ type: "boolean", nullable: true, privacy: "P1" }),
    overtime_hours_used: spec({ type: "number", min: 0, max: 80, nullable: true, privacy: "P1" }),
    s1_complete: spec({ type: "boolean", nullable: true, privacy: "P1" }),
    s2_complete: spec({ type: "boolean", nullable: true, privacy: "P1" }),
    w3_goal_rechecked: spec({ type: "boolean", nullable: true, privacy: "P1" })
  }
};

/** 物件表單與控制器共用的可編輯欄位清單（評分指紋也用它，避免再漏欄）。 */
export const PROPERTY_EDIT_KEYS = [
  "area_code", "ask_total", "ping_total", "rooms", "parking_price_ask", "parking_ping",
  "parking_included_in_ask", "has_parking", "hold_years", "commute_min", "walk_min",
  "transit_status", "walk_mode", "timing_score", "school_zone_claimed", "school_zone_verified",
  "school_zone_verified_date", "school_zone_year", "fake_alerts", "fake_price_alt", "age",
  "mgmt_fee_yuan", "product_type", "prev_ask_total", "community_name"
];

export const IMPORT_REQUIRED = {
  settings: ["partner_gate", "purpose", "goal_commit", "program_weeks", "sessions_per_week", "online_transcribe"],
  finance: ["search_range_high", "down_has_borrowed", "reserve_months", "hold_years_min", "tighten_only", "finance_as_of"],
  profile: ["target_areas", "deal_breaker"],
  areas: ["area_code", "area_label"]
};

/**
 * 看房前清單的題目（screen_key）怎麼影響評分。評分只經 resolveScreenInputs 取值。
 * kind：
 *  - number：物件欄位優先，其次清單答案，最後才是區域預設；兩邊都有值但不同就待核並標衝突
 *  - map：物件欄位有值用欄位，沒有才用清單答案（先查表轉成 0、1、2）
 *  - judge、judge3：只提供上限（自評較低時取較低者，自評不能把分數拉高）
 *  - record：只記錄，與計算值不同時只提醒
 *  - decision：看後決策（淘汰、觀察）
 */
export const SCREEN_BINDINGS = {
  commute: { kind: "number", field: "commute_min", areaField: "commute_min" },
  walk: { kind: "number", field: "walk_min", areaField: "walk_min" },
  timing: { kind: "map", field: "timing_score", map: { 後段: 2, 中段: 1, 前段: 0, "不適用（成熟區）": 2 } },
  location: { kind: "judge", caps: { 不符合: 0, 部分符合: 1, 符合: 2 } },
  product: { kind: "judge", caps: { 不符合: 0, 部分符合: 1, 符合: 2 } },
  cashflow: { kind: "judge3", caps: { 撐不住: 0, 勉強: 1, 可撐: 2 } },
  unit_price: { kind: "record", compare: "unit" },
  price_band: { kind: "record", compare: "ask_total" },
  volume: { kind: "record" },
  decision: { kind: "decision" }
};

export const META_FINANCE_KEYS = new Set(["source_type", "verified", "content_hash"]);

export function fieldSpec(table, key) {
  return FIELD_TABLES[table]?.[key] || null;
}

export function fieldLabel(key) {
  return FIELD_LABELS[key] || key;
}

/**
 * 數字解析（單一入口，分三種單位，F9-05）。
 * 白話：以前所有數字欄位共用一個解析，一律把結尾的「萬」吃掉，所以管理費寫「1萬」被存成 1 元、房數寫「1萬」存成 1，
 * 都不報錯。現在依欄位的單位分三種：
 *  - parsePlainNumber：純數字，不接受任何單位字（房數、分鐘、坪數、月數、年數、比例都用它）
 *  - parseAmountWan：萬元金額，接受「萬、千萬、億」結尾，結果單位是萬；寫「元」要擋並提示單位是萬元
 *  - parseAmountYuan：元金額，接受「元、千、萬」結尾，結果單位是元；「千萬」以上要擋
 * 三者共用同一段前處理：去空白、全形轉半形、去千分位逗號、擋十六進位。
 */
function toHalfwidthNumberText(s) {
  return String(s)
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xff10 + 48))
    .replace(/[＋－．，]/g, (c) => ({ "＋": "+", "－": "-", "．": ".", "，": "," })[c])
    .replace(/　/g, " ");
}

/** 共用前處理。回傳 { done } 表示已經有結果，或 { s } 表示去掉空白與千分位逗號後的文字。 */
function numberFront(raw) {
  if (raw === undefined || raw === null) return { done: { state: "blank", value: null } };
  if (typeof raw === "boolean") return { done: { state: "invalid", value: null, error: "不可為布林" } };
  if (typeof raw === "object") return { done: { state: "invalid", value: null, error: "不可為物件或陣列" } };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { done: { state: "invalid", value: null, error: "不是有限數字" } };
    return { done: { state: "ok", value: raw } };
  }
  const s0 = String(raw).trim();
  if (!s0) return { done: { state: "blank", value: null } };
  if (/^0x/i.test(s0)) return { done: { state: "invalid", value: null, error: "不接受十六進位" } };
  return { s: toHalfwidthNumberText(s0).replace(/,/g, "").replace(/\s/g, "") };
}

const NUMBER_BODY = /^[+-]?\d+(\.\d+)?$/;

function finishParsed(body, mul = 1) {
  if (!NUMBER_BODY.test(body)) return { state: "invalid", value: null, error: "格式錯誤" };
  const n = Number(body);
  if (!Number.isFinite(n)) return { state: "invalid", value: null, error: "不是有限數字" };
  return { state: "ok", value: mul === 1 ? n : Math.round(n * mul * 1e6) / 1e6 };
}

/** 純數字：不接受任何單位字。"30"、"1,234.5" 可；"1萬"、"30分" 回 invalid。 */
export function parsePlainNumber(raw) {
  const f = numberFront(raw);
  if (f.done) return f.done;
  if (!NUMBER_BODY.test(f.s) && /^[+-]?\d+(\.\d+)?[^\d.]/.test(f.s)) {
    return { state: "invalid", value: null, error: "這格只填數字，不要加單位", reason: "unit" };
  }
  return finishParsed(f.s);
}

/** 萬元金額（結果單位是萬）："1500"、"1500萬"、"1.5千萬" 都是 1500；"1.5億" 是 15000；"1500元" 擋下。 */
export function parseAmountWan(raw) {
  const f = numberFront(raw);
  if (f.done) return f.done;
  let body = f.s.replace(/(萬|億)元$/, "$1");
  let mul = 1;
  if (/千萬$/.test(body)) {
    mul = 1000;
    body = body.slice(0, -2);
  } else if (/萬$/.test(body)) {
    body = body.slice(0, -1);
  } else if (/億$/.test(body)) {
    mul = 10000;
    body = body.slice(0, -1);
  } else if (/元$/.test(body)) {
    return { state: "invalid", value: null, error: "這格的單位是萬元，請填萬為單位的數字（例如 1500 或 1500萬），不要寫元", reason: "unit" };
  }
  return finishParsed(body, mul);
}

/** 元金額（結果單位是元）："3000"、"3000元"、"3千" 都是 3000；"1萬" 是 10000；"1千萬" 以上擋下。 */
export function parseAmountYuan(raw) {
  const f = numberFront(raw);
  if (f.done) return f.done;
  let body = f.s;
  let mul = 1;
  if (/(千萬|億)元?$/.test(body)) {
    return { state: "invalid", value: null, error: "金額過大，請確認（這格以元計，最大寫到「萬」）", reason: "range" };
  }
  if (/萬元?$/.test(body)) {
    mul = 10000;
    body = body.replace(/萬元?$/, "");
  } else if (/千元?$/.test(body)) {
    mul = 1000;
    body = body.replace(/千元?$/, "");
  } else if (/元$/.test(body)) {
    body = body.slice(0, -1);
  }
  return finishParsed(body, mul);
}

/**
 * 舊名稱，保留給還沒分單位的呼叫端：現在等同 parsePlainNumber，不再默默吃掉「萬」。
 * 解析萬元金額的地方請改用 parseAmountWan 或 normalizeValue(表, 欄位, 值)。
 */
export function parseNumericRaw(raw) {
  return parsePlainNumber(raw);
}

/** 依欄位代號查規格表，回這個欄位的數字單位種類："wan"（萬元金額）、"yuan"（元金額）或 "plain"。 */
const KIND_CACHE = new Map();
export function numberKindOf(key) {
  if (KIND_CACHE.has(key)) return KIND_CACHE.get(key);
  let kind = "plain";
  const own = notesPropKey(key); // 待看物件匯入列的 parking_price、mgmt_fee 要照物件資料表的單位解析
  for (const table of Object.values(FIELD_TABLES)) {
    const t = table[own]?.type;
    if (t === "amount") kind = "wan";
    else if (t === "amount_yuan" && kind === "plain") kind = "yuan";
  }
  KIND_CACHE.set(key, kind);
  return kind;
}

/** 依單位種類解析（kind 是 "wan"、"yuan" 或 "plain"）。 */
export function parseNumberByKind(kind, raw) {
  if (kind === "wan") return parseAmountWan(raw);
  if (kind === "yuan") return parseAmountYuan(raw);
  return parsePlainNumber(raw);
}

/** 依欄位代號解析：用規格表裡這個欄位的單位種類。 */
export function parseNumberForKey(key, raw) {
  return parseNumberByKind(numberKindOf(key), raw);
}

function isBlankRaw(raw) {
  return raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");
}

function isRealIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const [y, m, d] = String(s).split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function isRealDateTime(s) {
  if (s instanceof Date) return Number.isFinite(s.getTime());
  if (typeof s !== "string") return false;
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\s*$/.exec(s);
  if (!m) return false;
  if (!isRealIsoDate(`${m[1]}-${m[2]}-${m[3]}`)) return false;
  if (m[4] !== undefined) {
    const hh = parseNumericRaw(m[4]).value;
    const mm = parseNumericRaw(m[5]).value;
    const ss = m[6] !== undefined ? parseNumericRaw(m[6]).value : 0;
    if (hh > 23 || mm > 59 || ss > 59) return false;
  }
  return Number.isFinite(Date.parse(s));
}

function boolish(raw) {
  if (raw === true || raw === "是") return { state: "ok", value: true };
  if (raw === false || raw === "否") return { state: "ok", value: false };
  if (isBlankRaw(raw)) return { state: "blank", value: null };
  return { state: "invalid", value: null, error: "布林值不合法" };
}

/**
 * @returns {{state: "ok"|"blank"|"invalid", value: *, error?: string}}
 */
export function normalizeValue(table, key, raw, opts = {}) {
  if (table === "finance" && META_FINANCE_KEYS.has(key)) {
    return { state: "invalid", value: null, error: "請改寫入 finance_meta" };
  }
  const def = fieldSpec(table, key);
  if (!def) {
    return { state: "invalid", value: null, error: `未知欄位 ${table}.${key}` };
  }
  if (isBlankRaw(raw)) {
    if (def.nullable === false) return { state: "invalid", value: null, error: "不可空白" };
    return { state: "blank", value: null };
  }

  const finishNumber = (n) => {
    const needInt = def.integer === true || def.type === "integer";
    if (needInt && !Number.isInteger(n)) {
      if (Number.isInteger(Math.round(n)) && Math.abs(n - Math.round(n)) < 1e-9) n = Math.round(n);
      else return { state: "invalid", value: null, error: "必須是整數" };
    }
    if (def.enum && !def.enum.includes(n)) {
      return { state: "invalid", value: null, error: `必須是 ${def.enum.join("、")} 之一` };
    }
    if (def.min !== undefined && n < def.min) return { state: "invalid", value: null, error: n < 0 ? "不得為負（低於下限）" : `不可小於下限 ${def.min}` };
    if (def.max !== undefined && n > def.max) return { state: "invalid", value: null, error: `不可大於 ${def.max}` };
    if (def.exclusiveMin !== undefined && n <= def.exclusiveMin) {
      return { state: "invalid", value: null, error: `必須大於 ${def.exclusiveMin}` };
    }
    if (n < 0 && (def.type === "amount" || def.type === "amount_yuan" || def.min >= 0)) {
      return { state: "invalid", value: null, error: "不得為負" };
    }
    return { state: "ok", value: n };
  };

  if (def.type === "boolean") return boolish(raw);

  if (def.type === "enum") {
    if (def.enum === YES_NO || (Array.isArray(def.enum) && def.enum[0] === "是" && def.enum[1] === "否")) {
      if (raw === true || raw === "是") return { state: "ok", value: "是" };
      if (raw === false || raw === "否") return { state: "ok", value: "否" };
    }
    const s = typeof raw === "string" ? raw.trim() : raw;
    if (!def.enum.includes(s)) return { state: "invalid", value: null, error: `必須是 ${def.enum.join("、")} 之一` };
    return { state: "ok", value: s };
  }

  if (def.type === "date") {
    const s = String(raw).trim();
    if (!isRealIsoDate(s)) return { state: "invalid", value: null, error: "日期不存在" };
    if (def.notAfterRef && opts.referenceDate && s > opts.referenceDate) {
      return { state: "invalid", value: null, error: "公告日期不得晚於參考日" };
    }
    return { state: "ok", value: s };
  }

  if (def.type === "datetime") {
    if (!isRealDateTime(raw)) return { state: "invalid", value: null, error: "時間無法解析" };
    return { state: "ok", value: raw };
  }

  if (def.type === "string") {
    if (typeof raw === "object" || typeof raw === "boolean") {
      return { state: "invalid", value: null, error: "字串不可為物件或布林" };
    }
    const s = String(raw);
    if (def.maxLength !== undefined && s.length > def.maxLength) {
      return { state: "invalid", value: null, error: `長度不可超過 ${def.maxLength}` };
    }
    if (def.pattern && !new RegExp(def.pattern).test(s)) {
      return { state: "invalid", value: null, error: "格式不符" };
    }
    if (def.pii !== false) {
      const hit = findPii(s);
      if (hit) return { state: "invalid", value: null, error: PII_MESSAGE, detail: hit };
    }
    return { state: "ok", value: s };
  }

  const parsed = def.type === "amount" ? parseAmountWan(raw) : def.type === "amount_yuan" ? parseAmountYuan(raw) : parsePlainNumber(raw);
  if (parsed.state !== "ok") return parsed;
  if (def.type === "ratio" || def.type === "amount" || def.type === "amount_yuan" || def.type === "number" || def.type === "integer") {
    return finishNumber(parsed.value);
  }
  return { state: "ok", value: parsed.value };
}

/** 存起來的值有沒有變（原始型別用嚴格相等，物件與陣列用鍵排序後的 JSON 比）。 */
function sameStored(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((kk) => [kk, x[kk]])) : x));
    return canon(a) === canon(b);
  }
  return false;
}

/**
 * 只對「這次有改的欄位」報錯；沒改的欄位若不合法，保留原值不動（F9-13）。
 * 白話：舊資料裡有一個不合現行規則的值（例如預備金月數是負 1），使用者只想改一個不相關的欄位，
 * 不能因為那個舊值被擋住；只擋「這次新造成的違規」。
 * before 是改之前存的內容，after 是這次要存的完整內容。回傳 { ok, value, errors }。
 */
export function normalizeChanged(table, before = {}, after = {}) {
  const out = { ...after };
  const errors = [];
  for (const k of Object.keys(after)) {
    const r = normalizeValue(table, k, after[k]);
    const changed = !sameStored(before?.[k], after[k]);
    if (r.state === "invalid") {
      if (changed) errors.push({ field: k, message: r.error });
      else out[k] = before[k];
    } else if (r.state === "ok") out[k] = r.value;
    else out[k] = after[k] === "" || after[k] == null ? after[k] : null;
  }
  return { ok: errors.length === 0, value: out, errors };
}

export function numericOrNull(table, key, raw) {
  const r = normalizeValue(table, key, raw);
  return r.state === "ok" ? r.value : null;
}

export function capIsBlank(finance) {
  const r = normalizeValue("finance", "budget_cap_total", finance?.budget_cap_total);
  return r.state !== "ok";
}

export function parseTimeRange(start, end) {
  if (isBlankRaw(start) || isBlankRaw(end)) return { state: "blank", minutes: null };
  if (!isRealDateTime(start) || !isRealDateTime(end)) return { state: "invalid", minutes: null, error: "時間無法解析" };
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { state: "invalid", minutes: null, error: "時間無法解析" };
  const minutes = (b - a) / 60000;
  if (!Number.isFinite(minutes) || minutes <= 0) return { state: "invalid", minutes: null, error: "結束必須晚於開始" };
  return { state: "ok", minutes };
}

export function normalizeCondition(raw) {
  if (isBlankRaw(raw) || raw === "待核") return { state: "blank", value: null };
  if (raw === 2 || raw === "2" || raw === "無問題" || raw === "無") return { state: "ok", value: "無問題", score: 2 };
  if (raw === 1 || raw === "1" || raw === "輕微") return { state: "ok", value: "輕微", score: 1 };
  if (raw === 0 || raw === "0" || raw === "嚴重") return { state: "ok", value: "嚴重", score: 0 };
  if (raw === "看不出來") return { state: "blank", value: "看不出來" };
  return { state: "invalid", value: null, error: "屋況只接受無問題、輕微、嚴重、看不出來" };
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function rotr32(v, n) {
  return (v >>> n) | (v << (32 - n));
}

function sha256HexSync(str) {
  const bytes = new TextEncoder().encode(str);
  const bitLenHi = Math.floor((bytes.length * 8) / 0x100000000);
  const bitLenLo = (bytes.length * 8) >>> 0;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(paddedLen - 8, bitLenHi, false);
  dv.setUint32(paddedLen - 4, bitLenLo, false);

  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const W = new Uint32Array(64);
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i += 1) W[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr32(W[i - 15], 7) ^ rotr32(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr32(W[i - 2], 17) ^ rotr32(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + W[i]) >>> 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return H.map((x) => x.toString(16).padStart(8, "0")).join("");
}

/**
 * v1.13.0 以前存的「內容指紋」其實就是這段明文 JSON（鍵排序、不含來源與核實欄位）。
 * 現在只用來辨認舊資料（升級時比對舊指紋與目前財務內容是否一致），不再存進任何地方（F-R11-04）。
 */
export function legacyFinanceContentText(finance = {}) {
  const src = finance !== null && typeof finance === "object" && !Array.isArray(finance) ? finance : {};
  const keys = Object.keys(src)
    .filter((k) => !META_FINANCE_KEYS.has(k))
    .sort();
  const o = {};
  for (const k of keys) o[k] = src[k];
  return JSON.stringify(o);
}

/** 財務內容的單向指紋（SHA-256，固定 64 個十六進位字元）；不含任何明文數字或欄位名稱。 */
export function financeContentHash(finance = {}) {
  return sha256HexSync(legacyFinanceContentText(finance));
}

export function stripFinanceMeta(finance = {}) {
  const out = { ...finance };
  delete out.source_type;
  delete out.verified;
  delete out.content_hash;
  return out;
}

export function normalizeObject(table, obj = {}, opts = {}) {
  const errors = [];
  const value = {};
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, value: {}, errors: [{ field: table, message: "必須是物件" }] };
  }
  const spec = FIELD_TABLES[table];
  for (const [k, raw] of Object.entries(obj)) {
    if (table === "finance" && META_FINANCE_KEYS.has(k)) continue;
    if (spec && !spec[k]) continue;
    const r = normalizeValue(table, k, raw, opts);
    if (r.state === "invalid") errors.push({ field: k, message: r.error, table });
    else if (r.state === "blank") {
      if (raw !== undefined) value[k] = null;
    } else value[k] = r.value;
  }
  if (spec) {
    for (const [k, def] of Object.entries(spec)) {
      if (def.nullable === false && (value[k] === undefined || value[k] === null || value[k] === "")) {
        if (obj[k] !== undefined || opts.purpose === "import") {
          const r = normalizeValue(table, k, obj[k], opts);
          if (r.state !== "ok") errors.push({ field: k, message: r.error || "不可空白", table });
        }
      }
    }
  }
  return { ok: errors.length === 0, value, errors };
}

function answerBlank(v) {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

function nonNegative(raw) {
  const r = parseNumericRaw(raw);
  return r.state === "ok" && r.value >= 0 ? r.value : null;
}

/**
 * 每個題目回傳 { value, source, pending, conflict, cap }：
 *  source 是 "property"（物件欄位）、"checklist"（清單答案）、"area"（區域預設）或 "conflict"。
 */
export function resolveScreenInputs(property = {}, area = {}, answers = {}) {
  const values = {};
  const conflicts = [];
  for (const [key, bind] of Object.entries(SCREEN_BINDINGS)) {
    const rawAns = answers?.[key];
    const ans = typeof rawAns === "string" ? rawAns.trim() : rawAns;
    const blank = answerBlank(ans);
    if (bind.kind === "number") {
      const propVal = nonNegative(property?.[bind.field]);
      const listVal = !blank && ans !== "待核" ? nonNegative(ans) : null;
      if (propVal !== null && listVal !== null && propVal !== listVal) {
        values[key] = { value: null, source: "conflict", pending: true, conflict: true, property: propVal, checklist: listVal };
        conflicts.push({ key, field: bind.field, screen: listVal, property: propVal });
      } else if (propVal !== null) {
        values[key] = { value: propVal, source: "property", pending: false };
      } else if (listVal !== null) {
        values[key] = { value: listVal, source: "checklist", pending: false };
      } else if (!blank) {
        values[key] = { value: null, source: "checklist", pending: true };
      } else {
        const inherited = nonNegative(area?.[bind.areaField]);
        values[key] = inherited !== null
          ? { value: inherited, source: "area", pending: false }
          : { value: null, source: "none", pending: true };
      }
    } else if (bind.kind === "map") {
      const propRaw = property?.[bind.field];
      const propVal = propRaw === 0 || propRaw === 1 || propRaw === 2 ? propRaw : nonNegative(propRaw);
      const mapped = !blank && Object.prototype.hasOwnProperty.call(bind.map, ans) ? bind.map[ans] : null;
      if (propVal === 0 || propVal === 1 || propVal === 2) {
        values[key] = { value: propVal, source: "property", pending: false };
      } else if (mapped !== null) {
        values[key] = { value: mapped, source: "checklist", pending: false };
      } else if (!blank) {
        values[key] = { value: null, source: "checklist", pending: true };
      } else {
        values[key] = { value: null, source: "none", pending: true };
      }
    } else if (bind.kind === "judge" || bind.kind === "judge3") {
      if (blank) values[key] = { value: null, source: "none", pending: false, cap: null };
      else if (ans === "待核") values[key] = { value: ans, source: "checklist", pending: true, cap: null };
      else if (Object.prototype.hasOwnProperty.call(bind.caps, ans)) {
        const cap = bind.caps[ans];
        values[key] = { value: ans, source: "checklist", pending: false, cap: cap >= 2 ? null : cap };
      } else values[key] = { value: ans, source: "checklist", pending: true, cap: null };
    } else {
      values[key] = { value: blank ? null : ans, source: blank ? "none" : "checklist", pending: false };
    }
  }
  return { values, conflicts, pending: false };
}

/**
 * @param {"import"|"state"|"backup"} purpose
 */
export function validateTable(table, obj, { purpose = "state" } = {}) {
  const errors = [];
  if (obj == null) {
    if (purpose === "import" && IMPORT_REQUIRED[table]) {
      return { ok: false, errors: [{ field: table, message: "缺表" }] };
    }
    return { ok: true, errors: [] };
  }
  const norm = normalizeObject(table, obj);
  errors.push(...norm.errors);
  if (purpose === "import") {
    for (const k of IMPORT_REQUIRED[table] || []) {
      const r = normalizeValue(table, k, obj[k]);
      if (r.state === "blank" || r.state === "invalid") {
        errors.push({ field: k, message: "匯入必填" });
      }
    }
  }
  return { ok: errors.length === 0, errors, value: norm.value };
}

export function displayValue(table, key, value, { vaultOpen = false } = {}) {
  const def = fieldSpec(table, key);
  // 查不到規格的欄位一律當私密處理，沒解鎖時不回原值
  if (!def) {
    if (!vaultOpen) return value === undefined || value === null || value === "" ? "（未填）" : "••••";
    return value == null ? "" : String(value);
  }
  if (def.privacy === "P2" && !vaultOpen) {
    if (value === undefined || value === null || value === "") return "（未填）";
    return "••••";
  }
  if (value === undefined || value === null || value === "") return "";
  return String(value);
}

export function schemaBoundsFor(table, key) {
  const def = fieldSpec(table, key);
  if (!def) return null;
  const out = {};
  if (def.min !== undefined) out.minimum = def.min;
  if (def.max !== undefined) out.maximum = def.max;
  if (def.exclusiveMin !== undefined) out.exclusiveMinimum = def.exclusiveMin;
  return out;
}

/** Only true and 「是」 count as on. 「否」、空字串、null 都是否。 */
export function isFlagOn(v) {
  return v === true || v === "是";
}

export function toFiniteNumber(raw) {
  const r = parseNumericRaw(raw);
  return r.state === "ok" ? r.value : null;
}

/**
 * Evidence parser: only a finite decimal number or numeric string.
 * Arrays, booleans, hex, and whitespace-only are not ok.
 */
export function parseEvidence(raw, spec = {}) {
  if (raw === undefined || raw === null) return { state: "missing", value: null };
  if (typeof raw === "boolean" || Array.isArray(raw) || (typeof raw === "object" && typeof raw !== "number")) {
    return { state: "invalid", value: null, error: "證據必須是數字" };
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return { state: "missing", value: null };
    if (/^0x/i.test(s)) return { state: "invalid", value: null, error: "不接受十六進位" };
    if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return { state: "invalid", value: null, error: "證據必須是十進位數字" };
  }
  if (typeof raw === "number" && !Number.isFinite(raw)) {
    return { state: "invalid", value: null, error: "不是有限數字" };
  }
  const parsed = parseNumericRaw(raw);
  if (parsed.state !== "ok") {
    return { state: parsed.state === "blank" ? "missing" : "invalid", value: null, error: parsed.error };
  }
  let n = parsed.value;
  if (spec.integer && !Number.isInteger(n)) {
    if (Math.abs(n - Math.round(n)) < 1e-9) n = Math.round(n);
    else return { state: "invalid", value: null, error: "必須是整數" };
  }
  if (n < 0 && spec.min === undefined) return { state: "invalid", value: null, error: "證據不可為負" };
  if (spec.min !== undefined && n < spec.min) return { state: "invalid", value: null, error: `不可小於 ${spec.min}` };
  if (spec.max !== undefined && n > spec.max) return { state: "invalid", value: null, error: `不可大於 ${spec.max}` };
  if (spec.exclusiveMin !== undefined && n <= spec.exclusiveMin) {
    return { state: "invalid", value: null, error: `必須大於 ${spec.exclusiveMin}` };
  }
  if (spec.positive && !(n > 0)) return { state: "invalid", value: null, error: "必須為正數" };
  return { state: "ok", value: n };
}
