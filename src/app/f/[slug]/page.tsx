import { notFound } from "next/navigation";
import { workspaceBySlug } from "@/server/workspace";
import { ApiForm } from "@/components/ui";

export default async function PublicForm({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ws = await workspaceBySlug(slug);
  if (!ws) notFound();
  return (
    <main className="mx-auto grid min-h-screen max-w-md content-center gap-4 p-4">
      <h1 className="text-2xl font-bold">Contact {ws.name}</h1>
      <p className="text-sm text-[var(--muted)]">Leave your details and our team will get back to you within minutes.</p>
      <div className="card">
        <ApiForm
          action={`/api/public/leads/${slug}`}
          submitLabel="Send"
          success="Thanks! Someone from our team will contact you shortly."
          reset
          fields={[
            { name: "name", label: "Your name", required: true },
            { name: "phone", label: "Phone / WhatsApp", type: "tel", required: true, placeholder: "+92 300 1234567" },
            { name: "email", label: "Email", type: "email" },
            { name: "message", label: "How can we help?", type: "textarea" },
            { name: "website", label: "Leave empty", type: "hidden", defaultValue: "" },
          ]}
        />
      </div>
    </main>
  );
}
