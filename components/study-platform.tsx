"use client";

import { useEffect, useMemo, useState } from 'react';

type Question = {
  id: string;
  type: string;
  stem: string;
  options: string[];
  answer: string;
  explanation: string;
  points: string[];
  subject: string;
  topic: string;
  localId: string;
  collected: boolean;
  isWrong: boolean;
};

type WrongItem = Omit<Question, 'localId' | 'collected' | 'isWrong'> & { savedAt: number };

type SubjectConfig = {
  enabled: boolean;
  comingSoon?: boolean;
  edition: string;
  modules: { name: string; topics: string[] }[];
};

type ConfigPayload = {
  configured: boolean;
  model: string;
  curriculum: {
    region: string;
    grade: string;
    editionHint: string;
    subjects: Record<string, SubjectConfig>;
  };
  subjects: string[];
};

const WRONG_BOOK_KEY = 'ai-study-wrong-book';

export function StudyPlatform() {
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [currentQuestions, setCurrentQuestions] = useState<Question[]>([]);
  const [wrongBook, setWrongBook] = useState<WrongItem[]>([]);
  const [wrongBookFilter, setWrongBookFilter] = useState('__all__');
  const [currentPaperMeta, setCurrentPaperMeta] = useState<Record<string, string | number> | null>(null);
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [subject, setSubject] = useState('物理');
  const [topic, setTopic] = useState('');
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState('提升');
  const [count, setCount] = useState('5');
  const [mode, setMode] = useState<'regular' | 'common_sense'>('regular');
  const [region, setRegion] = useState('中国江苏省南京市');
  const [grade, setGrade] = useState('初三');
  const [edition, setEdition] = useState('苏教版（江苏凤凰科技出版社）');
  const [serverHint, setServerHint] = useState('正在检测 AI 配置');
  const [statusTone, setStatusTone] = useState<'pending' | 'ok' | 'error'>('pending');
  const [statusText, setStatusText] = useState('正在检测 AI 配置');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [result, setResult] = useState<{ score: number; total: number } | null>(null);

  useEffect(() => {
    const cached = localStorage.getItem(WRONG_BOOK_KEY);
    if (cached) {
      try {
        setWrongBook(JSON.parse(cached));
      } catch {}
    }

    fetch('/api/config')
      .then((res) => res.json())
      .then((data: ConfigPayload) => {
        setConfig(data);
        setRegion(data.curriculum.region);
        setGrade(data.curriculum.grade);
        const firstSubject = data.subjects.find((item) => data.curriculum.subjects[item]?.enabled) || data.subjects[0] || '物理';
        setSubject(firstSubject);
        setEdition(data.curriculum.subjects[firstSubject]?.edition || '待补充');
        const topics = data.curriculum.subjects[firstSubject]?.modules.flatMap((m) => m.topics) || [];
        setTopic(topics[0] || '');
        setSelectedTopics(topics[0] ? [topics[0]] : []);
        if (data.configured) {
          setStatusTone('ok');
          setStatusText(`AI 已连接 · ${data.model}`);
          setServerHint('已检测到 AI 配置，可以按地区和知识点生成真题。');
        } else {
          setStatusTone('error');
          setStatusText('AI 未配置');
          setServerHint('请先配置 OPENAI_API_KEY，再启动服务。');
        }
      })
      .catch((error) => {
        setStatusTone('error');
        setStatusText('服务异常');
        setServerHint(`配置读取失败：${error.message}`);
      });
  }, []);

  useEffect(() => {
    localStorage.setItem(WRONG_BOOK_KEY, JSON.stringify(wrongBook));
  }, [wrongBook]);

  const subjectData = config?.curriculum.subjects[subject];
  const topics = useMemo(() => subjectData?.modules.flatMap((m) => m.topics) || [], [subjectData]);
  const topicOptions = useMemo(() => [{ value: '__all__', label: '所有知识点' }, ...topics.map((item) => ({ value: item, label: item }))], [topics]);
  const wrongBookTopics = useMemo(() => [...new Set(wrongBook.map((item) => item.topic).filter(Boolean))], [wrongBook]);
  const filteredWrongBook = useMemo(
    () => (wrongBookFilter === '__all__' ? wrongBook : wrongBook.filter((item) => item.topic === wrongBookFilter)),
    [wrongBook, wrongBookFilter],
  );

  useEffect(() => {
    if (subjectData) {
      setEdition(subjectData.edition || edition);
      const nextTopics = subjectData.modules.flatMap((m) => m.topics);
      setTopic(mode === 'common_sense' ? '__all__' : nextTopics[0] || '');
      setSelectedTopics(mode === 'common_sense' ? nextTopics : (nextTopics[0] ? [nextTopics[0]] : []));
    }
  }, [subject, mode]);

  function updateAnswer(key: string, value: string) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  function existsWrongQuestion(question: Pick<Question, 'stem' | 'topic' | 'subject'>) {
    return wrongBook.some((item) => item.stem === question.stem && item.topic === question.topic && item.subject === question.subject);
  }

  async function generateQuestions() {
    if (!subjectData?.enabled) return;
    setIsGenerating(true);
    setResult(null);
    setQuizSubmitted(false);

    const effectiveTopics = selectedTopics.length === topics.length ? '__all__' : selectedTopics;
    const effectiveTopicLabel = selectedTopics.length === topics.length ? '__all__' : (selectedTopics[0] || topic);

    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, topic: effectiveTopicLabel, topics: effectiveTopics, difficulty, count: Number(count), region, grade, edition, mode }),
    });
    const data = await res.json();
    setIsGenerating(false);

    if (!data.ok) {
      setCurrentQuestions([]);
      setSelectedQuestionIds([]);
      setServerHint(`生成失败：${data.error}`);
      return;
    }

    const next = data.questions.map((item: Omit<Question, 'subject' | 'topic' | 'localId' | 'collected' | 'isWrong'>, index: number) => ({
      ...item,
      subject,
      topic: selectedTopics.length === topics.length ? (item.points?.[0] || '所有知识点') : (selectedTopics.length > 1 ? (item.points?.[0] || '多知识点') : (selectedTopics[0] || item.points?.[0] || '未标注')),
      localId: `${Date.now()}-${index}`,
      collected: false,
      isWrong: false,
    }));

    setAnswers({});
    setCurrentQuestions(next);
    setSelectedQuestionIds(next.map((item: Question) => item.localId));
    setCurrentPaperMeta({
      subject,
      topic: selectedTopics.length === topics.length ? '所有知识点' : selectedTopics.length > 1 ? selectedTopics.join('、') : (selectedTopics[0] || topic),
      difficulty,
      count,
      edition,
      mode: mode === 'regular' ? '常规练习' : '生活常识专项',
    });
  }

  function submitQuiz() {
    let score = 0;
    const next = currentQuestions.map((question) => {
      const userAnswer = normalize(answers[question.localId] || '');
      const ok = judge(userAnswer, normalize(question.answer), question.type);
      if (ok) score += 1;
      return { ...question, isWrong: !ok };
    });
    setCurrentQuestions(next);
    setQuizSubmitted(true);
    setResult({ score, total: next.length });
  }

  function addToWrongBook(localId: string) {
    const question = currentQuestions.find((item) => item.localId === localId);
    if (!question || existsWrongQuestion(question)) return;
    setWrongBook((prev) => [{ ...question, savedAt: Date.now() }, ...prev]);
    setCurrentQuestions((prev) => prev.map((item) => (item.localId === localId ? { ...item, collected: true } : item)));
  }

  async function retryFromWrongBook() {
    const selected = filteredWrongBook.filter((item) => answers[`wrong-${item.savedAt}`] === '1');
    if (!selected.length) {
      alert('请至少选择一道错题。');
      return;
    }

    setIsRetrying(true);
    const res = await fetch('/api/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: selected[0].subject, region, grade, edition, selected }),
    });
    const data = await res.json();
    setIsRetrying(false);

    if (!data.ok) {
      setServerHint(`相似题生成失败：${data.error}`);
      return;
    }

    const next = data.questions.map((item: Omit<Question, 'subject' | 'topic' | 'localId' | 'collected' | 'isWrong'>, index: number) => ({
      ...item,
      subject: selected[0].subject,
      topic: item.points?.[0] || selected[index]?.topic || '相似题训练',
      localId: `retry-${Date.now()}-${index}`,
      collected: false,
      isWrong: false,
    }));

    setAnswers({});
    setQuizSubmitted(false);
    setResult(null);
    setCurrentQuestions(next);
    setSelectedQuestionIds(next.map((item: Question) => item.localId));
    setCurrentPaperMeta({ subject: selected[0].subject, topic: '错题相似题强化', difficulty: '跟随错题难度', count: next.length, edition, mode: '错题重练' });
  }

  function toggleQuestionSelection(localId: string, checked: boolean) {
    setSelectedQuestionIds((prev) => checked ? Array.from(new Set([...prev, localId])) : prev.filter((id) => id !== localId));
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedQuestionIds(checked ? currentQuestions.map((item) => item.localId) : []);
  }

  function toggleTopicSelection(value: string, checked: boolean) {
    if (value === '__all__') {
      setSelectedTopics(checked ? topics : []);
      setTopic(checked ? '__all__' : '');
      return;
    }
    const next = checked ? Array.from(new Set([...selectedTopics, value])) : selectedTopics.filter((item) => item !== value);
    setSelectedTopics(next);
    setTopic(next.length === topics.length ? '__all__' : (next[0] || ''));
  }

  function selectAllTopics() {
    setSelectedTopics(topics);
    setTopic('__all__');
  }

  function getSelectedQuestions() {
    const selected = currentQuestions.filter((item) => selectedQuestionIds.includes(item.localId));
    if (!selected.length) {
      alert('请先勾选至少一道题目。');
      return null;
    }
    return selected;
  }

  function openPrintWindow(html: string) {
    const win = window.open('', '_blank');
    if (!win) {
      alert('浏览器拦截了新窗口，请允许弹窗后重试。');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }

  function printSelectedQuestions() {
    const selected = getSelectedQuestions();
    if (!selected) return;
    openPrintWindow(buildPaperHtml(selected, currentPaperMeta));
  }

  function printSelectedAnswers() {
    const selected = getSelectedQuestions();
    if (!selected) return;
    openPrintWindow(buildAnswerHtml(selected, currentPaperMeta));
  }

  return (
    <div className="shell">
      <header className="hero card">
        <div>
          <p className="eyebrow">初三 · 多学科 AI 自适应练习</p>
          <h1>微远AI学习平台</h1>
          <p className="hero-text">面向南京初三学生，先上线物理，后续可扩展数学等学科，并按地区教材与中考风格生成训练内容。</p>
        </div>
        <div className="hero-side">
          <div className="hero-chip">智能练习</div>
          <div className="hero-chip">错题巩固</div>
          <div className="hero-chip">打印练习</div>
        </div>
      </header>

      <main className="layout">
        <section className="card full">
          <div className="title-row">
            <div>
              <h2>选择想练的内容</h2>
              <p>选好科目、知识点、题量后，就可以开始练习。</p>
            </div>
          </div>

          <div className="form-section">
            <div className="control-grid compact-grid">
              <label>
                <span>学科</span>
                <select value={subject} onChange={(e) => setSubject(e.target.value)}>
                  {config?.subjects.map((item) => {
                    const conf = config.curriculum.subjects[item];
                    return <option key={item} value={item} disabled={!conf.enabled}>{item}{conf.comingSoon ? '（即将上线）' : ''}</option>;
                  })}
                </select>
              </label>
              <label>
                <span>出题模式</span>
                <select value={mode} onChange={(e) => setMode(e.target.value as 'regular' | 'common_sense')}>
                  <option value="regular">常规练习</option>
                  <option value="common_sense">生活常识专项</option>
                </select>
              </label>
            </div>
          </div>

          <div className="form-section">
            <div className="control-grid">
              <label><span>地区</span><input value={region} onChange={(e) => setRegion(e.target.value)} /></label>
              <label><span>年级</span><input value={grade} onChange={(e) => setGrade(e.target.value)} /></label>
              <label><span>教材版本</span><input value={edition} onChange={(e) => setEdition(e.target.value)} /></label>
              <label>
                <span>难度</span>
                <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                  <option value="基础">基础</option>
                  <option value="提升">提升</option>
                  <option value="冲刺">冲刺</option>
                </select>
              </label>
              <label>
                <span>题量</span>
                <select value={count} onChange={(e) => setCount(e.target.value)}>
                  <option value="3">3 题</option>
                  <option value="5">5 题</option>
                  <option value="8">8 题</option>
                  <option value="20">20 题（整卷风格）</option>
                </select>
              </label>
            </div>
          </div>

          {!subjectData?.enabled && <div className="subject-status">{subject} 当前为“即将上线”状态，建议先使用物理。</div>}
          {mode === 'common_sense' && <div className="subject-status info">生活常识专项会更偏基础判断题，适合专门查漏补缺。</div>}
          <div className="topic-selector-card">
            <div className="topic-selector-head">
              <div>
                <strong>选择知识点</strong>
                <p className="note">已选 {selectedTopics.length} 个知识点{selectedTopics.length === topics.length && topics.length > 0 ? '（当前为所有知识点）' : ''}。</p>
              </div>
              <button type="button" className="text-btn" onClick={selectAllTopics}>全选</button>
            </div>
            <div className="topic-preview compact">
              {subjectData?.modules.length ? subjectData.modules.map((module) => (
                <section key={module.name} className="module-card">
                  <h3>{module.name}</h3>
                  <div className="topic-checkbox-grid">
                    {module.topics.map((item) => (
                      <label key={item} className="topic-check-item">
                        <input
                          type="checkbox"
                          checked={selectedTopics.includes(item)}
                          onChange={(e) => toggleTopicSelection(item, e.target.checked)}
                        />
                        <span>{item}</span>
                      </label>
                    ))}
                  </div>
                </section>
              )) : <div className="module-card pending-card"><h3>该学科即将上线</h3><p>知识点和题型正在整理中。</p></div>}
            </div>
          </div>
          <button className="primary-btn" onClick={generateQuestions} disabled={isGenerating || !subjectData?.enabled || !selectedTopics.length}>{isGenerating ? '正在生成...' : '生成题目'}</button>
        </section>

        <section className="card content">
          <div className="title-row">
            <div>
              <h2>开始做题</h2>
              <p>选择题、填空题可以直接在线做；画图题、实验题更适合打印后完成。</p>
            </div>
            <div className="action-row">
              <button className="secondary-btn subtle-btn" onClick={() => toggleSelectAll(selectedQuestionIds.length !== currentQuestions.length)} disabled={!currentQuestions.length}>{selectedQuestionIds.length === currentQuestions.length && currentQuestions.length ? '取消全选' : '全选题目'}</button>
              <button className="secondary-btn" onClick={printSelectedQuestions} disabled={!currentQuestions.length}>打印试卷 / PDF</button>
              <button className="secondary-btn" onClick={printSelectedAnswers} disabled={!currentQuestions.length}>打印答案解析 / PDF</button>
              <button className="secondary-btn" onClick={() => {
                if (!currentQuestions.length) return;
                if (window.confirm('确认提交并评分吗？提交后将立即显示答案和解析。')) {
                  submitQuiz();
                }
              }} disabled={!currentQuestions.length}>提交并评分</button>
            </div>
          </div>

          {currentPaperMeta && (
            <div className="paper-summary">
              <div className="summary-chip"><strong>学科</strong><span>{String(currentPaperMeta.subject)}</span></div>
              <div className="summary-chip"><strong>知识点</strong><span>{String(currentPaperMeta.topic)}</span></div>
              <div className="summary-chip"><strong>难度</strong><span>{String(currentPaperMeta.difficulty)}</span></div>
              <div className="summary-chip"><strong>题量</strong><span>{String(currentPaperMeta.count)} 题</span></div>
              <div className="summary-chip"><strong>模式</strong><span>{String(currentPaperMeta.mode)}</span></div>
              <div className="summary-chip wide"><strong>教材</strong><span>{String(currentPaperMeta.edition)}</span></div>
            </div>
          )}

          {!currentQuestions.length ? <div className="empty-state">请先生成题目。</div> : (
            <div className="quiz-list">
              {currentQuestions.map((question, index) => {
                const alreadyCollected = existsWrongQuestion(question) || question.collected;
                const isChecked = selectedQuestionIds.includes(question.localId);
                return (
                  <article key={question.localId} className={`question-card ${quizSubmitted ? question.isWrong ? 'wrong' : 'correct' : ''}`}>
                    <div className="question-header">
                      <div className="question-head-main">
                        <label className="pick-box">
                          <input type="checkbox" checked={isChecked} onChange={(e) => toggleQuestionSelection(question.localId, e.target.checked)} />
                          <span>加入打印试卷</span>
                        </label>
                        <strong>第 {index + 1} 题：{question.stem}</strong>
                        <div className="question-meta">学科：{question.subject} · 知识点：{question.topic}{question.points?.length ? ` · 关联点：${question.points.join('、')}` : ''}</div>
                      </div>
                      <span className="question-type">{labelType(question.type)}</span>
                    </div>

                    {question.type === 'single_choice' ? (
                      <div className="options options-selectable">
                        {question.options.map((option, idx) => {
                          const value = extractOptionValue(option, idx);
                          const checked = answers[question.localId] === value;
                          return (
                            <label key={option} className={`option-item option-selectable ${checked ? 'selected' : ''}`}>
                              <input type="radio" name={question.localId} checked={checked} onChange={() => updateAnswer(question.localId, value)} />
                              <span>{option}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : question.type === 'fill_blank' ? (
                      <input className="short-answer" value={answers[question.localId] || ''} onChange={(e) => updateAnswer(question.localId, e.target.value)} placeholder="请输入答案" />
                    ) : (
                      <textarea rows={question.type.includes('experiment') ? 6 : 4} value={answers[question.localId] || ''} onChange={(e) => updateAnswer(question.localId, e.target.value)} placeholder={question.type === 'drawing' ? '此题更适合打印后作图，线上可简要描述。' : '请输入你的答案'} />
                    )}

                    <div className={`answer-block ${quizSubmitted ? 'show' : ''}`}>
                      <p><strong>正确答案：</strong>{question.answer}</p>
                      <p><strong>解题思路：</strong>{question.explanation}</p>
                      {quizSubmitted && question.isWrong && (
                        <div className="question-tools">
                          <button className={`collect-btn ${alreadyCollected ? 'added' : ''}`} disabled={alreadyCollected} onClick={() => addToWrongBook(question.localId)}>
                            {alreadyCollected ? '已加入错题集' : '加入错题集'}
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {result && <div className="result"><strong>本次得分：{result.score} / {result.total}</strong><p className="analysis">错题已显示答案与解题思路。你可以按需加入错题集，再继续生成相似题强化练习。</p></div>}
        </section>

        <section className="card content">
          <div className="title-row">
            <div>
              <h2>3. 错题集</h2>
              <p>可选择错题并生成同知识点类似题</p>
            </div>
            <div className="action-row">
              <button className="secondary-btn subtle-btn" onClick={() => setWrongBook([])}>清空错题集</button>
              <button className="primary-btn light-btn" onClick={retryFromWrongBook} disabled={isRetrying}>{isRetrying ? '正在生成...' : '生成相似题'}</button>
            </div>
          </div>

          <div className="wrong-book-toolbar">
            <label>
              <span>按知识点筛选</span>
              <select value={wrongBookFilter} onChange={(e) => setWrongBookFilter(e.target.value)}>
                <option value="__all__">全部知识点</option>
                {wrongBookTopics.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </div>

          {!filteredWrongBook.length ? <div className="empty-state">暂无错题。</div> : (
            <div className="wrong-book">
              {filteredWrongBook.map((item) => (
                <article key={item.savedAt} className="wrong-card">
                  <label>
                    <input type="checkbox" checked={answers[`wrong-${item.savedAt}`] === '1'} onChange={(e) => updateAnswer(`wrong-${item.savedAt}`, e.target.checked ? '1' : '0')} />
                    <div>
                      <strong>{item.stem}</strong>
                      <p className="question-meta">学科：{item.subject} · 知识点：{item.topic} · 题型：{labelType(item.type)}</p>
                      <p className="analysis"><strong>答案：</strong>{item.answer}</p>
                      <p className="analysis"><strong>思路：</strong>{item.explanation}</p>
                      <div className="wrong-book-tools">
                        <button className="text-btn" onClick={() => setWrongBook((prev) => prev.filter((source) => source.savedAt !== item.savedAt))}>删除</button>
                      </div>
                    </div>
                  </label>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function buildPaperHtml(questions: Question[], meta: Record<string, string | number> | null) {
  const body = questions.map((question, index) => `
    <section class="print-question">
      <h3>${index + 1}. ${escapeHtml(question.stem)}</h3>
      ${question.options?.length ? `<ul>${question.options.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
      <p class="meta">题型：${escapeHtml(labelType(question.type))}　知识点：${escapeHtml(question.topic)}</p>
      ${renderOfflineAnswerArea(question.type)}
    </section>
  `).join('');

  return buildPrintDocument('微远AI学习平台 · 打印试卷', meta, body);
}

function buildAnswerHtml(questions: Question[], meta: Record<string, string | number> | null) {
  const body = questions.map((question, index) => `
    <section class="print-question answer-sheet">
      <h3>${index + 1}. ${escapeHtml(question.stem)}</h3>
      <p class="meta">题型：${escapeHtml(labelType(question.type))}　知识点：${escapeHtml(question.topic)}</p>
      <p><strong>标准答案：</strong>${escapeHtml(question.answer || '未提供')}</p>
      <p><strong>解析：</strong>${escapeHtml(question.explanation || '未提供')}</p>
    </section>
  `).join('');

  return buildPrintDocument('微远AI学习平台 · 答案解析页', meta, body);
}

function buildPrintDocument(title: string, meta: Record<string, string | number> | null, body: string) {
  return `<!doctype html>
  <html lang="zh-CN">
    <head>
      <meta charset="utf-8" />
      <title>${title}</title>
      <style>
        body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;color:#111;padding:24px;line-height:1.7}
        h1{font-size:26px;margin-bottom:8px} h2{font-size:14px;color:#666;font-weight:normal;margin-top:0}
        .print-question{margin:20px 0;padding-bottom:18px;border-bottom:1px dashed #bbb;page-break-inside:avoid}
        .meta{font-size:12px;color:#666}.blank{height:90px;border-bottom:1px solid #bbb;margin-top:10px}
        .blank.tall{height:180px}.blank.drawing{height:220px;border:1px solid #bbb}.hint{font-size:12px;color:#666}
        ul{padding-left:20px}.answer-sheet p{margin:8px 0} @media print{body{padding:0 10mm}}
      </style>
    </head>
    <body>
      <h1>${title}</h1>
      <h2>${meta ? `学科：${escapeHtml(String(meta.subject))} ｜ 知识点：${escapeHtml(String(meta.topic))} ｜ 模式：${escapeHtml(String(meta.mode))} ｜ 教材：${escapeHtml(String(meta.edition))}` : ''}</h2>
      ${body}
    </body>
  </html>`;
}

function renderOfflineAnswerArea(type: string) {
  if (type === 'drawing') return '<p class="hint">请在线下完成作图。</p><div class="blank drawing"></div>';
  if (type === 'experiment_textbook' || type === 'experiment_innovative') return '<p class="hint">请在线下完成实验分析作答。</p><div class="blank tall"></div>';
  if (type === 'calculation' || type === 'short_answer') return '<div class="blank tall"></div>';
  if (type === 'fill_blank') return '<div class="blank"></div>';
  return '';
}

function labelType(type: string) {
  return {
    single_choice: '选择题',
    fill_blank: '填空题',
    drawing: '画图题',
    experiment_textbook: '书本实验题',
    experiment_innovative: '创新实验题',
    calculation: '计算题',
    short_answer: '简答题',
  }[type] || '题目';
}

function extractOptionValue(optionText: string, index: number) {
  const match = optionText.match(/^([A-D])[\.．、\s]/i);
  return match ? match[1].toUpperCase() : String.fromCharCode(65 + index);
}

function judge(user: string, answer: string, type: string) {
  if (!user) return false;
  if (type === 'single_choice') return user === answer || user.replace(/\./g, '') === answer.replace(/\./g, '');
  return user === answer || user.includes(answer) || answer.includes(user);
}

function normalize(value: string) {
  return String(value).trim().toLowerCase().replace(/\s+/g, '');
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
