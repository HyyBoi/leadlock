import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";

export default function Login() {
  return (
    <main className="mx-auto grid min-h-screen max-w-sm content-center gap-4 p-4">
      <h1 className="text-2xl font-bold">Log in to LeadLock</h1>
      <div className="card"><AuthForm mode="login" /></div>
      <p className="text-sm">New company? <Link className="link" href="/signup">Create a workspace</Link></p>
    </main>
  );
}
