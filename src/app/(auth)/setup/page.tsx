import { redirect } from "next/navigation";
import { hasAnyUser } from "@/lib/auth";
import { SETUP_TOKEN_MIN_LENGTH, setupGate, setupTokenMatches } from "@/lib/security";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up" };

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  if (await hasAnyUser()) redirect("/login");
  const { token } = await searchParams;
  const gate = setupGate(process.env.SETUP_TOKEN);
  // The request proxy already answers 503 or 403 for these; this keeps the page honest on its own too.
  if (gate === "unconfigured") {
    return (
      <>
        <h1 className="mb-1 text-lg font-semibold">Setup unavailable</h1>
        <p className="text-sm text-muted">
          This server is missing its setup token. Set <code className="num">SETUP_TOKEN</code> to at least {SETUP_TOKEN_MIN_LENGTH} characters, restart the
          server and open the setup link it prints.
        </p>
      </>
    );
  }
  if (gate === "token" && !setupTokenMatches(token, process.env.SETUP_TOKEN)) {
    return (
      <>
        <h1 className="mb-1 text-lg font-semibold">Setup link required</h1>
        <p className="text-sm text-muted">This journal is waiting for its admin. Open the setup link printed by the server setup to create the admin account.</p>
      </>
    );
  }
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Create the admin account</h1>
      <p className="mb-5 text-sm text-muted">
        The admin creates every other account; nobody can sign themselves up. This page works once and then only redirects to sign-in.
      </p>
      <SetupForm token={gate === "token" ? token : undefined} />
    </>
  );
}
