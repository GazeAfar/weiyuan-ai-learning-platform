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
const MODEL_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 60000);

export function getAiConfig() {
  return {
    configured: Boolean(OPENAI_API_KEY),
    model: OPENAI_MODEL,
  };
}

export async function createQuestions(params: {
  subject: string;
  topic: string;
  topics?: string[];
  count: number;
  difficulty: string;
  region: string;
  grade: string;
  edition: string;
  mode?: string;
}) {
  ensureConfigured();

  const system = [
    '你是一名中国初中命题老师。',
    '你的任务是生成适合指定地区和年级学生的学科练习题。',
    '题目必须围绕指定知识点，难度适中偏中考风格。',
    '请优先贴合当地常见教材进度与考查方式。',
    '对于物理中的常识题，要大量结合生活场景、常见数量级和常见单位。',
    '如果是物理学科，请参考中考常见卷型结构来分配题型难度。',
    '输出必须是严格 JSON，不要出现 markdown 代码块。',
  ].join(' ');

  const user = {
    ...params,
    output_schema: {
      questions: [
        {
          id: 'string',
          type: 'single_choice | fill_blank | drawing | experiment_textbook | experiment_innovative | calculation | short_answer',
          stem: 'string',
          options: ['A. ...', 'B. ...'],
          answer: 'string',
          explanation: 'string',
          points: ['string'],
        },
      ],
    },
    rules: [
      '物理题型优先覆盖：选择题、填空题、画图题、实验题、计算题。',
      '实验题分为两类：书本实验题、创新实验题。',
      '必须严格按照 count 指定的题目数量输出，不能少题，不能多题。',
      '如果题量较多，请尽量模拟中考卷型分布：前面的选择题偏基础，后段选择题可更综合、更难。',
      '如果用户要求 15 道左右的整卷风格，可参考“1~12 相对基础，13~15 更综合更难”的结构。',
      '至少包含 1 道选择题和 1 道计算/分析题（如果 count >= 4）。',
      '如果 mode=regular，保持正常卷型结构，不要刻意提高生活常识题比例。',
      '如果 mode=common_sense，集中生成物理中考前1~5题那种送分性质的基础常识题。',
      '如果提供了 topics 数组，表示应围绕这些知识点混合组卷，而不是只按单一知识点出题。',
      '如果 mode=common_sense 且 topic=__all__ 或 topics 覆盖全部知识点，表示可从当前学科所有相关知识点中抽取基础物理常识题。',
      '当 mode=common_sense 时，不要把普通知识点题、计算题、实验分析题、画图题伪装成常识题。',
      '当 mode=common_sense 时，题目应主要考查基础物理量、常见单位、生活中的典型数值估测、常见物理现象判断、基础仪器用途、知名物理学家及其代表贡献。',
      '当 mode=common_sense 时，只允许生成两类题：single_choice 和 fill_blank。',
      '当 mode=common_sense 时，必须以选择题为绝对主体，大部分题目都应为 single_choice。',
      '当 mode=common_sense 时，fill_blank 只能作为少量补充，且应优先考查单位填写，不要扩展成普通填空题。',
      '当 mode=common_sense 时，不得生成 calculation、drawing、experiment_textbook、experiment_innovative、short_answer 等其他题型。',
      '当 mode=common_sense 时，整体难度应明显偏基础，体现中考选择题前1~5题的送分题风格。',
      '当 mode=common_sense 时，应优先使用生活中的真实场景、常见数据范围和典型物理量数量级。',
      '如果是生活常识类填空题，优先考查单位填写，例如长度、质量、速度、功率、电压、电流等单位。',
      '画图题要明确说明作图要求，例如光路图、电路图、受力图等。',
      '实验题要写清实验目的、器材、步骤、现象或结论，并尽量贴近初三学生常见实验。',
      '解析要用适合初三学生的表达。',
      '答案必须明确可判分。',
      '不要重复题目。',
    ],
  };

  return await callModelAndParse(system, JSON.stringify(user));
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
    '如果错题属于物理常识题，优先沿用生活化场景、常见数据和单位判断题风格。',
    '如果错题属于实验题或画图题，要保持相同题型方向。',
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
          type: 'single_choice | fill_blank | drawing | experiment_textbook | experiment_innovative | calculation | short_answer',
          stem: 'string',
          options: ['A. ...', 'B. ...'],
          answer: 'string',
          explanation: 'string',
          points: ['string'],
        },
      ],
    },
    rules: [
      '如果原错题偏生活常识题，相似题也优先生成中考前1~5题风格的基础选择题或单位填空题。',
      '生活常识类相似题避免变成正式知识点综合题，优先保持送分题、基础判断题风格。',
      '生活常识类相似题只允许生成选择题和少量单位填空题，不得扩展出计算、实验、画图、简答等题型。',
      '生活常识类相似题优先考查基础物理量、单位、科学家、生活估测和常见现象判断。',
      '如果生成填空题，优先考查物理单位或常见量纲判断。',
      '如果原错题是书本实验题，相似题也优先生成书本实验题。',
      '如果原错题是创新实验题，相似题也优先生成创新实验题。',
      '如果原错题是画图题，相似题也优先生成同类作图题。',
    ],
  };

  return await callModelAndParse(system, JSON.stringify(user));
}

function ensureConfigured() {
  if (!OPENAI_API_KEY) {
    throw new Error('未检测到 OPENAI_API_KEY，暂时无法调用真实 AI 出题。');
  }
}

async function callModelAndParse(system: string, user: string) {
  const first = await callModel(system, user);
  try {
    return parseQuestions(first);
  } catch {
    const retryUser = `${user}\n\n请特别注意：上一次返回的 JSON 格式不正确。这一次只能返回可直接解析的 JSON，不要添加任何解释。`;
    const second = await callModel(system, retryUser);
    try {
      return parseQuestions(second);
    } catch {
      throw new Error('题目生成失败，请重试一次。');
    }
  }
}

async function callModel(system: string, user: string) {
  const mergedPrompt = [
    '你必须遵守以下出题要求。',
    '',
    '【系统要求】',
    system,
    '',
    '【用户需求】',
    user,
    '',
    '请直接返回严格 JSON，不要输出 markdown，不要输出额外说明。',
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.7,
        messages: [
          { role: 'user', content: mergedPrompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`AI 接口调用失败：${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI 未返回可用内容。');
    return content;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`AI 生成超时（>${Math.round(MODEL_TIMEOUT_MS / 1000)}秒），请重试或减少题量。`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseQuestions(text: string) {
  let parsed: { questions?: GeneratedQuestion[] } | null = null;

  for (const candidate of buildJsonCandidates(text)) {
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch {}
  }

  if (!parsed) {
    throw new Error('AI 返回格式错误。');
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

function buildJsonCandidates(text: string) {
  const raw = text.trim();
  const strippedFence = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  const match = strippedFence.match(/\{[\s\S]*\}/);
  const extracted = match ? match[0] : strippedFence;

  const normalized = extracted
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');

  return Array.from(new Set([raw, strippedFence, extracted, normalized].filter(Boolean)));
}
