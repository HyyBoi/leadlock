"use client";
import { useEffect, useState } from "react";

/** The live object inside the headline: a lead's acknowledgement window ticking down, then handing over. */
export function HeroTimer() {
  const [s, setS] = useState(30);
  useEffect(() => {
    const t = setInterval(() => setS((v) => (v <= 0 ? 30 : v - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="timer-chip" aria-hidden>0:{String(s).padStart(2, "0")}</span>;
}
