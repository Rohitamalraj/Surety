/**
 * Sanity-checks the IDKit settings in .env without printing any secret.
 *   npx tsx scripts/check-idkit.ts
 */
import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";
import { signRequest } from "@worldcoin/idkit-core/signing";

const { IDKIT_APP_ID, IDKIT_RP_ID, IDKIT_SIGNING_KEY, IDKIT_ACTION, IDKIT_ENVIRONMENT } = process.env;

console.log("app_id:     ", IDKIT_APP_ID || "MISSING");
console.log("rp_id:      ", IDKIT_RP_ID || "MISSING");
console.log("action:     ", IDKIT_ACTION || "MISSING");
console.log("environment:", IDKIT_ENVIRONMENT || "MISSING");

if (!IDKIT_SIGNING_KEY) {
  console.log("signing key: MISSING");
  process.exit(1);
}
const key = (IDKIT_SIGNING_KEY.startsWith("0x") ? IDKIT_SIGNING_KEY : `0x${IDKIT_SIGNING_KEY}`) as `0x${string}`;
console.log("signer address (public — should match the portal):", privateKeyToAccount(key).address);
const r = signRequest({ signingKeyHex: IDKIT_SIGNING_KEY, action: IDKIT_ACTION });
console.log("signRequest works:", r.sig.startsWith("0x") && !!r.nonce);
