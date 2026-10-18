/** Convert a wall-clock date+time in an IANA zone to a UTC Date (no external deps). Throws on unknown zone. */
export function zonedToUtc(date: string, time: string, timeZone: string) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = (t: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t));
    const g = (k: string) => Number(parts.find((p) => p.type === k)!.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return new Date(t);
}

export function fmt(d: Date | string | null | undefined, timeZone: string, withDate = true) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone, ...(withDate ? { day: "2-digit", month: "short" } : {}), hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}

export function ago(d: Date | string) {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
