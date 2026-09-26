# Surety — Team Split & Development Plan

> Built from `Surety - Product Requirements Document.pdf` (source of truth for scope and judging)
> and `Surety_Claude_Code_Setup_Guide.pdf` (repo layout, subagents, invariants).
> Deadline: **9:00 AM JST, Sunday Sep 27, 2026.** Target submit: **08:00 JST** (1h buffer).

---

## 0. The team at a glance

| | **Person A — Chain (ENS + Uniswap)** | **Person B — Trust (World ID + claims + backend)** | **Person C — Frontend** |
|---|---|---|---|
| Owns folders | `contracts/src/{PolicyRegistry,AgentVault,SuretyHook,MockUSDC}.sol`, `contracts/script/`, ENS setup | `contracts/src/{WorldIdGate,ClaimRouter,ViolationOracle,PricingEngine}.sol`, `backend/` (all of it) | `frontend/` (all of it) |
| Sponsor track | ENS — Best Use of ENSv2; Uniswap — Best Stack Contribution | World — World ID for Agents (+ IDKit stretch) | Makes all three visible to judges |
| Claude Code subagent | `contracts-builder` | `backend-builder` (+ `contracts-builder` for its 4 contracts) | `frontend-builder` |
| Docs owned | `docs/FEEDBACK.md` + Uniswap feedback form, `docs/CONTRACTS.md` | `README.md`, `docs/AI_ATTRIBUTION.md`, `docs/PITCH.md`, `docs/PRICING_MODEL.md` | Screenshots, demo video recording, Vercel link |
| Workshops to attend | ENSv2, Uniswap stack | World IDP / IDKit | — |

**Rule of thumb:** nobody edits another person's files. Shared files (below) change only at a sync point, with everyone agreeing.

**Shared files (edit only at sync points):**
- `contracts/src/interfaces/*.sol` — the contract API everyone codes against (§2)
- `deployments/sepolia.json` — addresses, written by Person A's deploy script
- `frontend/lib/abi/*.json` — generated from `forge build` by `npm run abi:export` (Person A runs it)
- `CLAUDE.md`, `docs/ARCHITECTURE.md`, this file

---

## 1. What we're building (one paragraph everyone should know by heart)

An AI agent gets a **non-transferable ENSv2 subname** (`agent1.surety.eth`) whose resolver publishes its policy: per-tx cap, counterparty allowlist, coverage limit, tier. The agent spends only through **`AgentVault`**. Swaps go through a **Uniswap v4 `SuretyHook`** that *reverts* rule-breaking swaps (the Grok/Bankr replay). Plain transfers are *recorded*; if one breaks the published rules, anyone can recompute that from public data (`ViolationOracle`), the policyholder files a claim (`ClaimRouter`), completes a **fresh World ID for Agents check** that must match the human who bought the policy (`WorldIdGate`, validated server-side), and the hook **pays out from the liquid reserve** — same day, on-chain. Cancel/deny → claim held, not paid.

**Tagline:** *ENS proves what the rules are. World ID proves who's really asking. Uniswap holds the money and enforces the rules.*

### Non-negotiable invariants (put in CLAUDE.md)
1. Payouts come **only** from the hook's liquid reserve — never from an LP position or directly from premiums in flight.
2. `issuePolicy()` reverts if `liquidReserve < 2 × totalCoverage` after issuing.
3. Claims: payout goes only to the `payoutAddr` fixed at purchase; payout address ≠ the violating counterparty; each `paymentId` can be claimed **once**; each World ID approval used **once**.
4. ENS resolver address is resolved **fresh** at call time — never hard-coded.
5. World ID tokens are validated **server-side only** (backend). Contracts trust only the backend signer's EIP-712 signature; the frontend trusts nothing client-reported.

### Decisions already made (don't re-debate)
- Chain: **Ethereum Sepolia**. Token: our own **`MockUSDC`** (6 decimals) for premiums, backing, payouts, and one side of the v4 pool.
- One shared `AgentVault` keyed by ENS node (not one vault per agent).
- `AuditLog` is folded into named events on each contract (no separate deploy).
- `BackerPool` is folded into `SuretyHook` (`depositBacking`).
- Self-dealing "funding link" tracing is **not** done on-chain; invariant 3 replaces it.
- Pricing = simple credibility formula (§5), shown term-by-term in the UI.
- Demo = PRD's 3-minute script (§8).

---

## 2. Locked interfaces (agree at Sync S0, then code against these)

All amounts in MockUSDC base units. `node` = ENS namehash of the agent subname.

```solidity
// ---------- shared types ----------
enum ViolationType { None, CapBreach, OffAllowlist, Attested }
enum ClaimStatus   { None, Pending, Held, Paid, Rejected }

struct PolicyRecord {
    address policyholder;
    address agent;          // agent's scoped key (may write streak only)
    address payoutAddr;     // fixed at purchase
    uint256 coverageLimit;
    uint256 perTxCap;
    uint8   tier;
    uint32  streak;
    bytes32 subHash;        // keccak256(World ID pairwise sub)
    uint256 paidOut;        // running total vs coverageLimit
    bool    active;
}

struct Payment { bytes32 node; address to; uint256 amount; uint64 timestamp; }
struct Claim   { bytes32 node; uint256 paymentId; ViolationType vtype; uint256 amount; ClaimStatus status; }

// ---------- Person A ----------
interface IPolicyRegistry {
    struct IssueParams {
        string  label;            // "agent1" -> agent1.surety.eth
        address agent;
        address payoutAddr;
        uint256 coverageLimit;
        uint256 perTxCap;
        address[] allowlist;
        uint8   tier;
    }
    function issuePolicy(IssueParams calldata p, bytes32 subHash, uint64 expiry, bytes calldata enrollSig)
        external returns (bytes32 node);           // pulls premium in MockUSDC
    function updateStreak(bytes32 node, uint32 streak) external;   // only p.agent
    function getPolicy(bytes32 node) external view returns (PolicyRecord memory);
    function isAllowed(bytes32 node, address counterparty) external view returns (bool);
    function totalCoverage() external view returns (uint256);
    function recordPayout(bytes32 node, uint256 amount) external;  // only ClaimRouter

    event PolicyIssued(bytes32 indexed node, address indexed policyholder, address agent, uint256 coverageLimit, uint256 premium);
    event StreakUpdated(bytes32 indexed node, uint32 streak);
}

interface IAgentVault {
    function deposit(bytes32 node, uint256 amount) external;
    function pay(bytes32 node, address to, uint256 amount) external returns (uint256 paymentId); // only agent; records, does not block
    function swap(bytes32 node, /* PoolKey */ bytes calldata key, /* SwapParams */ bytes calldata params) external; // hookData = abi.encode(node)
    function getPayment(uint256 paymentId) external view returns (Payment memory);

    event PaymentMade(bytes32 indexed node, uint256 indexed paymentId, address to, uint256 amount);
}

interface ISuretyHook {
    function depositPremium(bytes32 node, uint256 amount) external;   // only PolicyRegistry
    function depositBacking(uint256 amount) external;                 // anyone (backers)
    function releasePayout(uint256 claimId, address to, uint256 amount) external; // only ClaimRouter
    function liquidReserve() external view returns (uint256);
    // beforeSwap: decode node from hookData; revert PolicyViolation if over cap / off allowlist

    error PolicyViolation(bytes32 node, ViolationType reason);
    event PremiumDeposited(bytes32 indexed node, uint256 amount);
    event BackingDeposited(address indexed backer, uint256 amount);
    event PayoutReleased(uint256 indexed claimId, address to, uint256 amount);
}

// ---------- Person B ----------
interface IViolationOracle {
    function check(uint256 paymentId) external view returns (ViolationType);  // recomputes from vault + registry
}

interface IWorldIdGate {
    function verifyEnrollment(address policyholder, bytes32 subHash, uint64 expiry, bytes calldata sig) external view returns (bool);
    function approveClaim(uint256 claimId, bytes32 subHash, uint64 authTime, uint64 expiry, bytes calldata sig) external; // replay-protected
    function isApproved(uint256 claimId) external view returns (bool);

    event ClaimApproved(uint256 indexed claimId, uint64 authTime);
}

interface IClaimRouter {
    function fileClaim(bytes32 node, uint256 paymentId) external returns (uint256 claimId); // only policyholder
    function markHeld(uint256 claimId, string calldata reason) external;   // only backend signer (denied/expired/cancelled)
    function execute(uint256 claimId) external;                            // requires gate approval -> hook.releasePayout
    function getClaim(uint256 claimId) external view returns (Claim memory);

    event ClaimFiled(uint256 indexed claimId, bytes32 indexed node, uint256 paymentId, ViolationType vtype, uint256 amount);
    event ClaimHeld(uint256 indexed claimId, string reason);
    event ClaimPaid(uint256 indexed claimId, address to, uint256 amount);
    event ClaimRejected(uint256 indexed claimId, string reason);
}

library PricingEngine {
    function quote(uint256 coverage, uint8 tier, uint32 streak, uint32 claims, uint32 periods)
        internal pure returns (uint256 premium, uint256 lambdaPost, uint256 z, uint256 tierLoading, uint256 streakDiscount);
}
```

**EIP-712 messages signed by the backend (`BACKEND_SIGNER`):**
- `Enrollment(address policyholder, bytes32 subHash, uint64 expiry)`
- `ClaimApproval(uint256 claimId, bytes32 subHash, uint64 authTime, uint64 expiry)`

### Backend REST API (Person B serves, Person C consumes)

| Method | Path | Returns |
|---|---|---|
| GET | `/auth/worldid/start?purpose=enroll&address=0x…` | 302 to World ID OIDC |
| GET | `/auth/worldid/start?purpose=claim&claimId=N` | 302 to World ID OIDC (`prompt=login`, `max_age=0`, `nonce=claimId`) |
| GET | `/auth/worldid/callback` | 302 back to frontend `?session=…` |
| GET | `/api/worldid/session/:id` | `{ status: "approved"\|"denied"\|"expired"\|"cancelled", subHash?, expiry?, authTime?, sig? }` |
| GET | `/api/feed?node=` | `[{ type, node, txHash, block, data }]` from the indexer |
| GET | `/api/policy/:node` | cached `PolicyRecord` + payments + claims |
| GET | `/api/solvency` | `{ liquidReserve, totalCoverage, ratio }` |
| POST | `/api/agent/step` `{ step: "normal"\|"attack-swap"\|"violation" }` | `{ txHash, reverted, paymentId? }` (runs the simulator for the demo page) |

Person C: build against **fixtures** in `frontend/lib/mock/` with this exact shape until S3.

---

## 3. Person A — Chain: ENS + Uniswap

**Goal:** policies live on ENSv2, money lives in a v4 hook, the hook blocks the Grok-style attack.

### Tasks
- [ ] **A1. ENSv2 groundwork (before 11:00).** Register `surety.eth` (or fallback test name) on Sepolia ENSv2. Confirm from the workshop/docs: how to create a subname with transfer permissions locked, how to set Permissioned Resolver records, how Enhanced Access Control grants one field to one key. Write findings in `docs/ARCHITECTURE.md#ens`.
- [ ] **A2. `MockUSDC.sol`** — mintable ERC20, 6 decimals.
- [ ] **A3. `PolicyRegistry.sol`**
  - `issuePolicy`: verify `WorldIdGate.verifyEnrollment`, compute premium via `PricingEngine.quote` (B's lib), pull MockUSDC → `hook.depositPremium`, create non-transferable subname, write resolver records (`surety.coverageLimit`, `surety.perTxCap`, `surety.tier`, `surety.allowlist`, `surety.streak`), grant agent key EAC on `surety.streak` only, check 2× reserve invariant.
  - Local `PolicyRecord` storage mirrors ENS (enforcement reads from here; ENS is the published source — resolver looked up fresh when reading records back).
  - `updateStreak` only by `agent`; `recordPayout` only by `ClaimRouter`.
- [ ] **A4. `AgentVault.sol`** — per-node balances, `pay()` records every transfer (no blocking — that's what makes violations claimable), `swap()` calls the v4 router with `hookData = abi.encode(node)`.
- [ ] **A5. `SuretyHook.sol`** — v4 `BaseHook`, `beforeSwap` permission. Decodes `node`, reverts `PolicyViolation` if over `perTxCap` or counterparty off allowlist. Holds MockUSDC reserve; `depositPremium`, `depositBacking`, `releasePayout` (only ClaimRouter, only from reserve).
  - Build and test **in isolation first** (hello-world hook by 12:00). Keep a `bool enforce` flag fallback.
- [ ] **A6. Deploy scripts** — `Deploy.s.sol` (MockUSDC → Registry → Vault → Hook via HookMiner salt → pool init MockUSDC/WETH → wire B's contracts' addresses), writes `deployments/sepolia.json`. `SeedDemo.s.sol`: mint, **fund backing first**, then issue demo policy `agent1.surety.eth`, deposit agent funds.
- [ ] **A7. Tests** — `PolicyRegistry.t.sol`, `AgentVault.t.sol`, `SuretyHook.t.sol`, **`AttackReplay.t.sol`** (manipulated swap reverts; reserve invariant holds).
- [ ] **A8. `npm run abi:export`** — copies `contracts/out/*.json` ABIs to `frontend/lib/abi/` and `backend/src/abi/`.
- [ ] **A9. Docs** — `FEEDBACK.md` + submit Uniswap Developer Feedback Form **same day the hook ships**; `CONTRACTS.md`; README links to exact hook/registry lines.

### Done when
`forge test` green; contracts verified on Sepolia Etherscan; `agent1.surety.eth` resolves with policy records in the ENS app; a rule-breaking swap reverts on Sepolia.

### Fallbacks (decide at S2, 17:00)
- EAC / non-transferable subname not working → issue a normal subname, keep PolicyRegistry as the write gate, say so honestly in README.
- Hook address mining / pool init stuck → hook deployed as plain reserve contract with `enforce=false`; enforcement lives in `AgentVault.swap` pre-check.

---

## 4. Person B — Trust: World ID + claims + backend

**Goal:** a claim pays only when the *same human* who bought the policy re-verifies *right now*; everything the demo needs runs from the backend.

### Tasks
- [ ] **B1. World ID sandbox spike (before 12:00 — highest-risk item in the project).** Get World ID for Agents sandbox credentials (sandbox.auth.world.org). Complete one real OIDC round trip locally; confirm id_token claims (`sub`, `auth_time`, `nonce`), JWKS URL, and how cancel/deny comes back. Report at S1.
- [ ] **B2. Backend server** (`backend/src/server.ts`, Hono or Express)
  - `worldid/verifyProofOfHuman.ts` — enrollment: verify id_token (sig via JWKS, `iss`, `aud`, `nonce`), `subHash = keccak256(sub)`, sign `Enrollment`.
  - `worldid/verifyFreshCheck.ts` — claim: verify token, `auth_time` within 120s, `nonce == claimId`, `subHash == policy.subHash` (read on-chain), sign `ClaimApproval`; on deny/cancel/expired → call `ClaimRouter.markHeld`.
  - Sessions in memory; REST API exactly as in §2.
- [ ] **B3. `WorldIdGate.sol`** — EIP-712 verify against `BACKEND_SIGNER`, expiry check, one-use per `claimId`.
- [ ] **B4. `ViolationOracle.sol`** — `check(paymentId)`: reads `AgentVault.getPayment` + `PolicyRegistry` → `CapBreach` / `OffAllowlist` / `None`. (Stretch: `Attested` via Intercepta verdict signed by backend.)
- [ ] **B5. `ClaimRouter.sol`** — `fileClaim` (only policyholder, oracle must return ≠ None, paymentId not yet claimed) → `Pending`; `markHeld`; `execute` (gate approved, payout = `min(amount, coverageLimit - paidOut)`, to `payoutAddr` ≠ violating counterparty) → `hook.releasePayout` + `registry.recordPayout`.
- [ ] **B6. `PricingEngine.sol`** library (§5) + `PricingEngine.t.sol`.
- [ ] **B7. Tests** — `WorldIdGate.t.sol`, `ClaimRouter.t.sol` (happy path, held path, replay rejected, self-dealing rejected, double-claim rejected). Coordinate with A to extend `AttackReplay.t.sol` with the "transfer slips through → claim paid" half.
- [ ] **B8. Indexer** (`indexer/watchEvents.ts`) — viem `watchContractEvent` on all contracts → in-memory feed for `/api/feed`, `/api/policy/:node`, `/api/solvency`.
- [ ] **B9. Agent simulator** (`backend/src/agent/`) — agent key does: 2 normal payments → attack swap (reverts) → one over-cap `pay()` (the violation). Exposed via `POST /api/agent/step` and a CLI (`npm run agent:demo`).
- [ ] **B10. Deploy backend** (Railway/Render/Fly or a Vercel serverless route — whatever deploys fastest; confirm with C).
- [ ] **B11. Docs** — README (fill the Step 0 skeleton), `PRICING_MODEL.md`, `AI_ATTRIBUTION.md`, `PITCH.md`.

### Stretch (in this order)
1. **IDKit proof-of-uniqueness at policy purchase** (second World prize, same slot) — only after the full claim flow works on Sepolia.
2. `surety-mcp` MCP server wrapping the simulator (`surety_pay`, `surety_status`, `surety_file_claim`, …).
3. Intercepta attested violation.

### Done when
Real World ID sandbox approve → claim paid on Sepolia; real cancel → `ClaimHeld` on Sepolia; both visible in `/api/feed`.

### Fallback
Sandbox broken/unavailable → keep the exact same backend flow with a clearly labeled "sandbox unavailable" mock IdP; still validate and sign server-side. Tell World's booth immediately.

---

## 5. Pricing formula (Person B implements, Person C displays)

```
Z          = n / (n + k)                         n = policy periods observed, k = 10
λ_agent    = claims / max(n, 1)
λ_post     = Z·λ_agent + (1 − Z)·λ_prior        λ_prior = 5%
tierLoad   = [1.50, 1.25, 1.00][tier]
streakDisc = min(streak × 1%, 20%)
premium    = coverage × λ_post × tierLoad × (1 − streakDisc)
```

Fixed-point in Solidity (1e18). The UI shows every line updating as the user edits the form.

---

## 6. Person C — Frontend

**Goal:** a judge understands the whole product in 3 minutes from the screen alone.

### Stack
Next.js (App Router) + wagmi + viem + Tailwind + shadcn/ui + Framer Motion. Hero visual: **decide by 11:00** — Spline embed *or* CSS/SVG gradient (no hand-written WebGL).

### Design
Background `#0A0A0B`, one accent color, extra-bold (800–900) headline only on `/` and `/demo`, pill-shaped buttons/nav, lots of negative space. Data pages stay clean and dense.

### Pages
| Route | Contents | Depends on |
|---|---|---|
| `/` Create Policy (hero) | Pill nav + Connect; World ID enroll button → `/auth/worldid/start?purpose=enroll`; form (label, agent, payout addr, coverage, cap, allowlist, tier); **`PricingBreakdown`** live, term by term; approve MockUSDC → `issuePolicy` | Registry ABI, backend session API |
| `/policy/[agentName]` | Name search box (replaces Counterparty Lookup); ENS records read live via `lib/ens.ts` (resolver fresh every read); streak; payments list with violation badges; **File Claim → World ID → Execute** flow with Pending / Held / Paid states | Registry, Vault, ClaimRouter ABIs; `/api/policy/:node` |
| `/demo` Attack Replay (hero) | `AttackReplayConsole`: buttons that walk the 3-min script — normal tx → attack swap **BLOCKED** → violation → claim → cancel (HELD) → retry (PAID). Shows tx hashes linking to Sepolia Etherscan | `/api/agent/step`, same claim components |
| `/feed` | Global event feed (`ClaimCard`s) + **`SolvencyBar`** (reserve vs 2× coverage) + "Back the pool" deposit | `/api/feed`, `/api/solvency`, Hook ABI |

### Tasks
- [ ] **C1.** Scaffold Next.js, Tailwind, shadcn, wagmi (Sepolia), layout + pill nav, theme tokens.
- [ ] **C2.** `lib/mock/` fixtures matching §2 API + `lib/abi/` placeholders; build every page against mocks first.
- [ ] **C3.** `PricingBreakdown.tsx` (port §5 formula to TS; must match B's Solidity output — cross-check 3 values at S3).
- [ ] **C4.** `WorldIdPrompt.tsx` + `useWorldId.ts` — redirect, poll `/api/worldid/session/:id`, render approved / denied / expired / cancelled.
- [ ] **C5.** `lib/ens.ts` — resolve resolver fresh (`getEnsResolver` every call), read `surety.*` records.
- [ ] **C6.** Swap mocks for real ABIs + `deployments/sepolia.json` at S2/S3.
- [ ] **C7.** Hero visual on `/` and `/demo`; Framer Motion only for hero + replay reveal.
- [ ] **C8.** Deploy to **Vercel**; env: `NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_CHAIN_ID=11155111`, RPC.
- [ ] **C9.** Drive rehearsals; **record the demo video**; screenshots for README.

### Done when
The whole §8 script can be clicked through on the Vercel URL against Sepolia with no terminal.

---

## 7. Timeline & sync points (JST, Sat Sep 26 → Sun Sep 27)

| Time | A — Chain | B — Trust | C — Frontend |
|---|---|---|---|
| **09:00–10:00** | Step 0 together: git + GitHub repo, README skeleton, `.gitignore`, `CLAUDE.md`, scaffold folders, `.claude/agents/`, paste §2 into `interfaces/` | ← same | ← same |
| **⏱ S0 10:00** | **Interfaces locked. Everyone starts.** | | |
| 10:00–13:00 | A1 ENS groundwork, A2, hello-world hook | **B1 World ID spike**, B6 PricingEngine | C1, C2, page shells on mocks |
| **⏱ S1 13:00** | Go/no-go: World ID round trip works? Hook compiles & deploys on anvil? ENSv2 subname created? → pick fallbacks now | | |
| 13:00–17:00 | A3, A4, A5 + tests | B3, B4, B5 + tests, B2 server | C3 PricingBreakdown, C4, C5, hero decided |
| **⏱ S2 17:00** | **All contracts on Sepolia**, `deployments/sepolia.json` + ABIs exported; SeedDemo run | backend reads real addresses | swap to real ABIs |
| 17:00–22:00 | A6 polish, A7 AttackReplay, verify on Etherscan | B8 indexer, B9 simulator, B10 deploy | C6 wiring, `/demo` console |
| **⏱ S3 22:00** | **End-to-end on Sepolia:** enroll → issue → violation → claim → cancel (held) → retry (paid). Fix only blockers after this. | | |
| 22:00–02:00 | A9 FEEDBACK.md + form, CONTRACTS.md | IDKit stretch **only if S3 passed**; README | C7 visuals, C8 Vercel |
| **⏱ S4 02:00** | **Feature freeze.** Bug fixes only. | | |
| 02:00–05:00 | Sleep in shifts (1 person always awake on bugs) | | |
| 05:00–07:00 | Rehearse ×3, re-run SeedDemo fresh | PITCH.md, AI_ATTRIBUTION.md | **Record video** |
| **⏱ S5 07:00** | Submit: ENS, World, Uniswap (+ Curvegrid, README only). Double-check repo public, links live. | | |
| **08:00** | **Submitted.** 1h buffer to 09:00 deadline. | | |

**If S3 slips past 00:00:** drop IDKit, MCP, Intercepta, LP split, Spline. Everything in §8 must still work.

---

## 8. Demo script (3 min) — the acceptance test

1. **0:00–0:25** Cold open — 91% plan to use AI, standard policies now exclude AI losses. *"Surety pays out before the lawyers get involved."*
2. **0:25–0:55** `/policy/agent1` — ENS record live: limit, cap, allowlist, tier, premium breakdown. *(ENS)*
3. **0:55–1:25** `/demo` — normal payments ✓ → Grok-style attack swap **blocked by the v4 hook** → a rule-breaking transfer slips through, **flagged on-chain**. *(Uniswap)*
4. **1:25–2:00** File claim → World ID prompt → **cancel** → claim **HELD**, not paid. *(World)*
5. **2:00–2:35** Retry → verify → payout released live from the v4 hook reserve, Etherscan link. *(World + Uniswap)*
6. **2:35–3:00** `/feed` audit trail + SolvencyBar; three tracks used natively; business model in one line.

---

## 9. Working agreements

- **Git:** one branch per person (`a/chain`, `b/trust`, `c/frontend`), small commits, merge to `main` at every sync point. Judges check history for incremental commits — no giant commit.
- **Ownership:** only touch your own files; shared files change only at sync points.
- **Every contract has a test** before it's "done". `forge test` must be green on `main`.
- **Secrets:** only in `.env` (git-ignored). Each folder has `.env.example`:
  - contracts: `SEPOLIA_RPC_URL`, `DEPLOYER_PK`, `ETHERSCAN_API_KEY`, `BACKEND_SIGNER`
  - backend: `SEPOLIA_RPC_URL`, `BACKEND_SIGNER_PK`, `AGENT_PK`, `WORLDID_CLIENT_ID`, `WORLDID_CLIENT_SECRET`, `WORLDID_ISSUER`, `FRONTEND_URL`
  - frontend: `NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_CHAIN_ID`
- **Blocked > 30 min?** Say it in the team chat immediately and take the fallback.
- **Claude Code:** each person runs their own session with their subagent; everyone's `CLAUDE.md` is the same file from `main`.

---

## 10. Open items to confirm at S0

- [ ] Who is A / B / C (names)?
- [ ] World ID for Agents sandbox credentials obtained?
- [ ] ENSv2 parent name on Sepolia registered?
- [ ] Uniswap v4 PoolManager address on Sepolia confirmed?
- [ ] Sepolia ETH in all three deployer/agent/signer wallets?
- [ ] Hero visual: Spline or CSS gradient?
- [ ] Do we have `Surety_Full_Specification.docx`? (If yes, replace §5 with its real pricing formula.)
