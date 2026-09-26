"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

/**
 * World ID for Agents sends the browser to the backend callback, which validates everything
 * server-side and redirects here with an opaque session id. We only forward it back to the page
 * that started the flow; that page reads the (backend-issued) result. Nothing here is trusted.
 */
function Forward() {
  const params = useSearchParams();
  const router = useRouter();
  const [msg, setMsg] = useState("reading the World ID result…");

  useEffect(() => {
    const id = params.get("session");
    if (!id) {
      setMsg("no session in the return URL");
      return;
    }
    api
      .session(id)
      .then((s) => {
        const back = s.returnTo && s.returnTo.startsWith("/") ? s.returnTo : "/";
        router.replace(`${back}${back.includes("?") ? "&" : "?"}wid=${encodeURIComponent(id)}`);
      })
      .catch((e) => setMsg(`could not read the session: ${(e as Error).message}`));
  }, [params, router]);

  return <div className="label flick">{msg}</div>;
}

export default function WorldIdReturnPage() {
  return (
    <main className="mx-auto max-w-3xl px-6" style={{ padding: "120px 24px" }}>
      <div className="label" style={{ marginBottom: 10 }}>
        {"world id"}
      </div>
      <h1 style={{ fontSize: 40, marginBottom: 20 }}>Returning from World ID</h1>
      <Suspense fallback={<div className="label flick">…</div>}>
        <Forward />
      </Suspense>
    </main>
  );
}
