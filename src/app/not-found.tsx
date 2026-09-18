import Link from "next/link";
import { LogoMark } from "@/components/icons";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <LogoMark width={32} height={32} />
      <h1 className="mt-4 text-xl font-semibold">Page not found</h1>
      <p className="mt-1 text-sm text-muted">That page does not exist or the trade was deleted.</p>
      <Link href="/" className="btn mt-5">
        Back to the dashboard
      </Link>
    </div>
  );
}
