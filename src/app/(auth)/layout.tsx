import { LogoMark } from "@/components/icons";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <LogoMark width={32} height={32} />
        <span className="text-xl font-semibold tracking-tight">Darkpools</span>
      </div>
      <div className="card card-pad w-full max-w-sm">{children}</div>
    </div>
  );
}
