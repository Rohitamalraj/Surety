# Surety frontend

Next.js 16 (App Router) + wagmi 3 + viem + IDKit 4. Design system ported from the KOLlateral
reference: bone-white paper, halftone dither as the surface voice, lime signal used sparingly,
red/green only for money and verdicts. Fonts: Bricolage Grotesque / Spline Sans Mono / Pixelify Sans.

| Route | What |
|---|---|
| `/` | Landing — interactive dither hero; hover ENS / World / Uniswap to see why each is load-bearing |
| `/create` | Create policy — wallet → IDKit unique human → World ID for Agents enrollment → rules → live premium → issue |
| `/demo` | Attack Replay — the on-stage script (PRD §23), driven by the backend's demo agent |
| `/policy`, `/policy/[name]` | Counterparty lookup; policy detail, ENS records, payments, claims + World ID claim flow |
| `/feed` | Public audit trail, solvency bar, back the pool |
| `/worldid/return` | Forwards World ID results back to the page that started the flow |

## Run locally

```bash
cd backend && npm run devnet        # terminal 1
cd backend && npm run dev:local     # terminal 2
cd frontend && npm install && npm run dev   # terminal 3 → http://localhost:3000
```

The pricing math in `lib/pricing.ts` mirrors `contracts/src/PricingEngine.sol` (PRD §14.1 fixtures:
625.00 / 133.33 / 890.63 USDC). The ENS resolver is looked up fresh on every read (`lib/ens.ts`).
