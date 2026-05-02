import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const PORT = process.env.PORT || 8787;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const CURRICULUM = {
  region: '中国江苏省南京市',
  grade: '初三',
  editionHint: '物理当前默认按苏教版（江苏凤凰科技出版社）与南京地区中考风格命题，后续可继续补充其他学科教材版本。',
  subjects: {
    物理: {
      topics: [
        '机械运动',
        '声现象',
        '物态变化',
        '光现象',
        '透镜及其应用',
        '质量与密度',
        '压强',
        '浮力',
        '功和机械能',
        '简单机械',
        '功率',
        '热和能',
        '内能与热机',
        '电流和电路',
        '电压与电阻',
        '欧姆定律',
        '电功率',
        '家庭电路与安全用电',
        '电与磁',
        '信息与能源'
      ]
    },
    数学: {
      topics: []
    }
  }
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/config') {
      return sendJson(res, 200, {
        ok: true,
        configured: Boolean(OPENAI_API_KEY),
        model: OPENAI_MODEL,
        curriculum: CURRICULUM,
        subjects: Object.keys(CURRICULUM.subjects)
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/generate') {
      const body = await readJsonBody(req);
      const payload = await generateQuestions(body);
      return sendJson(res, 200, payload);
    }

    if (req.method === 'POST' && url.pathname === '/api/regenerate') {
      const body = await readJsonBody(req);
      const payload = await regenerateSimilarQuestions(body);
      return sendJson(res, 200, payload);
    }

    if (req.method === 'GET') {
      return serveStatic(url.pathname, res);
    }

    sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { ok: false, error: error.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`微远AI学习平台 running at http://127.0.0.1:${PORT}`);
});

async function generateQuestions(body) {
  const subject = sanitizeSubject(body?.subject);
  const topic = sanitizeTopic(subject, body?.topic);
  const count = clamp(Number(body?.count) || 5, 1, 10);
  const difficulty = sanitizeDifficulty(body?.difficulty);
  const region = body?.region || CURRICULUM.region;
  const grade = body?.grade || CURRICULUM.grade;
  const edition = body?.edition || '苏教版（江苏凤凰科技出版社）';

  if (!OPENAI_API_KEY) {
    return {
      ok: false,
      error: '未检测到 OPENAI_API_KEY，暂时无法调用真实 AI 出题。',
      hint: '请在启动前配置 OPENAI_API_KEY，可选 OPENAI_BASE_URL 与 OPENAI_MODEL。'
    };
  }

  const system = [
    '你是一名中国初中命题老师。',
    '你的任务是生成适合指定地区和年级学生的学科练习题。',
    '题目必须围绕指定知识点，难度适中偏中考风格。',
    '请优先贴合当地常见教材进度与考查方式。',
    '输出必须是严格 JSON，不要出现 markdown 代码块。'
  ].join(' ');

  const user = {
    grade,
    subject,
    region,
    edition,
    topic,
    count,
    difficulty,
    output_schema: {
      questions: [
        {
          id: 'string',
          type: 'single_choice | fill_blank | calculation | short_answer',
          stem: 'string',
          options: ['A. ...', 'B. ...'],
          answer: 'string',
          explanation: 'string',
          points: ['string']
        }
      ]
    },
    rules: [
      '至少包含 1 道选择题和 1 道计算/分析题（如果 count >= 4）。',
      '解析要用适合初三学生的表达。',
      '答案必须明确可判分。',
      '不要重复题目。'
    ]
  };

  const result = await callModel(system, JSON.stringify(user));
  const parsed = parseQuestionPayload(result);

  return { ok: true, source: 'ai', ...parsed };
}

async function regenerateSimilarQuestions(body) {
  const selected = Array.isArray(body?.selected) ? body.selected.slice(0, 8) : [];
  const subject = sanitizeSubject(body?.subject || selected?.[0]?.subject);
  const region = body?.region || CURRICULUM.region;
  const grade = body?.grade || CURRICULUM.grade;
  const edition = body?.edition || '苏教版（江苏凤凰科技出版社）';
  if (!selected.length) {
    return { ok: false, error: '请至少选择一道错题。' };
  }

  if (!OPENAI_API_KEY) {
    return {
      ok: false,
      error: '未检测到 OPENAI_API_KEY，暂时无法调用真实 AI 生成相似题。',
      hint: '请在启动前配置 OPENAI_API_KEY，可选 OPENAI_BASE_URL 与 OPENAI_MODEL。'
    };
  }

  const system = [
    '你是一名中国初中命题老师。',
    '请根据学生错题生成相似题，要求保持同知识点和相近难度，但题干和数字不能照抄。',
    '请优先贴合指定地区和教材背景。',
    '输出必须是严格 JSON，不要出现 markdown 代码块。'
  ].join(' ');

  const user = {
    task: '根据错题生成相似题',
    grade,
    subject,
    region,
    edition,
    selected_wrong_questions: selected.map((item, index) => ({
      index: index + 1,
      topic: item.topic,
      stem: item.stem,
      answer: item.answer,
      explanation: item.explanation,
      questionType: item.type
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
          points: ['string']
        }
      ]
    }
  };

  const result = await callModel(system, JSON.stringify(user));
  const parsed = parseQuestionPayload(result);

  return { ok: true, source: 'ai', ...parsed };
}

async function callModel(system, user) {
  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI 接口调用失败：${response.status} ${text}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('AI 未返回可用内容。');
  }
  return content;
}

function parseQuestionPayload(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI 返回内容无法解析为 JSON。');
    parsed = JSON.parse(match[0]);
  }

  const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
  return {
    questions: questions.map((q, index) => ({
      id: q.id || `q-${Date.now()}-${index}`,
      type: q.type || 'short_answer',
      stem: q.stem || '题干缺失',
      options: Array.isArray(q.options) ? q.options : [],
      answer: q.answer || '',
      explanation: q.explanation || '',
      points: Array.isArray(q.points) ? q.points : []
    }))
  };
}

function sanitizeSubject(subject) {
  return Object.keys(CURRICULUM.subjects).includes(subject) ? subject : '物理';
}

function sanitizeTopic(subject, topic) {
  const topics = CURRICULUM.subjects[subject]?.topics || [];
  return topics.includes(topic) ? topic : topics[0] || '';
}

function sanitizeDifficulty(difficulty) {
  return ['基础', '提升', '冲刺'].includes(difficulty) ? difficulty : '提升';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8') || '{}';
  return JSON.parse(text);
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function serveStatic(pathname, res) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(publicDir, safePath));
  if (!filePath.startsWith(publicDir)) {
    return sendJson(res, 403, { ok: false, error: 'Forbidden' });
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { ok: false, error: 'File not found' });
      return;
    }

    const ext = path.extname(filePath);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8'
    };

    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain; charset=utf-8' });
    res.end(data);
  });
}
