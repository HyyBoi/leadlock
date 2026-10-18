import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";

export default function Signup() {
  return (
    <main className="mx-auto grid min-h-screen max-w-sm content-center gap-4 p-4">
      <h1 className="text-2xl font-bold">Create your workspace</h1>
      <p className="text-sm text-[var(--muted)]">You become the Owner. Invite your team afterwards.</p>
      <div className="card"><AuthForm mode="signup" /></div>
      <p className="text-sm">Already have an account? <Link className="link" href="/login">Log in</Link></p>
    </main>
  );
}
