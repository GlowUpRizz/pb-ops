// /api/quote ─ 관리자가 대시보드 화면에서 입력하는 오늘의 문구를
// 'PB 자금 계획' 탭의 Z1 셀에 저장/조회. 별도 탭을 새로 만들지 않고
// 기존 자금 계획 시트의 안 쓰는 칸 하나를 문구 저장용으로 재사용한다.
// GET  -> { quote: string } 현재 문구 조회 (누구나 가능)
// POST -> { pw, quote } 관리자 비밀번호 확인 후 문구 갱신
// 필요 환경변수: SHEET_ID, GOOGLE_SA_EMAIL, GOOGLE_SA_KEY, ADMIN_PW(없으면 기본값 사용)
import { google } from "googleapis";

const MONEY_TAB = "PB 자금 계획";
const QUOTE_CELL = `'${MONEY_TAB}'!A1000`;
const DEFAULT_QUOTE = "야호~";
const ADMIN_PW = process.env.ADMIN_PW || "rizz2026";

function getAuth(readonly) {
  return new google.auth.JWT(
    process.env.GOOGLE_SA_EMAIL,
    null,
    (process.env.GOOGLE_SA_KEY || "").replace(/\\n/g, "\n"),
    [readonly ? "https://www.googleapis.com/auth/spreadsheets.readonly" : "https://www.googleapis.com/auth/spreadsheets"]
  );
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const sheets = google.sheets({ version: "v4", auth: getAuth(true) });
      const r = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SHEET_ID, range: QUOTE_CELL });
      const val = (r.data.values || [])[0]?.[0];
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
      return res.status(200).json({ quote: (val && val.trim()) || DEFAULT_QUOTE });
    }

    if (req.method === "POST") {
      const { pw, quote } = req.body || {};
      if (pw !== ADMIN_PW) {
        // 임시 디버그: 평문 노출 없이 서버가 인식한 ADMIN_PW의 길이와 양끝 글자만 보여줌
        const mask = (s) => (s ? `${s[0]}${"*".repeat(Math.max(0, s.length - 2))}${s[s.length - 1]} (len:${s.length})` : "(empty)");
        const sa = process.env.GOOGLE_SA_KEY || "";
        return res.status(401).json({
          error: "비밀번호 오류",
          debug: {
            envAdminPwMasked: mask(ADMIN_PW),
            receivedPwMasked: mask(pw),
            envSource: process.env.ADMIN_PW ? "env" : "default-fallback",
            looksLikeKeyFragment: sa.includes(ADMIN_PW) ? "GOOGLE_SA_KEY 안에 이 값이 포함되어 있음(잘못 복사됐을 가능성)" : "아니오",
          },
        });
      }
      const text = (quote || "").toString().trim().slice(0, 80); // 너무 길어지는 것 방지
      if (!text) return res.status(400).json({ error: "문구를 입력해주세요" });
      const sheets = google.sheets({ version: "v4", auth: getAuth(false) });
      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.SHEET_ID,
        range: QUOTE_CELL,
        valueInputOption: "RAW",
        requestBody: { values: [[text]] },
      });
      return res.status(200).json({ quote: text });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
