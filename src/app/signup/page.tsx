import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { AuthShell } from "@/components/AuthShell";

export default function Signup() {
  return (
    <AuthShell>
      <h2 className="text-2xl font-bold">Create your workspace</h2>
      <p className="mb-4 mt-1 text-sm text-[var(--muted)]">You become the Owner and can invite your team next.</p>
      <AuthForm mode="signup" />
      <p className="mt-5 text-sm">Already have an account? <Link className="link" href="/login">Log in</Link></p>
    </AuthShell>
  );
}
