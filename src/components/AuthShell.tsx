import { ThemeToggle } from "./ThemeToggle";

export function AuthShell({
  title,
  subtitle,
  badge,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-accent-500 text-[#ffffff] shadow-glow">
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2l7 4v6c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6l7-4z" strokeLinejoin="round" />
              <path d="M9.5 12l1.8 1.8L15 10" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="mt-3 text-lg font-semibold text-white">DevGems</div>
        </div>

        <div className="card p-7">
          {badge && (
            <div className="badge mb-4 bg-accent-500/15 text-accent-400 ring-1 ring-accent-500/30">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-400" />
              {badge}
            </div>
          )}
          <h1 className="text-xl font-semibold text-white">{title}</h1>
          {subtitle && <p className="mt-1.5 mb-6 text-sm text-slate-400">{subtitle}</p>}
          {!subtitle && <div className="mb-2" />}
          {children}
        </div>

        <p className="mt-5 text-center text-xs text-slate-600">
          Sessions are signed & HTTP-only · AES-256 encrypted storage
        </p>
      </div>
    </div>
  );
}
