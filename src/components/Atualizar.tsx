"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Recarrega os dados da mesa a cada 15 s (pedido novo pelo WhatsApp aparece sozinho). */
export function Atualizar() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 15000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}
