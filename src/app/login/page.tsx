import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { AuthShell } from "@/components/AuthShell";

export default function Login() {
  return (
    <AuthShell>
      <h2 className="mb-4 text-2xl font-bold">Log in</h2>
      <AuthForm mode="login" />
      <p className="mt-5 text-sm">New company? <Link className="link" href="/signup">Create a workspace</Link></p>
    </AuthShell>
  );
}
