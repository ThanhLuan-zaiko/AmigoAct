import { GreetingCard } from "@/components/greeting-card";

// User-facing copy is Vietnamese. See AGENTS.md > Language convention.
export default function Home() {
  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-1 flex-col gap-8 px-8 py-16 sm:px-16">
        <header className="flex flex-col gap-2">
          <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            AmigoAct
          </h1>
          <p className="text-base text-zinc-600 dark:text-zinc-400">
            Xây dựng thói quen cùng nhau, từng hoạt động một.
          </p>
        </header>
        <GreetingCard />
      </main>
    </div>
  );
}
