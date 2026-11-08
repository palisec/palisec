import asyncio
import json
import re
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from palisec import (  # noqa: E402
    REASON_CODES,
    RETRYABLE,
    Intent,
    Palisec,
    PalisecApprovalError,
    PalisecConfigError,
    PalisecDeniedError,
    PalisecError,
    PalisecTimeoutError,
    redact,
)
from palisec.web3 import Web3Sender  # noqa: E402

KEY = "ps_test_" + "ab" * 24
TO = "0x2222222222222222222222222222222222222222"
ACCOUNT = "0x1111111111111111111111111111111111111111"
OP_ID = "11111111-2222-3333-4444-555555555555"


def op(**over):
    base = {
        "operation_id": OP_ID,
        "request_id": "r1",
        "decision": "ALLOW",
        "state": "authorized",
        "reason_code": None,
        "message": "Authorized.",
        "retryable": False,
        "policy_id": "p",
        "policy_version": 1,
        "authorization_id": "ps_auth_x",
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat().replace("+00:00", "Z"),
        "checks": [{"id": "target", "label": "Target", "status": "pass", "detail": "ok"}],
        "dry_run": False,
        "details": {"account": ACCOUNT},
    }
    base.update(over)
    return base


class Server:
    """A scripted transport: each item is (status, body) or an exception to raise."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    async def __call__(self, method, url, headers, body, timeout):
        self.calls.append({"method": method, "url": url, "headers": headers, "body": json.loads(body) if body else None})
        nxt = self.responses.pop(0)
        if isinstance(nxt, BaseException):
            raise nxt
        status, payload = nxt
        return status, json.dumps(payload)


def client(server, **kw):
    return Palisec(KEY, transport=server, **kw)


class RecordingSender:
    def __init__(self, address=ACCOUNT):
        self.address = address
        self.sent = []

    async def send_transaction(self, tx):
        self.sent.append(tx)
        return "0xhash"


class ConfigTests(unittest.TestCase):
    def test_rejects_bad_key_chain_and_plain_http(self):
        with self.assertRaises(PalisecConfigError):
            Palisec("sk_live_nope")
        with self.assertRaises(PalisecConfigError):
            Palisec(KEY, chain_id=1)
        with self.assertRaises(PalisecConfigError):
            Palisec(KEY, base_url="http://palisec.tech/api/v1")
        Palisec(KEY, base_url="http://localhost:3000/api/v1")

    def test_repr_never_shows_the_key(self):
        self.assertNotIn(KEY, repr(Palisec(KEY)))

    def test_redact(self):
        self.assertNotIn(KEY, redact(f"key={KEY}"))
        self.assertIn("ps_test_abab", redact(f"key={KEY}"))

    def test_reason_codes_match_the_canonical_list(self):
        ts = (Path(__file__).resolve().parents[2] / "policy-schema" / "src" / "codes.ts").read_text(encoding="utf-8")
        codes = dict(re.findall(r'^\s+(PS_[A-Z]+_\d{3}): "([^"]+)"', ts, re.M))
        retry = {k: v == "true" for k, v in re.findall(r"^\s+(PS_[A-Z]+_\d{3}): (true|false)", ts, re.M)}
        self.assertEqual(REASON_CODES, codes)
        self.assertEqual(RETRYABLE, retry)


class RequestTests(unittest.IsolatedAsyncioTestCase):
    async def test_authorize_builds_the_request(self):
        s = Server((201, op()))
        res = await client(s).authorize(to=TO, value=10**18, data="0xa9059cbb", gas_limit=90_000, request_id="req-1")
        call = s.calls[0]
        self.assertEqual(call["method"], "POST")
        self.assertTrue(call["url"].endswith("/api/v1/operations"))
        self.assertEqual(call["headers"]["authorization"], f"Bearer {KEY}")
        self.assertEqual(call["headers"]["idempotency-key"], "req-1")
        self.assertEqual(call["body"]["value_wei"], "1000000000000000000")
        self.assertEqual(call["body"]["chain_id"], 46630)
        self.assertEqual(call["body"]["gas_limit"], 90_000)
        self.assertEqual(res.decision, "ALLOW")
        self.assertTrue(res.allowed)
        self.assertIsInstance(res.expires_at, datetime)
        self.assertEqual(res.checks[0].status, "pass")

    async def test_default_gas_and_intent_object(self):
        s = Server((201, op()), (201, op()))
        await client(s).authorize(Intent(to=TO))
        await client(s).authorize(Intent(to=TO, data="0x1234"))
        self.assertEqual([c["body"]["gas_limit"] for c in s.calls], [21_000, 250_000])

    async def test_deny_is_a_value_not_an_exception(self):
        s = Server((201, op(decision="DENY", state="denied", reason_code="PS_TARGET_001", authorization_id=None)))
        res = await client(s).authorize(to=TO)
        self.assertEqual(res.reason_code, "PS_TARGET_001")
        self.assertFalse(res.allowed)

    async def test_retries_with_the_same_idempotency_key(self):
        s = Server((503, {"error": {"code": "PS_STATE_001", "message": "x"}}), ConnectionError("reset"), (201, op()))
        await client(s).authorize(to=TO)
        keys = {c["headers"]["idempotency-key"] for c in s.calls}
        self.assertEqual(len(s.calls), 3)
        self.assertEqual(len(keys), 1)

    async def test_no_retry_on_conflict(self):
        s = Server((409, {"error": {"code": "PS_REPLAY_001", "message": "dup", "retryable": False}}))
        with self.assertRaises(PalisecError) as ctx:
            await client(s).authorize(to=TO)
        self.assertEqual(ctx.exception.code, "PS_REPLAY_001")
        self.assertEqual(ctx.exception.status, 409)
        self.assertEqual(len(s.calls), 1)

    async def test_timeout_is_typed_and_retryable(self):
        s = Server(TimeoutError(), TimeoutError(), TimeoutError())
        with self.assertRaises(PalisecTimeoutError) as ctx:
            await client(s, max_retries=2).authorize(to=TO)
        self.assertTrue(ctx.exception.retryable)
        self.assertEqual(len(s.calls), 3)

    async def test_cancel_is_never_retried(self):
        s = Server((503, {"error": {"code": "PS_STATE_001", "message": "x"}}))
        with self.assertRaises(PalisecError):
            await client(s).cancel(OP_ID)
        self.assertEqual(len(s.calls), 1)

    async def test_error_messages_are_redacted_and_logs_hold_no_secrets(self):
        events = []
        s = Server((401, {"error": {"code": "PS_AUTH_001", "message": f"bad key {KEY}"}}))
        with self.assertRaises(PalisecError) as ctx:
            await client(s, logger=events.append).authorize(to=TO, data="0xdeadbeef")
        self.assertNotIn(KEY, ctx.exception.message)
        blob = json.dumps(events)
        self.assertNotIn(KEY, blob)
        self.assertNotIn("deadbeef", blob)
        self.assertEqual(events[-1]["code"], "PS_AUTH_001")

    async def test_rejects_bad_input_before_calling(self):
        s = Server()
        with self.assertRaises(PalisecConfigError):
            await client(s).authorize(to="0x12")
        with self.assertRaises(PalisecConfigError):
            await client(s).authorize(to=TO, data="nothex")
        with self.assertRaises(PalisecConfigError):
            await client(s).get_operation("../../admin")
        self.assertEqual(s.calls, [])


class SendTests(unittest.IsolatedAsyncioTestCase):
    async def test_sends_only_on_allow(self):
        s, w = Server((201, op())), RecordingSender()
        res = await client(s).send_transaction(w, to=TO, value=1)
        self.assertEqual(res.hash, "0xhash")
        self.assertEqual(w.sent, [{"to": TO, "value": 1, "data": "0x", "gas": 21_000, "chainId": 46630}])

    async def test_never_sends_on_deny(self):
        s, w = Server((201, op(decision="DENY", state="denied", reason_code="PS_BUDGET_001", authorization_id=None))), RecordingSender()
        with self.assertRaises(PalisecDeniedError) as ctx:
            await client(s).send_transaction(w, to=TO)
        self.assertEqual(ctx.exception.code, "PS_BUDGET_001")
        self.assertEqual(w.sent, [])

    async def test_refuses_a_sender_that_is_not_the_agent(self):
        s, w = Server((201, op())), RecordingSender(address=TO)
        with self.assertRaises(PalisecConfigError):
            await client(s).send_transaction(w, to=TO)
        self.assertEqual(w.sent, [])

    async def test_held_is_returned_unsent(self):
        held = op(decision="REQUIRES_HUMAN_SIGNATURE", state="pending_approval", reason_code="PS_HUMAN_001", authorization_id=None)
        s, w = Server((201, held)), RecordingSender()
        res = await client(s).send_transaction(w, to=TO)
        self.assertIsNone(res.hash)
        self.assertEqual(res.operation.state, "pending_approval")
        self.assertEqual(w.sent, [])

    async def test_waits_for_approval_then_sends(self):
        held = op(decision="REQUIRES_HUMAN_SIGNATURE", state="pending_approval", authorization_id=None)
        approved = op(decision="REQUIRES_HUMAN_SIGNATURE", state="approved", authorization_id="ps_auth_y")
        s, w = Server((201, held), (200, held), (200, approved)), RecordingSender()
        c = client(s)
        orig = asyncio.sleep

        async def fast(_):
            await orig(0)

        asyncio.sleep = fast
        try:
            res = await c.send_transaction(w, to=TO, wait_for_approval=True)
        finally:
            asyncio.sleep = orig
        self.assertEqual(res.hash, "0xhash")
        self.assertEqual(res.operation.authorization_id, "ps_auth_y")

    async def test_rejected_approval_raises(self):
        rejected = op(decision="REQUIRES_HUMAN_SIGNATURE", state="rejected", authorization_id=None)
        with self.assertRaises(PalisecApprovalError) as ctx:
            await client(Server((200, rejected))).wait_for_approval(OP_ID)
        self.assertEqual(ctx.exception.code, "PS_HUMAN_001")

    async def test_expired_authorization_is_not_sent(self):
        past = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
        s, w = Server((201, op(expires_at=past))), RecordingSender()
        with self.assertRaises(PalisecTimeoutError):
            await client(s).send_transaction(w, to=TO)
        self.assertEqual(w.sent, [])


class FakeEth:
    def __init__(self, chain_id):
        self.chain_id = chain_id
        self.gas_price = 7
        self.raw = None

    async def get_transaction_count(self, address, block):
        return 3

    async def send_raw_transaction(self, raw):
        self.raw = raw
        return bytes.fromhex("ab" * 32)


class FakeAccount:
    address = ACCOUNT

    def __init__(self):
        self.signed = None

    def sign_transaction(self, tx):
        self.signed = tx
        return type("Signed", (), {"raw_transaction": b"\x01\x02"})()


class Web3AdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_signs_with_bounded_gas_and_sends(self):
        eth, acct = FakeEth(46630), FakeAccount()
        sender = Web3Sender(type("W3", (), {"eth": eth})(), acct)
        res = await client(Server((201, op()))).send_transaction(sender, to=TO, data="0xa9059cbb", gas_limit=90_000)
        self.assertEqual(res.hash, "0x" + "ab" * 32)
        self.assertEqual(acct.signed["gas"], 90_000)
        self.assertEqual(acct.signed["gasPrice"], 7)
        self.assertEqual(acct.signed["nonce"], 3)
        self.assertEqual(eth.raw, b"\x01\x02")

    async def test_refuses_an_rpc_on_another_chain(self):
        eth, acct = FakeEth(1), FakeAccount()
        sender = Web3Sender(type("W3", (), {"eth": eth})(), acct)
        with self.assertRaises(PalisecConfigError):
            await client(Server((201, op()))).send_transaction(sender, to=TO)
        self.assertIsNone(acct.signed)


if __name__ == "__main__":
    unittest.main()
