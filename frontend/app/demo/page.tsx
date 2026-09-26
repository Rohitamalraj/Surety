import { AttackReplay } from "@/components/AttackReplay";

/** Live Attack: a real LLM agent is attacked through its inbox; the model decides what happens. */
export default function LiveAttackPage() {
  return <AttackReplay mode="live" />;
}
