"use client";
import { ApiForm, FieldSpec } from "./ui";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const fields: FieldSpec[] =
    mode === "signup"
      ? [
          { name: "company", label: "Company name", required: true },
          { name: "name", label: "Your name", required: true },
          { name: "email", label: "Work email", type: "email", required: true },
          { name: "password", label: "Password", type: "password", required: true, help: "At least 8 characters." },
        ]
      : [
          { name: "email", label: "Email", type: "email", required: true },
          { name: "password", label: "Password", type: "password", required: true },
        ];
  return <ApiForm action={`/api/auth/${mode}`} fields={fields} submitLabel={mode === "signup" ? "Create workspace" : "Log in"} success="Welcome!" redirect="/app" />;
}
