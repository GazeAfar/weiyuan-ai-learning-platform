type GeneratedQuestion = {
  id: string;
  type: string;
  stem: string;
  options: string[];
  answer: string;
  explanation: string;
  points: string[];
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

export function getAiConfig() {
  return {
    configured: Boolean(OPENAI_API_KEY),
    model: OPENAI_MODEL,
  };
}

export async function createQuestions(params: {
  subject: string;
  topic: string;
  count: number;
  difficulty: string;
  region: string;
  grade: string;
  edition: string;
}) {
  ensureConfigured();

  const system = [
    '你是一名中国初中命题老师。',
    '你的任务是生成适合指定地区和年级学生的学科练习题。',
    '题目必须围绕指定知识点，难度适中偏中考风格。',
    '请优先贴合当地常见教材进度与考查方式。',
    '输出必须是严格 JSON，不要出现 markdown 代码块。',
  ].join(' ');

  const user = {
    ...params,
    output_schema: {
      questions: [
        {
          id: 'string',
          type: 'single_choice | fill_blank | calculation | short_answer',
          stem: 'string',
          options: ['A. ...', 'B. ...'],
          answer: 'string',
          explanation: 'string',
          points: ['string'],
        },
      ],
    },
    rules: [
      '至少包含 1 道选择题和 1 道计算/分析题（如果 count >= 4）。',
      '解析要用适合初三学生的表达。',
      '答案必须明确可判分。',
      '不要重复题目。',
    ],
  };

  const content = await callModel(system, JSON.stringify(user));
  return parseQuestions(content);
}

export async function createSimilarQuestions(params: {
  subject: string;
  region: string;
  grade: string;
  edition: string;
  selected: Array<{ topic: string; stem: string; answer: string; explanation: string; type: string }>;
}) {
  ensureConfigured();

  const system = [
    '你是一名中国初中命题老师。',
    '请根据学生错题生成相似题，要求保持同知识点和相近难度，但题干和数字不能照抄。',
    '请优先贴合指定地区和教材背景。',
    '输出必须是严格 JSON，不要出现 markdown 代码块。',
  ].join(' ');

  const user = {
    task: '根据错题生成相似题',
    subject: params.subject,
    region: params.region,
    grade: params.grade,
    edition: params.edition,
    selected_wrong_questions: params.selected.map((item, index) => ({
      index: index + 1,
      topic: item.topic,
      stem: item.stem,
      answer: item.answer,
      explanation: item.explanation,
      questionType: item.type,
    })),
    output_schema: {
      questions: [
        {
          id: 'string',
          type: 'single_choice | fill_blank | calculation | short_answer',
          stem: 'string',
          options: ['A. ...', 'B. ...'],
          answer: 'string',
          explanation: 'string',
          points: ['string'],
        },
      ],
    },
  };

  const content = await callModel(system, JSON.stringify(user));
  return parseQuestions(content);
}

function ensureConfigured() {
  if (!OPENAI_API_KEY) {
    throw new Error('未检测到 OPENAI_API_KEY，暂时无法调用真实 AI 出题。');
  }
}

async function callModel(system: string, user: string) {
  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`AI 接口调用失败：${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI 未返回可用内容。');
  return content;
}

function parseQuestions(text: string) {
  let parsed: { questions?: GeneratedQuestion[] };

  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI 返回内容无法解析为 JSON。');
    parsed = JSON.parse(match[0]);
  }

  return {
    questions: (parsed.questions || []).map((q, index) => ({
      id: q.id || `q-${Date.now()}-${index}`,
      type: q.type || 'short_answer',
      stem: q.stem || '题干缺失',
      options: Array.isArray(q.options) ? q.options : [],
      answer: q.answer || '',
      explanation: q.explanation || '',
      points: Array.isArray(q.points) ? q.points : [],
    })),
  };
}
