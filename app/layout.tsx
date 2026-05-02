import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '微远AI学习平台',
  description: '面向南京初三学生的多学科 AI 学习平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
