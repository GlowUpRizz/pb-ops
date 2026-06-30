// /api/monday-pb  ─ Monday 보드에서 [PB] 항목만 추출
// 필요한 환경변수: MONDAY_TOKEN, MONDAY_BOARD_ID
export default async function handler(req, res) {
  const TOKEN = process.env.MONDAY_TOKEN;
  const BOARD = process.env.MONDAY_BOARD_ID || "5015049982";
  if (!TOKEN) return res.status(500).json({ error: "MONDAY_TOKEN 미설정" });

  // ⚠️ 컬럼 title은 너희 보드 실제 헤더와 100% 일치해야 함. 다르면 아래 문자열만 수정.
  const COL = { channel: "채널/크리에이터명", date: "판매일정", revenue: "목표매출", deal: "거래액", actual: "실매출" };

  const firstQuery = `query {
    boards(ids: [${BOARD}]) {
      items_page(limit: 500) {
        cursor
        items { name column_values { column { title } text } }
      }
    }
  }`;
  const nextQuery = (cursor) => `query {
    next_items_page(limit: 500, cursor: "${cursor}") {
      cursor
      items { name column_values { column { title } text } }
    }
  }`;

  async function runQuery(query) {
    const r = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: TOKEN, "API-Version": "2024-10" },
      body: JSON.stringify({ query }),
    });
    return r.json();
  }

  try {
    // Monday는 한 번에 최대 200개씩만 주므로, cursor가 더 있는 동안 계속 다음 페이지를 가져와서
    // 보드 전체 항목(여러 달의 그룹 포함)이 빠지지 않도록 한다.
    let allItems = [];
    const first = await runQuery(firstQuery);
    let page = first?.data?.boards?.[0]?.items_page;
    if (page) {
      allItems = allItems.concat(page.items || []);
      let cursor = page.cursor;
      let guard = 0;
      while (cursor && guard < 20) {
        const next = await runQuery(nextQuery(cursor));
        const np = next?.data?.next_items_page;
        if (!np) break;
        allItems = allItems.concat(np.items || []);
        cursor = np.cursor;
        guard++;
      }
    }

    const get = (cv, title) => cv.find((c) => c.column.title === title)?.text || "";
    const num = (v) => Number((v || "").replace(/[^\d.-]/g, "")) || 0;

    const out = allItems
      .filter((it) => it.name.includes("[PB]"))
      .map((it) => ({
        brand: it.name,
        channel: get(it.column_values, COL.channel),
        date: get(it.column_values, COL.date),
        revenue: num(get(it.column_values, COL.revenue)),
        deal: num(get(it.column_values, COL.deal)),
        actual: num(get(it.column_values, COL.actual)),
      }));

    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=1800");
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
