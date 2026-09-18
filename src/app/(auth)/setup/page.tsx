import { redirect } from "next/navigation";
import { hasAnyUser } from "@/lib/auth";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up" };

export default async function SetupPage() {
  if (await hasAnyUser()) redirect("/login");
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Create your account</h1>
      <p className="mb-5 text-sm text-muted">
        This journal has a single owner. Create the account once; afterwards this page only redirects to sign-in.
      </p>
      <SetupForm />
    </>
  );
}
