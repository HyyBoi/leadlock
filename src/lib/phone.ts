/** Store phones in E.164 so WhatsApp numbers match existing contacts. Defaults to Pakistan (+92) for local 03xx numbers. */
export function normalizePhone(raw: string) {
  let s = raw.replace(/[^\d+]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (s.startsWith("0")) s = "+92" + s.slice(1);
  if (!s.startsWith("+")) s = "+" + s;
  return s;
}
