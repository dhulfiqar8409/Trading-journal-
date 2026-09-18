import { redirect } from "next/navigation";
import { hasAnyUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!(await hasAnyUser())) redirect("/setup");
  const { next } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Sign in</h1>
      <p className="mb-5 text-sm text-muted">Welcome back. Enter your credentials to open your journal.</p>
      <LoginForm next={next} />
    </>
  );
}
