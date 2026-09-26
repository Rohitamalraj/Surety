import { createConfig, http } from "wagmi";
import { foundry, sepolia } from "viem/chains";
import { injected } from "wagmi/connectors";
import { NETWORK, RPC_URL } from "./config";

export const wagmiConfig =
  NETWORK === "sepolia"
    ? createConfig({ chains: [sepolia], connectors: [injected()], transports: { [sepolia.id]: http(RPC_URL) }, ssr: true })
    : createConfig({ chains: [foundry], connectors: [injected()], transports: { [foundry.id]: http(RPC_URL) }, ssr: true });
