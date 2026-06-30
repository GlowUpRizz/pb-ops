// /api/monday-pb  ─ Monday 보드에서 [PB] 항목만 추출
// 필요한 환경변수: MONDAY_TOKEN, MONDAY_BOARD_ID
export default async function handler(req, res) {
  const TOKEN = process.env.MONDAY_TOKEN;
  const BOARD = process.env.MONDAY_BOARD_ID || "5015049982";
  if (!TOKEN) return res.status(500).json({ error: "MONDAY_TOKEN 미설정" });

  // ⚠️ 컬럼 title은 너희 보드 실제 헤더와 100% 일치해야 함. 다르면 아래 문자열만 수정.
  const COL = { channel: "채널/크리에이터명", date: "판매일정", revenue: "목표매출" };

  const query = `query {
    boards(ids: [${BOARD}]) {
      items_page(limit: 200) {
        items { name column_values { column { title } text } }
      }
    }
  }`;

  try {
    const r = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: TOKEN, "API-Version": "2024-10" },
      body: JSON.stringify({ query }),
    });
    const j = await r.json();
    const items = j?.data?.boards?.[0]?.items_page?.items || [];
    const get = (cv, title) => cv.find((c) => c.column.title === title)?.text || "";

    const out = items
      .filter((it) => it.name.includes("[PB]"))
      .map((it) => ({
        brand: it.name,
        channel: get(it.column_values, COL.channel),
        date: get(it.column_values, COL.date),
        revenue: Number(get(it.column_values, COL.revenue).replace(/[^\d]/g, "")) || 0,
      }));

    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=1800");
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
