import { HeroTimer } from "./HeroTimer";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen p-2 md:p-4">
      <main className="panel grid min-h-[calc(100vh-16px)] gap-10 p-6 md:min-h-[calc(100vh-32px)] md:grid-cols-[1.3fr_1fr] md:p-12">
        <section className="flex flex-col justify-between gap-10">
          <div className="flex items-center gap-3">
            <span className="mark" aria-hidden />
            <span className="text-xl font-bold">LeadLock</span>
          </div>
          <div>
            <h1 className="max-w-[16ch] text-4xl font-bold md:text-6xl">
              Every lead gets an owner. <HeroTimer /> Or it moves to the next one.
            </h1>
            <p className="mt-6 max-w-[46ch] text-base text-[var(--muted)]">
              WhatsApp, web form and walk-in leads are assigned instantly, escalated automatically when nobody answers, and every hand-off is on the record.
            </p>
          </div>
          <p className="text-sm text-[var(--muted)]">Built for sales teams of 5 to 30 people.</p>
        </section>
        <section className="flex flex-col justify-center">
          <div className="card mx-auto w-full max-w-sm p-6">{children}</div>
        </section>
      </main>
    </div>
  );
}
