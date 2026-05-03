import { getSubjectConfig } from '@/lib/curriculum';

type GeneratedQuestion = {
  id: string;
  type: string;
  stem: string;
  options: string[];
  answer: string;
  explanation: string;
  points: string[];
};

const QUESTION_TYPE_SCHEMA = 'single_choice | fill_blank | drawing | experiment_textbook | experiment_innovative | calculation | short_answer | inference';
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
  const coveragePlan = buildCoveragePlan(params);

  const system = buildGenerationSystemPrompt(params.subject);

  const user = {
    ...params,
    output_schema: {
      questions: [buildQuestionSchema(params.subject)],
    },
    rules: buildGenerationRules(params),
    question_blueprint: coveragePlan,
  };

  return await callModelAndParse(system, JSON.stringify(user));
}

type CoverageBlueprintItem = {
  no: number;
  preferredType: 'single_choice' | 'fill_blank' | 'mixed' | 'inference';
  focusTopics: string[];
  intent: string;
};

function buildGenerationSystemPrompt(subject: string) {
  return [
    '你是一名中国初中命题老师。',
    '你的任务是生成适合指定地区和年级学生的学科练习题。',
    '题目必须围绕指定知识点，难度适中偏中考风格。',
    '请优先贴合当地常见教材进度与考查方式。',
    ...buildSubjectSystemLines(subject),
    '不得引入超出初中要求的内容。',
    '输出必须是严格 JSON，不要出现 markdown 代码块。',
  ].join(' ');
}

function buildSimilarSystemPrompt(subject: string) {
  return [
    '你是一名中国初中命题老师。',
    '请根据学生错题生成相似题，要求保持同知识点和相近难度，但题干和数字不能照抄。',
    '请优先贴合指定地区和教材背景。',
    ...buildSubjectSystemLines(subject),
    '输出必须是严格 JSON，不要出现 markdown 代码块。',
  ].join(' ');
}

function buildSubjectSystemLines(subject: string) {
  if (subject === '化学') {
    return [
      '如果是化学学科，请严格按江苏省南京市初三、人教版、初中化学范围命题。',
      '化学只生成推断题，题目应体现南京初中化学常见的物质鉴别、转化关系和实验现象线索。',
      '绝对不得超过初中化学水平；一旦某个概念、反应原理、术语、计算方法、离子分析思路更像高中内容，就不要使用。',
      '不得使用高中有机推断、复杂氧化还原、电化学、离子方程式、溶度积、物质的量、同分异构体、官能团、燃烧热、化学平衡、盐类水解、弱电解质电离、电子排布、原子轨道、氧化数配平等超纲内容。',
      '如果拿不准某道题是否超纲，必须主动降级为更基础、更直白的初中推断题。宁可简单，也不能超纲。',
    ];
  }

  if (subject === '物理') {
    return [
      '对于物理中的常识题，要大量结合生活场景、常见数量级和常见单位。',
      '如果是物理学科，请严格按江苏省南京市初三、苏教版、当前中考范围命题。',
      '如果是物理学科，请参考中考常见卷型结构来分配题型难度。',
    ];
  }

  return [];
}

function buildQuestionSchema(subject: string) {
  if (subject === '化学') {
    return {
      id: 'string',
      type: 'inference',
      stem: 'string',
      options: [],
      answer: 'string',
      explanation: 'string',
      points: ['string'],
    };
  }

  return {
    id: 'string',
    type: QUESTION_TYPE_SCHEMA,
    stem: 'string',
    options: ['A. ...', 'B. ...'],
    answer: 'string',
    explanation: 'string',
    points: ['string'],
  };
}

function buildGenerationRules(params: {
  subject: string;
  topics?: string[];
  count: number;
  difficulty: string;
  mode?: string;
}) {
  const baseRules = [
    '必须严格按照 count 指定的题目数量输出，不能少题，不能多题。',
    '如果提供了 topics 数组，表示应围绕这些知识点混合组卷，而不是只按单一知识点出题。',
    '如果提供了 question_blueprint，必须逐题遵守该蓝图，保证每一道题都对应指定的知识点覆盖要求，不要自行忽略。',
    '解析要用适合初三学生的表达。',
    '答案必须明确可判分。',
    '不要重复题目。',
  ];

  if (params.subject === '化学') {
    return [
      ...baseRules,
      '当 subject=化学 时，必须只生成化学推断题；每道题的 type 必须是 inference。',
      '所有化学题都必须严格以江苏省南京市初三正在使用的人教版初中化学教材范围、表述习惯和常见中考命题风格为准，不得混入其他地区版本、其他教材体系或高中教材中的知识点。',
      '不得生成 single_choice、fill_blank、drawing、experiment_textbook、experiment_innovative、calculation、short_answer 等非推断题题型。',
      '题干要呈现清晰推断链，可使用 A、B、C 等未知物、框图式转化、文字线索、实验现象、颜色变化、沉淀或气体信息。',
      '每道题至少包含 3 条有效线索或 2 步以上转化关系，不能把普通记忆填空题伪装成推断题。',
      '推断范围应严格控制在初中常见物质和人教版表述内，例如 O2、H2、H2O、CO2、CO、C、Fe、Cu、Mg、Zn、CaCO3、HCl、稀H2SO4、NaOH、Ca(OH)2、Na2CO3、CuSO4、FeCl3、BaCl2、AgNO3、NaCl 等。',
      '重点考查物质性质、检验鉴别、除杂、转化关系、常见气体制取与净化、酸碱盐反应和金属活动性。',
      '严禁出现初中阶段通常不作为命题核心的内容，例如浓硫酸的强氧化性、硝酸根特殊反应、铵盐深度鉴定、陌生有机物推断、多步氧化还原配平、离子共存深度分析、pH定量计算、化学平衡移动等。',
      '严禁为了“冲刺”而拔高到高中难度；冲刺也只能是初中知识点之间更综合，不是更超纲。',
      '答案应列出各未知物名称或化学式，并给出关键化学方程式或判断理由。',
      '基础难度线索应直接、物质数量少；提升难度可有两到三步转化；冲刺难度可以跨酸碱盐、金属、碳氧化物综合，但仍必须完全停留在初中范围。',
      '如果提供多个 topics，应优先设计融合多个知识点的推断链，而不是逐点拆成孤立小问。',
      '若某种说法、某个物质用途、某类实验设计在人教版初中化学教材中并不常见或不属于南京初三常规教学与中考考查口径，就不要使用。',
      '生成每一道化学题前，先自检：这道题是否只依赖江苏南京初三人教版课内知识就能稳定做出？如果不是，就重写。',
    ];
  }

  return [
    ...baseRules,
    '物理题型优先覆盖：选择题、填空题、画图题、实验题、计算题。',
    '实验题分为两类：书本实验题、创新实验题。',
    '必须严格控制在江苏省南京市初三物理常见考查范围内。',
    '严禁生成超纲内容，例如：频率单位换算、开尔文K及摄氏温度与开尔文换算、明显偏高中化的概念或公式。',
    '如果题量较多，请尽量模拟中考卷型分布：前面的选择题偏基础，后段选择题可更综合、更难。',
    '如果用户要求 15 道左右的整卷风格，可参考“1~12 相对基础，13~15 更综合更难”的结构。',
    '至少包含 1 道选择题和 1 道计算/分析题（如果 count >= 4）。',
    '如果 mode=regular，保持正常卷型结构，不要刻意提高生活常识题比例。',
    '如果 mode=regular 且提供了多个知识点，应显式提高综合题比例，至少部分题目融合2到3个相关知识点，不要几乎每题只考一个孤立知识点。',
    '如果 mode=regular 且 topics 较多，要尽量覆盖声、热、光、力、电中的代表性考点；若 topics 中包含功和机械能、功率、电功率等内容，必须体现这些考点。',
    '如果 mode=common_sense，集中生成物理中考前1~5题那种送分性质的基础常识题。',
    '如果 mode=common_sense 且 topic=__all__ 或 topics 覆盖全部知识点，表示题目应尽量广覆盖当前学科各模块，尤其不能漏掉功和机械能、功率、电功率、热学、电学、光学、力学等代表性内容。',
    '如果 mode=common_sense 且 topic=__all__ 或 topics 覆盖全部知识点，并且 count >= 12，必须让大多数主要模块都至少出现1题；如果 count >= 18，应尽量让几乎所有已选知识点或对应模块都得到体现。',
    '当 mode=common_sense 时，不要把普通知识点题、计算题、实验分析题、画图题伪装成常识题。',
    '当 mode=common_sense 时，题目应主要考查基础物理量、常见单位、生活中的典型数值估测、常见物理现象判断、基础仪器用途、知名物理学家及其代表贡献。',
    '当 mode=common_sense 时，也要适度加入更灵活的生活情境题，可在一道题里自然融合两个彼此相关的基础知识点，但整体仍应易于初三学生作答。',
    '当 mode=common_sense 时，只允许生成两类题：single_choice 和 fill_blank。',
    '当 mode=common_sense 时，必须以选择题为绝对主体，大部分题目都应为 single_choice。',
    '当 mode=common_sense 时，fill_blank 只能作为少量补充，且应优先考查单位填写，不要扩展成普通填空题。',
    '当 mode=common_sense 时，不得生成 calculation、drawing、experiment_textbook、experiment_innovative、short_answer 等其他题型。',
    '当 mode=common_sense 时，整体难度应明显偏基础，体现中考选择题前1~5题的送分题风格。',
    '当 mode=common_sense 时，应优先使用生活中的真实场景、常见数据范围和典型物理量数量级。',
    '如果是生活常识类填空题，优先考查单位填写，例如长度、质量、速度、功率、电压、电流等单位。',
    '画图题要明确说明作图要求，例如光路图、电路图、受力图等。',
    '实验题要写清实验目的、器材、步骤、现象或结论，并尽量贴近初三学生常见实验。',
  ];
}

function buildCoveragePlan(params: {
  subject: string;
  topics?: string[];
  count: number;
  mode?: string;
}) {
  const selectedTopics = (params.topics || []).filter(Boolean);
  if (!selectedTopics.length) return [];

  if (params.subject === '化学') {
    return buildChemistryCoveragePlan(selectedTopics, params.count);
  }

  const moduleGroups = getSubjectConfig(params.subject).modules
    .map((module) => ({
      module: module.name,
      topics: module.topics.filter((topic) => selectedTopics.includes(topic)),
    }))
    .filter((module) => module.topics.length);

  if (!moduleGroups.length) return [];

  const blueprints: CoverageBlueprintItem[] = [];
  const add = (preferredType: CoverageBlueprintItem['preferredType'], focusTopics: string[], intent: string) => {
    if (blueprints.length >= params.count) return;
    blueprints.push({
      no: blueprints.length + 1,
      preferredType,
      focusTopics,
      intent,
    });
  };

  const isCommonSense = params.mode === 'common_sense';

  for (const topic of selectedTopics) {
    add(
      isCommonSense ? 'single_choice' : 'mixed',
      [topic],
      isCommonSense ? '基础生活常识覆盖，确保该知识点至少出现一次。' : '单知识点基础覆盖。',
    );
  }

  const modulePairs = moduleGroups.flatMap((module) => {
    const pairs: string[][] = [];
    for (let i = 0; i < module.topics.length - 1; i += 1) {
      pairs.push([module.topics[i], module.topics[i + 1]]);
    }
    if (module.topics.length >= 3) {
      pairs.push([module.topics[0], module.topics[module.topics.length - 1]]);
    }
    return pairs.map((focusTopics) => ({ module: module.module, focusTopics }));
  });

  for (const pair of modulePairs) {
    add(
      isCommonSense ? 'single_choice' : 'mixed',
      pair.focusTopics,
      isCommonSense
        ? `生活情境综合题，融合 ${pair.focusTopics.join('、')} 两个相关知识点。`
        : `综合题，融合 ${pair.focusTopics.join('、')}。`,
    );
  }

  const priorityTopics = ['功和机械能', '功率', '电功率', '物态变化', '机械运动', '压强', '浮力', '欧姆定律'];
  for (const topic of priorityTopics) {
    if (selectedTopics.includes(topic)) {
      add(
        isCommonSense ? 'single_choice' : 'mixed',
        [topic],
        isCommonSense ? '重点考点复现，防止核心知识点缺失。' : '重点考点强化。',
      );
    }
  }

  while (blueprints.length < params.count) {
    const topic = selectedTopics[blueprints.length % selectedTopics.length];
    const neighbor = selectedTopics[(blueprints.length + 1) % selectedTopics.length];
    const focusTopics = topic === neighbor ? [topic] : [topic, neighbor];
    add(
      isCommonSense ? (blueprints.length % 6 === 5 ? 'fill_blank' : 'single_choice') : 'mixed',
      focusTopics,
      isCommonSense ? '补足覆盖并保持生活化、灵活化。' : '补足整体覆盖并增加综合度。',
    );
  }

  return blueprints.slice(0, params.count);
}

function buildChemistryCoveragePlan(selectedTopics: string[], count: number) {
  const moduleGroups = getSubjectConfig('化学').modules
    .map((module) => ({
      module: module.name,
      topics: module.topics.filter((topic) => selectedTopics.includes(topic)),
    }))
    .filter((module) => module.topics.length);

  const blueprints: CoverageBlueprintItem[] = [];
  const add = (focusTopics: string[], intent: string) => {
    if (blueprints.length >= count) return;
    blueprints.push({
      no: blueprints.length + 1,
      preferredType: 'inference',
      focusTopics,
      intent,
    });
  };

  for (const topic of selectedTopics) {
    add([topic], `围绕 ${topic} 设计初中化学推断题，至少包含物质性质、现象或转化线索。`);
  }

  const modulePairs = moduleGroups.flatMap((module) => {
    const pairs: string[][] = [];
    for (let i = 0; i < module.topics.length - 1; i += 1) {
      pairs.push([module.topics[i], module.topics[i + 1]]);
    }
    if (module.topics.length >= 3) {
      pairs.push([module.topics[0], module.topics[module.topics.length - 1]]);
    }
    return pairs;
  });

  for (const pair of modulePairs) {
    add(pair, `融合 ${pair.join('、')}，用 A~F 物质关系或实验现象组织推断链。`);
  }

  const priorityTopics = ['常见酸碱盐', '复分解反应', '物质的检验与鉴别', '物质的转化与推断', '碳和碳的氧化物', '金属与金属材料', '气体制取与净化'];
  for (const topic of priorityTopics) {
    if (selectedTopics.includes(topic)) {
      add([topic], '南京初中化学推断题高频考点强化，突出检验、鉴别和转化关系。');
    }
  }

  while (blueprints.length < count) {
    const topic = selectedTopics[blueprints.length % selectedTopics.length];
    const neighbor = selectedTopics[(blueprints.length + 1) % selectedTopics.length];
    const focusTopics = topic === neighbor ? [topic] : [topic, neighbor];
    add(focusTopics, '补足推断题覆盖，保持初中范围内的综合度。');
  }

  return blueprints.slice(0, count);
}

export async function createSimilarQuestions(params: {
  subject: string;
  region: string;
  grade: string;
  edition: string;
  selected: Array<{ topic: string; stem: string; answer: string; explanation: string; type: string }>;
}) {
  ensureConfigured();

  const system = buildSimilarSystemPrompt(params.subject);

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
      questions: [buildQuestionSchema(params.subject)],
    },
    rules: buildSimilarRules(params.subject),
  };

  return await callModelAndParse(system, JSON.stringify(user));
}

function buildSimilarRules(subject: string) {
  const baseRules = [
    '输出题目数量必须等于 selected_wrong_questions 的数量。',
    '保持原错题的知识点和相近难度，但题干、情境、物质或数字不能照抄。',
    '答案必须明确可判分，解析要用适合初三学生的表达。',
  ];

  if (subject === '化学') {
    return [
      ...baseRules,
      '当 subject=化学 时，相似题必须全部是化学推断题；每道题的 type 必须是 inference。',
      '不得生成普通选择题、普通填空题、计算题、实验报告题、画图题或泛泛简答题。',
      '即使原错题 type 不是 inference，也要改写为初中化学推断题形式。',
      '每题要保留原知识点方向，并用新的物质关系、实验现象、颜色、沉淀、气体或反应条件设计推断链。',
      '答案应列出推断出的物质名称或化学式，并给出关键方程式或判断理由。',
      '严格控制在人教版初中化学和南京初三常见考查范围内。',
    ];
  }

  return [
    ...baseRules,
    '如果原错题偏生活常识题，相似题也优先生成中考前1~5题风格的基础选择题或单位填空题。',
    '生活常识类相似题避免变成正式知识点综合题，优先保持送分题、基础判断题风格。',
    '生活常识类相似题只允许生成选择题和少量单位填空题，不得扩展出计算、实验、画图、简答等题型。',
    '生活常识类相似题优先考查基础物理量、单位、科学家、生活估测和常见现象判断。',
    '如果生成填空题，优先考查物理单位或常见量纲判断。',
    '如果原错题是书本实验题，相似题也优先生成书本实验题。',
    '如果原错题是创新实验题，相似题也优先生成创新实验题。',
    '如果原错题是画图题，相似题也优先生成同类作图题。',
  ];
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
