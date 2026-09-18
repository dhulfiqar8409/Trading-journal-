import { redirect } from "next/navigation";
import { hasAnyUser } from "@/lib/auth";
import { setupTokenMatches, setupTokenRequired } from "@/lib/security";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up" };

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  if (await hasAnyUser()) redirect("/login");
  const { token } = await searchParams;
  const required = setupTokenRequired(process.env.SETUP_TOKEN);
  // The request proxy already answers 403 without a valid token; this keeps the page honest on its own too.
  if (required && !setupTokenMatches(token, process.env.SETUP_TOKEN)) {
    return (
      <>
        <h1 className="mb-1 text-lg font-semibold">Setup link required</h1>
        <p className="text-sm text-muted">This journal is waiting for its owner. Open the setup link printed by the server setup to create the account.</p>
      </>
    );
  }
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Create your account</h1>
      <p className="mb-5 text-sm text-muted">
        This journal has a single owner. Create the account once; afterwards this page only redirects to sign-in.
      </p>
      <SetupForm token={required ? token : undefined} />
    </>
  );
}
