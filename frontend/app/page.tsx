import Link from "next/link";
import { FiAward, FiCalendar, FiCheckSquare } from "react-icons/fi";

import { SpeculationRules } from "@/components/speculation-rules";

// User-facing copy is Vietnamese. See AGENTS.md > Language convention.
const FEATURES = [
  {
    icon: FiCalendar,
    title: "Đăng ký sự kiện",
    description:
      "Tìm và đăng ký các hoạt động tình nguyện do Đoàn – Hội tổ chức.",
  },
  {
    icon: FiCheckSquare,
    title: "Điểm danh QR",
    description: "Điểm danh nhanh tại sự kiện bằng mã QR hoặc mã nhập tay.",
  },
  {
    icon: FiAward,
    title: "Chứng nhận & giờ tình nguyện",
    description: "Ghi nhận thành tích và tổng hợp giờ tình nguyện minh bạch.",
  },
] as const;

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <section className="flex flex-col items-start gap-5">
        <h1 className="text-4xl font-bold tracking-tight text-neutral-900 sm:text-5xl dark:text-neutral-50">
          AmigoAct
        </h1>
        <p className="max-w-xl text-lg text-neutral-600 dark:text-neutral-400">
          Quản lý đăng ký và ghi nhận thành tích tình nguyện cho Đoàn – Hội.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/login"
            className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            Đăng nhập
          </Link>
          <Link
            href="/register"
            className="rounded-lg border border-neutral-300 px-5 py-2.5 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            Tạo tài khoản
          </Link>
        </div>
      </section>

      <section
        aria-label="Tính năng"
        className="mt-16 grid gap-4 sm:grid-cols-3"
      >
        {FEATURES.map((feature) => (
          <article
            key={feature.title}
            className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <feature.icon
              aria-hidden="true"
              className="h-6 w-6 text-neutral-700 dark:text-neutral-300"
            />
            <h2 className="mt-4 text-base font-semibold text-neutral-900 dark:text-neutral-50">
              {feature.title}
            </h2>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              {feature.description}
            </p>
          </article>
        ))}
      </section>

      <SpeculationRules prefetch={["/login", "/register"]} />
    </div>
  );
}
