import type { FieldSpec } from "./ui";

type Def = { key: string; name: string; type: string; options: string[] };
export function customFieldSpecs(defs: Def[], values: Record<string, unknown>, prefix = "customValues."): FieldSpec[] {
  return defs.map((f) => ({
    name: `${prefix}${f.key}`,
    label: f.name,
    type: f.type === "NUMBER" ? "number" : f.type === "DATE" ? "date" : f.type === "CHECKBOX" ? "checkbox" : f.type === "DROPDOWN" ? "select" : "text",
    options: f.options.map((o) => ({ value: o, label: o })),
    defaultValue: (values[f.key] as string | number | boolean | undefined) ?? (f.type === "CHECKBOX" ? false : ""),
    step: f.type === "NUMBER" ? "any" : undefined,
  }));
}
