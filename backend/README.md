# Surety backend

World ID for Agents validation + EIP-712 signer, event indexer, and the demo agent simulator.
Spec: `docs/PRD.md` §11 and §16.

## Run locally (no Sepolia, no World ID account needed)

```bash
npm install
npm run devnet      # terminal 1: anvil + contracts + seeded demo policy → deployments/local.json
npm run dev:local   # terminal 2: backend on http://localhost:8787 against the devnet
```

Locally, with no `WORLDID_CLIENT_ID` set, `/auth/worldid/start` goes to a **mock World ID page**
(verify as policyholder / as someone else / cancel). The backend still runs every server-side
check; the mock only replaces the login screen. It is never active on Sepolia.

## Run against Sepolia

Copy `.env.example` → `.env`, fill in World ID client, `SEPOLIA_RPC_URL`, `BACKEND_SIGNER_PK`,
`AGENT_PK`, `PUBLIC_URL`; needs `deployments/sepolia.json` from Person A's deploy script. `npm run dev`.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | network, chain, block, World ID mode |
| GET | `/auth/worldid/start?purpose=enroll&address=0x…&returnTo=/` | → World ID. Returns to `FRONTEND_URL/worldid/return?session=<id>` |
| GET | `/auth/worldid/start?purpose=claim&claimId=N&returnTo=/demo` | fresh step-up (`prompt=login`, `max_age=0`) |
| GET | `/api/worldid/session/:id` | `{status: pending\|approved\|denied\|expired\|cancelled\|mismatch, subHash, expiry, authTime, sig, reason, heldTx}` — enroll: pass `subHash, expiry, sig` to `issuePolicy` |
| POST | `/api/claims/:id/execute` `{session}` | approved claim → `executeWithApproval` on-chain → `{txHash}` |
| GET | `/api/claims/:id` | on-chain claim with `status` / `vtype` names |
| GET | `/api/policy/:node` | policy, payments (with live violation check), claims, events |
| GET | `/api/feed?node=&limit=` | newest-first event feed |
| GET | `/api/solvency` | `{liquidReserve, totalCoverage, ratio, required: 2}` |
| GET | `/api/demo` | demo actors: `label, node, agent, policyholder, merchant, attacker, payout` |
| POST | `/api/agent/step` `{step: normal\|attack-swap\|violation}` | runs the scripted agent → `{txHash, reverted, revertReason, paymentId}` |
| POST | `/api/demo/file-claim` `{paymentId}` | demo console: files the claim as the demo policyholder → `{txHash, claimId}` |

Amounts are MockUSDC base units (6 decimals) as decimal strings. Errors: `{error}` with the
contract's custom error name when a transaction reverts (e.g. `NoViolation(1)`).

## IDKit — proof of unique human before buying (PRD §11.2)

**Trust moment:** the shared pool pays claims, so one person must not open many policies from many
wallets and farm it. Before buying, the policyholder proves with World ID (**Proof of Human**
preset — the minimum sufficient credential, no personal data) that they're a unique human.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/idkit/config` | `{enabled, devMode, app_id, rp_id, action, environment}` |
| POST | `/api/idkit/rp-signature` | `{sig, nonce, created_at, expires_at}` → build `rp_context` |
| POST | `/api/idkit/verify` `{address, idkitResponse}` | forward the widget result **as-is** → `{verified, txHash}`; `409` if this human already verified another wallet |
| GET | `/api/idkit/status/:address` | `{verified, signal}` |
| POST | `/api/idkit/dev-verify` `{address, as?}` | local devnet only, when IDKit isn't configured |

Frontend (React, `@worldcoin/idkit@^4`):

```tsx
<IDKitRequestWidget
  app_id={cfg.app_id} action={cfg.action} rp_context={rpContext}
  environment={cfg.environment} allow_legacy_proofs={true}
  preset={proofOfHuman({ signal: address.toLowerCase() })}   // must be the lowercase wallet
  handleVerify={async (result) => {
    const r = await fetch(`${API}/api/idkit/verify`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, idkitResponse: result }) });
    if (!r.ok) throw new Error((await r.json()).error);
  }}
  onSuccess={() => setHumanVerified(true)}
/>
```

What the backend enforces, in order: action matches · environment matches · the request nonce was
issued by us and is used once · every response's `signal_hash` equals `hashSignal(lowercase wallet)` ·
Developer Portal `POST /api/v4/verify/{rp_id}` says `success` · then `WorldIdGate.registerHuman(wallet,
nullifier)` on-chain — a nullifier can back one wallet, ever. The chain is the uniqueness store.

**Alternative paths:** not yet verified → `/auth/worldid/start?purpose=enroll` redirects back with
`?error=unique_human_required` (and on-chain `verifyEnrollment` returns false while
`requireUniqueHuman` is on) · same human, second wallet → `409` · invalid proof / wrong wallet /
wrong environment / replay → `400` with a readable `error`.

**Testing:** set `IDKIT_ENVIRONMENT=staging` and use the World ID Simulator
(https://simulator.worldcoin.org) with a *staging* action. For real phones, create a *production*
action and set `production` — environments must match or proofs silently fail.

## Demo flow (what `/demo` should click through)

1. `POST /api/agent/step {"step":"normal"}` — within policy
2. `POST /api/agent/step {"step":"attack-swap"}` — `reverted: true`, "Blocked: over per-transaction cap"
3. `POST /api/agent/step {"step":"violation"}` — returns `paymentId`
4. `POST /api/demo/file-claim {"paymentId": …}` — returns `claimId`
5. Redirect to `/auth/worldid/start?purpose=claim&claimId=…` → **cancel** → session `cancelled`, claim `Held`
6. Again → **verify** → session `approved` → `POST /api/claims/:id/execute {session}` → claim `Paid`

## Tests

`npm test` — OIDC validation (local JWKS) and an on-chain check that TS-signed attestations verify
in the real `WorldIdGate.sol` (needs `anvil` + `forge` on PATH).
