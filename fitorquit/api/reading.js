export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { me, company } = req.body || {};
  if (!me || !company) return res.status(400).json({ error: 'Missing data' });

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const SHEET_URL  = process.env.GOOGLE_SHEET_URL;

  if (!GEMINI_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

  // ── 1. Google Sheets 기록 ─────────────────────────────────────
  if (SHEET_URL) {
    try {
      await fetch(SHEET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          이름:      me.name,
          생년월일:  me.birth,
          '음력/양력': me.calendar,
          생시:      me.birthTime || '모름',
          성별:      me.gender,
          출생도시:  me.city,
          MBTI:      me.mbti || '미입력',
          수집일시:  new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
        }),
      });
    } catch (e) {
      console.error('Sheet error:', e.message);
      // 시트 실패해도 결과는 계속 진행
    }
  }

  // ── 2. Gemini API 호출 ────────────────────────────────────────
  const prompt = `당신은 한국 명리학과 사주팔자 전문가입니다. 아래 정보를 바탕으로 사람과 회사의 궁합을 분석하세요.

[의뢰인]
이름: ${me.name} / 성별: ${me.gender} / 생년월일: ${me.birth}(${me.calendar}) / 생시: ${me.birthTime||'모름'} / 출생지: ${me.city} / MBTI: ${me.mbti||'미입력'}

[회사]
회사명: ${company.name} / 업종: ${company.industry} / 설립일: ${company.founded} / 규모: ${company.size} / 소재지: ${company.location} / 사풍: ${company.culture}

아래 JSON 형식으로만 응답하세요. 코드블록, 설명, 주석 없이 순수 JSON만 출력하세요.

{
  "score": (0~100 정수),
  "verdict": "한 줄 판정문 (예: 운명적 인연, 시험의 관계, 성장의 파트너)",
  "summary": "총평 2~3문장. 솔직하고 공감가는 말투로.",
  "ohaeng": {
    "me": "의뢰인 주요 오행 한자 1~2글자 (木火土金水 중)",
    "company": "회사 주요 오행 한자 1~2글자 (木火土金水 중)",
    "relation": "상생 또는 상극 또는 중립",
    "desc": "오행 관계 설명 2문장"
  },
  "career":    { "score": (0~100 정수), "desc": "직장운 설명 2~3문장" },
  "money":     { "score": (0~100 정수), "desc": "재물운 설명 2~3문장" },
  "relations": { "score": (0~100 정수), "desc": "인간관계운 설명 2~3문장" },
  "warnings":  ["주의사항1", "주의사항2", "주의사항3"],
  "advice":    "마지막 한마디. 시적이고 기억에 남는 문장."
}`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 1500 },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini error:', errText);
      let detail = errText;
      try { detail = JSON.parse(errText)?.error?.message || errText; } catch(e) {}
      return res.status(502).json({ error: `Gemini API error: ${detail}` });
    }

    const data = await geminiRes.json();
    let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/,'').trim();
    const start = text.indexOf('{');
    const end   = text.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('JSON not found in Gemini response');
    const result = JSON.parse(text.slice(start, end + 1));

    return res.status(200).json(result);

  } catch (e) {
    console.error('Handler error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
