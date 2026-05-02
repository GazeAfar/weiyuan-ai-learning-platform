import { NextRequest, NextResponse } from 'next/server';
import { createSimilarQuestions } from '@/lib/ai';
import { CURRICULUM, sanitizeSubject } from '@/lib/curriculum';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const selected = Array.isArray(body?.selected) ? body.selected.slice(0, 8) : [];
    if (!selected.length) {
      return NextResponse.json({ ok: false, error: '请至少选择一道错题。' }, { status: 200 });
    }

    const subject = sanitizeSubject(body?.subject || selected[0]?.subject);
    const region = body?.region || CURRICULUM.region;
    const grade = body?.grade || CURRICULUM.grade;
    const edition = body?.edition || CURRICULUM.subjects[subject].edition;

    const data = await createSimilarQuestions({ subject, region, grade, edition, selected });
    return NextResponse.json({ ok: true, source: 'ai', ...data });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : '生成失败' },
      { status: 200 },
    );
  }
}
