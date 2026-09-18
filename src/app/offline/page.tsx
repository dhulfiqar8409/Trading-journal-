import Link from "next/link";
import { LogoMark } from "@/components/icons";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <LogoMark width={32} height={32} />
      <h1 className="page-title mt-4">Offline</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">
        Darkpools needs a connection to load and save trades. Nothing from your journal is kept on this device, so try again once
        you are back online.
      </p>
      <Link href="/today" className="btn mt-5">
        Try again
      </Link>
    </div>
  );
}
