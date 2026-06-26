export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { me, company } = req.body;
  if (!me || !company) return res.status(400).json({ error: 'Missing data' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const SHEET_URL = process.env.GOOGLE_SHEET_URL;

  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'API key not configured' });

  // ── 1. Google Sheets에 유저 정보 기록 ──────────────────────────
  if (SHEET_URL) {
    try {
      await fetch(SHEET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          이름: me.name,
          생년월일: me.birth,
          '음력/양력': me.calendar,
          생시: me.birthTime || '모름',
          성별: me.gender,
          출생도시: me.city,
          MBTI: me.mbti || '미입력',
          수집일시: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
        }),
      });
    } catch (e) {
      // 시트 기록 실패해도 사주 결과는 계속 진행
      console.error('Sheet logging failed:', e);
    }
  }

  // ── 2. Anthropic API 호출 ──────────────────────────────────────
  const systemPrompt = `당신은 한국 명리학과 사주팔자 전문가입니다.
사용자의 사주 정보와 회사 정보를 받아 궁합을 분석합니다.
반드시 아래 JSON 형식으로만 응답하세요. 마크다운 코드블록, 설명 텍스트, 주석 없이 순수 JSON만 출력하세요.

{
  "score": (0-100 정수),
  "verdict": "한 줄 판정문",
  "summary": "총평 2-3문장",
  "ohaeng": {
    "me": "의뢰인 주요 오행 한자 1-2글자 (木火土金水 중)",
    "company": "회사 주요 오행 한자 1-2글자",
    "relation": "상생 또는 상극 또는 중립",
    "desc": "오행 관계 설명 2문장"
  },
  "career": { "score": (0-100 정수), "desc": "직장운 설명 2-3문장" },
  "money": { "score": (0-100 정수), "desc": "재물운 설명 2-3문장" },
  "relations": { "score": (0-100 정수), "desc": "인간관계운 설명 2-3문장" },
  "warnings": ["주의사항1", "주의사항2", "주의사항3"],
  "advice": "마지막 한마디. 시적이고 기억에 남는 문장."
}`;

  const userPrompt = `[의뢰인]
이름: ${me.name} / 성별: ${me.gender} / 생년월일: ${me.birth}(${me.calendar}) / 생시: ${me.birthTime || '모름'} / 출생지: ${me.city} / MBTI: ${me.mbti || '미입력'}

[회사]
회사명: ${company.name} / 업종: ${company.industry} / 설립일: ${company.founded} / 규모: ${company.size} / 소재지: ${company.location} / 사풍: ${company.culture}`;

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('Anthropic error:', errText);
      return res.status(502).json({ error: 'Anthropic API error', detail: errText });
    }

    const data = await anthropicRes.json();
    let text = (data.content || []).map(i => i.text || '').join('').trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('JSON not found');
    const result = JSON.parse(text.slice(start, end + 1));

    return res.status(200).json(result);
  } catch (e) {
    console.error('Error:', e);
    return res.status(500).json({ error: e.message });
  }
}
