import { NextResponse } from 'next/server';
import { getAiConfig } from '@/lib/ai';
import { CURRICULUM, getSubjects } from '@/lib/curriculum';

export async function GET() {
  const ai = getAiConfig();

  return NextResponse.json({
    ok: true,
    configured: ai.configured,
    model: ai.model,
    curriculum: CURRICULUM,
    subjects: getSubjects(),
  });
}
