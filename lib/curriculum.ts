export type ModuleGroup = {
  name: string;
  topics: string[];
};

export type SubjectConfig = {
  enabled: boolean;
  comingSoon?: boolean;
  edition: string;
  modules: ModuleGroup[];
};

export const CURRICULUM = {
  region: '江苏省南京市',
  grade: '初三',
  editionHint: '物理默认按苏教版与南京地区中考风格命题，化学默认按人教版与南京地区初中化学风格命题。',
  subjects: {
    物理: {
      enabled: true,
      edition: '苏教版',
      modules: [
        { name: '声学与热学', topics: ['声现象', '物态变化', '热和能', '内能与热机'] },
        { name: '光学', topics: ['光现象', '透镜及其应用'] },
        { name: '力学基础', topics: ['机械运动', '质量与密度', '压强', '浮力'] },
        { name: '机械能与简单机械', topics: ['功和机械能', '简单机械', '功率'] },
        { name: '电学', topics: ['电流和电路', '电压与电阻', '欧姆定律', '电功率', '家庭电路与安全用电'] },
        { name: '电磁与能源', topics: ['电与磁', '信息与能源'] },
      ],
    },
    化学: {
      enabled: true,
      edition: '人教版',
      modules: [
        { name: '物质构成与变化', topics: ['物质的变化和性质', '分子原子离子', '元素与化学式', '化学方程式'] },
        { name: '身边的化学物质', topics: ['空气与氧气', '水与溶液', '碳和碳的氧化物', '金属与金属材料'] },
        { name: '酸碱盐与转化', topics: ['常见酸碱盐', '复分解反应', '物质的检验与鉴别', '物质的转化与推断'] },
        { name: '实验与应用', topics: ['气体制取与净化', '溶液配制与除杂', '化学与生活'] },
      ],
    },
    数学: {
      enabled: false,
      comingSoon: true,
      edition: '待补充',
      modules: [],
    },
  } satisfies Record<string, SubjectConfig>,
};

export type SubjectName = keyof typeof CURRICULUM.subjects;

export function getSubjects() {
  return Object.keys(CURRICULUM.subjects) as SubjectName[];
}

export function getSubjectConfig(subject: string) {
  return CURRICULUM.subjects[subject as SubjectName] ?? CURRICULUM.subjects.物理;
}

export function getSubjectTopics(subject: string) {
  return getSubjectConfig(subject).modules.flatMap((module) => module.topics);
}

export function sanitizeSubject(subject?: string) {
  return getSubjects().includes(subject as SubjectName) ? (subject as SubjectName) : '物理';
}

export function sanitizeTopic(subject: string, topic?: string) {
  const topics = getSubjectTopics(subject);
  return topics.includes(topic ?? '') ? (topic as string) : topics[0] ?? '';
}

export function sanitizeTopics(subject: string, topics?: string[] | string) {
  const available = getSubjectTopics(subject);
  if (topics === '__all__') return available;
  if (Array.isArray(topics)) {
    const picked = topics.filter((item) => available.includes(item));
    return picked.length ? picked : available.slice(0, 1);
  }
  if (typeof topics === 'string' && topics) {
    return available.includes(topics) ? [topics] : available.slice(0, 1);
  }
  return available.slice(0, 1);
}

export function sanitizeDifficulty(difficulty?: string) {
  return ['基础', '提升', '冲刺'].includes(difficulty ?? '') ? (difficulty as string) : '提升';
}

export function clampCount(count?: number) {
  const value = Number(count) || 5;
  return Math.min(30, Math.max(1, value));
}
