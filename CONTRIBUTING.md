# Contributing to Palisec

Thanks for taking the time to look at Palisec.

## Reporting problems

- **Security issues:** never open a public issue. Follow [SECURITY.md](SECURITY.md).
- **Bugs:** open an issue with the bug report form. Include the decision ID or request ID if a decision looks wrong, the reason code, and what you expected instead.
- **The standard (ERC-8511):** discuss changes to the specification on the [Ethereum Magicians thread](https://ethereum-magicians.org/t/erc-8511-policy-enforced-agent-accounts/30467) rather than here.

## Pull requests

1. Keep a change focused on one feature or fix, on a branch named after it.
2. Run the checks before opening it:

   ```sh
   pnpm install
   pnpm typecheck
   pnpm lint
   pnpm test
   ```

   For contracts: `cd contracts && forge test`.
3. **Policy engine changes** must keep the TypeScript reference (`packages/policy-schema`) and the Rust engine (`services/policy-engine`) in agreement:
   - rebuild the WebAssembly with `pnpm --filter @palisec/policy-engine build:wasm`;
   - regenerate the parity fixtures with `WRITE_FIXTURES=1 pnpm --filter @palisec/policy-engine test`.
4. **Reason codes** are append-only: never renumber or reuse one.
5. **Fail closed:** missing state, prices, simulations or policies must never allow.

## Code style

TypeScript is checked with `tsc` and ESLint; Rust with `cargo`. Prefer small, explicit functions and comments that explain why, not what.
