import { BaseError, ContractFunctionRevertedError } from "viem";

/** Turns a viem error into a short message, naming the contract's custom error when there is one. */
export function describeError(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (revert?.data?.errorName) {
      const args = revert.data.args?.map(String).join(", ");
      return args ? `${revert.data.errorName}(${args})` : revert.data.errorName;
    }
    if (revert?.reason) return revert.reason;
    return err.shortMessage;
  }
  return (err as Error)?.message?.split("\n")[0] ?? String(err);
}
