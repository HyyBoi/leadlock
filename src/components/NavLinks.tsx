"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <ul className="grid gap-1">
      {items.map((n) => {
        const active = n.href === "/app" ? path === "/app" : path.startsWith(n.href);
        return (
          <li key={n.href}>
            <Link className="nav-pill" aria-current={active ? "page" : undefined} href={n.href}>{n.label}</Link>
          </li>
        );
      })}
    </ul>
  );
}
