export function DashboardPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-3xl">
        {eyebrow ? (
          <div className="mb-3 text-xs font-bold uppercase tracking-[0.24em] text-cyan-200">{eyebrow}</div>
        ) : null}
        <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400 sm:text-base">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
