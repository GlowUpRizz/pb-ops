// /api/sheet-pb  ─ 'PB 마스터 타임라인' 탭(단계/주차) + 'PB 자금 계획' 탭(선금 금액)을 함께 읽어서 파싱
// 셀에 들어있는 텍스트(샘플링/선금/생산/입고예정/용기CT/기획)의 "열 위치"가 곧 주차.
// 'PB 자금 계획' 탭의 F열("선금/잔금 50")은 품목명(A열)으로 매칭하여 deposit 단계의 금액으로 붙인다.
// 필요 환경변수: SHEET_ID, GOOGLE_SA_EMAIL, GOOGLE_SA_KEY
import { google } from "googleapis";

const TAB = "PB 마스터 타임라인";
const MONEY_TAB = "PB 자금 계획";
// 데이터 시작행(헤더 4행 스킵) / 컬럼: A No, B 브랜드, C 카테고리, D 품목, E SKU, F~ 26개 주차슬롯
const RANGE = `'${TAB}'!A5:AE300`;
// PB 자금 계획: 헤더 4행, 데이터 5행부터. A 품목, F 선금/잔금 50
const MONEY_RANGE = `'${MONEY_TAB}'!A5:F300`;

const LABEL = {
  "기획": "plan", "샘플링": "sample", "최샘": "sample",
  "선금": "deposit", "생산": "prod", "입고예정": "stock",
  "용기CT": "etc", "용기": "etc",
};

// 품목명 매칭용 정규화(공백/특수문자 제거)
const norm = (s) => (s || "").replace(/[\[\]()（）\s]/g, "").trim();

function parseRow(c) {
  const item = (c[3] || "").trim();
  if (!item) return null;
  const slots = c.slice(5, 5 + 26); // F..AE = 26 슬롯
  const markers = [];
  slots.forEach((v, i) => {
    const t = LABEL[(v || "").trim()];
    if (t) markers.push([i + 1, t]); // slot 1-based
  });
  const ph = markers.map(([slot, t], j) => {
    const end = j + 1 < markers.length ? markers[j + 1][0] - 1 : slot;
    return [t, slot, Math.max(end, slot)];
  });
  return { brand: (c[1] || "").trim(), cat: (c[2] || "").trim(), item, sku: Number(c[4]) || 1, ph, saleRef: "" };
}

// 'PB 자금 계획' 탭에서 품목명 -> 선금 금액 맵 생성
function parseMoneyRows(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const item = (row[0] || "").trim();
    if (!item) return;
    const raw = (row[5] || "").toString().replace(/[^\d.-]/g, ""); // F열: 선금/잔금 50
    const amount = Number(raw) || 0;
    if (amount > 0) map.set(norm(item), amount);
  });
  return map;
}

// production 항목에 선금 금액을 매칭해서 ph 배열의 deposit 항목에 amount를 붙임
function attachDepositAmount(production, moneyMap) {
  return production.map((p) => {
    const key = norm(p.item);
    let amount = moneyMap.get(key);
    if (amount == null) {
      // 정확히 일치하지 않으면 포함 관계로 한 번 더 시도(시트 표기가 약간 다를 수 있음)
      for (const [k, v] of moneyMap) {
        if (k && (key.includes(k) || k.includes(key))) { amount = v; break; }
      }
    }
    if (amount == null) return p;
    const ph = p.ph.map((seg) => (seg[0] === "deposit" ? [...seg, amount] : seg));
    return { ...p, ph };
  });
}

export default async function handler(req, res) {
  try {
    const auth = new google.auth.JWT(
      process.env.GOOGLE_SA_EMAIL, null,
      (process.env.GOOGLE_SA_KEY || "").replace(/\\n/g, "\n"),
      ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    );
    const sheets = google.sheets({ version: "v4", auth });
    const [timelineRes, moneyRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: process.env.SHEET_ID, range: RANGE }),
      sheets.spreadsheets.values.get({ spreadsheetId: process.env.SHEET_ID, range: MONEY_RANGE }).catch(() => ({ data: { values: [] } })),
    ]);
    let out = (timelineRes.data.values || []).map(parseRow).filter(Boolean);
    const moneyMap = parseMoneyRows(moneyRes.data.values);
    if (moneyMap.size) out = attachDepositAmount(out, moneyMap);
    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=1800");
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
