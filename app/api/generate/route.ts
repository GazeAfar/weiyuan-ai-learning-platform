import { NextRequest, NextResponse } from 'next/server';
import { createQuestions } from '@/lib/ai';
import { CURRICULUM, clampCount, sanitizeDifficulty, sanitizeSubject, sanitizeTopic, sanitizeTopics } from '@/lib/curriculum';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const subject = sanitizeSubject(body?.subject);
    const mode = body?.mode || 'regular';
    const topics = body?.topics === '__all__' || (mode === 'common_sense' && body?.topic === '__all__')
      ? sanitizeTopics(subject, '__all__')
      : sanitizeTopics(subject, body?.topics ?? body?.topic);
    const topic = topics.length === 1 ? topics[0] : '__multi__';
    const count = clampCount(body?.count);
    const difficulty = sanitizeDifficulty(body?.difficulty);
    const region = body?.region || CURRICULUM.region;
    const grade = body?.grade || CURRICULUM.grade;
    const edition = body?.edition || CURRICULUM.subjects[subject].edition;

    const data = await createQuestions({ subject, topic, topics, count, difficulty, region, grade, edition, mode });
    return NextResponse.json({ ok: true, source: 'ai', ...data });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : '生成失败' },
      { status: 200 },
    );
  }
}
