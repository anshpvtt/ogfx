const sections = [
  {
    title: "Data we collect",
    body: "Account identifiers, selected assets, and usage telemetry required to operate charts, signals, backtests, automation, and alerts.",
  },
  {
    title: "How we use data",
    body: "To provide signals, run and store backtests, improve reliability, prevent abuse, and communicate service updates.",
  },
  {
    title: "Security",
    body: "Server credentials stay server-side. Access is limited by Supabase sessions and workspace checks for protected dashboard and API routes.",
  },
  {
    title: "Disclaimer",
    body: "Trading involves risk. OGFX provides informational signals and research tooling. You remain responsible for trading decisions and risk management.",
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="rounded-3xl border border-white/10 bg-[#0b1420]/84 p-6 sm:p-8">
        <div className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-200">Privacy</div>
        <h1 className="mt-4 text-4xl font-black tracking-tight text-white">Privacy Policy</h1>
        <p className="mt-4 text-slate-400">
          This baseline policy can be customized for your business and jurisdiction.
        </p>

        <div className="mt-10 space-y-5">
          {sections.map((section) => (
            <section key={section.title} className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h2 className="text-lg font-bold text-white">{section.title}</h2>
              <p className="mt-2 text-sm leading-7 text-slate-400">{section.body}</p>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
