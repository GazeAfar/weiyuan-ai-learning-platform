const WRONG_BOOK_KEY = 'ai-study-wrong-book';

const state = {
  config: null,
  currentQuestions: [],
  wrongBook: loadWrongBook(),
};

const subjectSelect = document.getElementById('subjectSelect');
const topicSelect = document.getElementById('topicSelect');
const difficultySelect = document.getElementById('difficultySelect');
const countSelect = document.getElementById('countSelect');
const regionInput = document.getElementById('regionInput');
const gradeInput = document.getElementById('gradeInput');
const editionInput = document.getElementById('editionInput');
const generateBtn = document.getElementById('generateBtn');
const submitBtn = document.getElementById('submitBtn');
const retryBtn = document.getElementById('retryBtn');
const quizContainer = document.getElementById('quizContainer');
const resultContainer = document.getElementById('resultContainer');
const wrongBookContainer = document.getElementById('wrongBookContainer');
const configStatus = document.getElementById('configStatus');
const serverHint = document.getElementById('serverHint');
const topicPreview = document.getElementById('topicPreview');

boot();

async function boot() {
  await loadConfig();
  renderWrongBook();
  subjectSelect.addEventListener('change', renderTopics);
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    state.config = data;

    subjectSelect.innerHTML = (data.subjects || []).map((subject) => `<option value="${escapeHtml(subject)}">${escapeHtml(subject)}</option>`).join('');
    regionInput.value = data.curriculum?.region || '中国江苏省南京市';
    gradeInput.value = data.curriculum?.grade || '初三';
    editionInput.placeholder = data.curriculum?.editionHint || '教材版本待确认';

    renderTopics();

    if (data.configured) {
      configStatus.textContent = `AI 已连接 · ${data.model}`;
      configStatus.className = 'status-pill ok';
      serverHint.textContent = '已检测到 AI 配置，可以按地区和知识点生成真题。';
    } else {
      configStatus.textContent = 'AI 未配置';
      configStatus.className = 'status-pill error';
      serverHint.textContent = '请先配置 OPENAI_API_KEY，再启动服务。';
    }
  } catch (error) {
    configStatus.textContent = '服务异常';
    configStatus.className = 'status-pill error';
    serverHint.textContent = `配置读取失败：${error.message}`;
  }
}

function renderTopics() {
  const subject = subjectSelect.value || '物理';
  const topics = state.config?.curriculum?.subjects?.[subject]?.topics || [];
  topicSelect.innerHTML = topics.length
    ? topics.map((topic) => `<option value="${escapeHtml(topic)}">${escapeHtml(topic)}</option>`).join('')
    : '<option value="">当前学科知识点待补充</option>';
  topicPreview.innerHTML = topics.length
    ? topics.map((topic) => `<div class="topic-tag">${escapeHtml(topic)}</div>`).join('')
    : '<div class="topic-tag">当前学科知识点待补充</div>';
}

generateBtn.addEventListener('click', async () => {
  setLoading(generateBtn, true, '正在生成...');
  resultContainer.classList.add('hidden');

  try {
    const subject = subjectSelect.value;
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject,
        region: regionInput.value.trim(),
        grade: gradeInput.value.trim(),
        edition: editionInput.value.trim(),
        topic: topicSelect.value,
        difficulty: difficultySelect.value,
        count: Number(countSelect.value)
      })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '生成失败');

    state.currentQuestions = data.questions.map((item, index) => ({
      ...item,
      subject,
      topic: topicSelect.value,
      localId: `${Date.now()}-${index}`
    }));
    renderQuiz();
  } catch (error) {
    quizContainer.className = 'empty-state';
    quizContainer.textContent = `生成失败：${error.message}`;
  } finally {
    setLoading(generateBtn, false, '生成题目');
  }
});

submitBtn.addEventListener('click', () => {
  if (!state.currentQuestions.length) return;

  let correct = 0;
  state.currentQuestions.forEach((question) => {
    const input = document.querySelector(`[data-answer-id="${question.localId}"]`);
    const userAnswer = normalize(input?.value || '');
    const rightAnswer = normalize(question.answer || '');
    const card = document.getElementById(`card-${question.localId}`);
    const detail = document.getElementById(`detail-${question.localId}`);
    const ok = judge(userAnswer, rightAnswer, question.type);

    card.classList.remove('correct', 'wrong');
    card.classList.add(ok ? 'correct' : 'wrong');
    detail.classList.add('show');

    if (ok) {
      correct += 1;
    } else if (!existsWrongQuestion(question)) {
      state.wrongBook.unshift({
        id: question.id,
        subject: question.subject,
        type: question.type,
        stem: question.stem,
        options: question.options,
        answer: question.answer,
        explanation: question.explanation,
        topic: question.topic,
        savedAt: Date.now()
      });
    }
  });

  persistWrongBook();
  renderWrongBook();
  resultContainer.classList.remove('hidden');
  resultContainer.innerHTML = `<strong>本次得分：${correct} / ${state.currentQuestions.length}</strong><p class="analysis">答错的题已加入错题集，可继续生成相似题强化练习。</p>`;
});

retryBtn.addEventListener('click', async () => {
  const selected = Array.from(document.querySelectorAll('.wrong-selector:checked')).map((node) => {
    const idx = Number(node.value);
    return state.wrongBook[idx];
  }).filter(Boolean);

  if (!selected.length) {
    alert('请至少选择一道错题。');
    return;
  }

  setLoading(retryBtn, true, '正在生成...');
  resultContainer.classList.add('hidden');

  try {
    const subject = selected[0]?.subject || subjectSelect.value || '物理';
    const res = await fetch('/api/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject,
        region: regionInput.value.trim(),
        grade: gradeInput.value.trim(),
        edition: editionInput.value.trim(),
        selected
      })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '生成失败');

    state.currentQuestions = data.questions.map((item, index) => ({
      ...item,
      subject,
      topic: item.points?.[0] || selected[index]?.topic || '相似题训练',
      localId: `retry-${Date.now()}-${index}`
    }));
    renderQuiz();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    quizContainer.className = 'empty-state';
    quizContainer.textContent = `相似题生成失败：${error.message}`;
  } finally {
    setLoading(retryBtn, false, '生成相似题');
  }
});

function renderQuiz() {
  if (!state.currentQuestions.length) {
    quizContainer.className = 'empty-state';
    quizContainer.textContent = '请先生成题目。';
    return;
  }

  quizContainer.className = 'quiz-list';
  quizContainer.innerHTML = state.currentQuestions.map((question, index) => {
    const optionsHtml = Array.isArray(question.options) && question.options.length
      ? `<div class="options">${question.options.map((item) => `<div class="option-item">${escapeHtml(item)}</div>`).join('')}</div>`
      : '';

    return `
      <article class="question-card" id="card-${question.localId}">
        <div class="question-header">
          <div>
            <strong>第 ${index + 1} 题：${escapeHtml(question.stem)}</strong>
            <div class="question-meta">学科：${escapeHtml(question.subject || '')} · 知识点：${escapeHtml(question.topic || '')}${question.points?.length ? ` · 关联点：${escapeHtml(question.points.join('、'))}` : ''}</div>
          </div>
          <span class="question-type">${labelType(question.type)}</span>
        </div>
        ${optionsHtml}
        <textarea rows="3" data-answer-id="${question.localId}" placeholder="请输入你的答案"></textarea>
        <div class="answer-block" id="detail-${question.localId}">
          <p><strong>正确答案：</strong>${escapeHtml(question.answer)}</p>
          <p><strong>解题思路：</strong>${escapeHtml(question.explanation)}</p>
        </div>
      </article>
    `;
  }).join('');
}

function renderWrongBook() {
  if (!state.wrongBook.length) {
    wrongBookContainer.className = 'empty-state';
    wrongBookContainer.textContent = '暂无错题。';
    return;
  }

  wrongBookContainer.className = 'wrong-book';
  wrongBookContainer.innerHTML = state.wrongBook.map((item, index) => `
    <article class="wrong-card">
      <label>
        <input type="checkbox" class="wrong-selector" value="${index}" />
        <div>
          <strong>${escapeHtml(item.stem)}</strong>
          <p class="question-meta">学科：${escapeHtml(item.subject || '')} · 知识点：${escapeHtml(item.topic || '')} · 题型：${labelType(item.type)}</p>
          <p class="analysis"><strong>答案：</strong>${escapeHtml(item.answer)}</p>
          <p class="analysis"><strong>思路：</strong>${escapeHtml(item.explanation)}</p>
        </div>
      </label>
    </article>
  `).join('');
}

function judge(user, answer, type) {
  if (!user) return false;
  if (type === 'single_choice') {
    return user === answer || user.replace(/\./g, '') === answer.replace(/\./g, '');
  }
  return user === answer || user.includes(answer) || answer.includes(user);
}

function labelType(type) {
  return ({
    single_choice: '选择题',
    fill_blank: '填空题',
    calculation: '计算题',
    short_answer: '简答题'
  })[type] || '题目';
}

function normalize(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, '');
}

function loadWrongBook() {
  try {
    return JSON.parse(localStorage.getItem(WRONG_BOOK_KEY) || '[]');
  } catch {
    return [];
  }
}

function persistWrongBook() {
  localStorage.setItem(WRONG_BOOK_KEY, JSON.stringify(state.wrongBook));
}

function existsWrongQuestion(question) {
  return state.wrongBook.some((item) => item.stem === question.stem && item.topic === question.topic && item.subject === question.subject);
}

function setLoading(button, isLoading, text) {
  button.disabled = isLoading;
  button.textContent = text;
}

function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
