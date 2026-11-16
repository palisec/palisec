# palisec

Python client for [Palisec](https://palisec.tech): your agent asks before every transaction and sends only on ALLOW.
Async, typed, and no third-party dependencies. Python 3.10 or later.

```bash
pip install https://palisec.tech/sdk/palisec-0.2.0-py3-none-any.whl
```

```python
import os
from palisec import Palisec, PalisecDeniedError

async with Palisec(os.environ["PALISEC_API_KEY"]) as palisec:  # server-side only
    try:
        result = await palisec.send_transaction(sender, to=TOKEN, data=calldata, gas_limit=90_000)
        if result.hash is None:
            print("held for a human approver:", result.operation.operation_id)
    except PalisecDeniedError as e:
        print(e.code, e.message)  # nothing was sent
```

`sender` is the agent's own account. With web3.py:

```python
from web3 import AsyncWeb3, AsyncHTTPProvider
from eth_account import Account
from palisec.web3 import Web3Sender

w3 = AsyncWeb3(AsyncHTTPProvider("https://rpc.testnet.chain.robinhood.com"))
sender = Web3Sender(w3, Account.from_key(os.environ["AGENT_KEY"]))
```

- `authorize(...)` records a decision: `ALLOW`, `DENY` or `REQUIRES_HUMAN_SIGNATURE`. It does not raise on DENY. Safe to retry: the request ID is the idempotency key.
- `evaluate(...)` is a dry run that reserves nothing.
- `wait_for_approval(id)`, `get_operation(id)`, `cancel(id)` (withdraws a pending approval; never retried).
- Errors are `PalisecError` subclasses with a stable `code` (`PS_…`). Retries happen only for network errors, 429 and 5xx, and only on calls that are safe to repeat.
- Log events never contain your API key, request bodies or calldata; `redact()` masks keys in any string.

Palisec is pre-release on Robinhood Chain Testnet (46630). It authorizes; it does not sign or broadcast, and until the on-chain module ships, a key used outside Palisec can still transact. Docs: https://palisec.tech/docs/sdk/python
