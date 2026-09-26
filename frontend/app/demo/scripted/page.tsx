import { AttackReplay } from "@/components/AttackReplay";

/** Scripted Replay: the same on-chain flow with fixed steps — the deterministic fallback. */
export default function ScriptedReplayPage() {
  return <AttackReplay mode="scripted" />;
}
