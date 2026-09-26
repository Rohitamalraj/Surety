"use client";

import { useHealth } from "@/lib/hooks";

/**
 * On ngrok's free plan, a browser's first visit to the tunnel hits ngrok's "You are about to visit"
 * page instead of our backend — which would swallow the World ID redirect. Opening the tunnel once
 * and clicking "Visit Site" sets ngrok's cookie so the redirect goes straight through.
 */
export function TunnelHint() {
  const { data } = useHealth();
  const url = data?.publicUrl;
  if (!url || !/ngrok/i.test(url)) return null;
  return (
    <div className="notice" style={{ alignItems: "center" }}>
      <span>ⓘ</span>
      <span>
        First time on this browser?{" "}
        <a href={url} target="_blank" rel="noreferrer" className="link" style={{ textDecoration: "underline", color: "var(--signal)" }}>
          Unlock the tunnel
        </a>{" "}
        and click <b>Visit Site</b> once, then come back and verify with World ID.
      </span>
    </div>
  );
}
