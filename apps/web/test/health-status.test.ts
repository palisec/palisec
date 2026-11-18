import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bundlerReason, cosignerReason, httpStatusFor, overallStatus, serviceState, type HealthCheck } from "../src/lib/health-status.ts";

const c = (id: string, critical: HealthCheck["critical"], ok: boolean, verified = true, reason: string | null = ok ? null : `${id} is not running`): HealthCheck => ({
  id, label: id, critical, configured: true, ok, verified, state: ok ? "ok" : "failed", reason,
});
const ALL_OK = [
  c("database", "decisions", true), c("auth", "decisions", true), c("policy_engine", "decisions", true),
  c("mainnet_cosigner", "execution", true, false), c("mainnet_bundler", "execution", true),
  c("testnet_cosigner", "none", true, false), c("testnet_bundler", "none", true),
  c("agent_model", "none", true, false), c("webhooks", "none", true, false),
];
const without = (id: string, list = ALL_OK) => list.map((x) => (x.id === id ? c(x.id, x.critical, false, x.verified) : x));

describe("overall status", () => {
  it("is ok and HTTP 200 only when every check passes", () => {
    assert.equal(overallStatus(ALL_OK), "ok");
    assert.equal(httpStatusFor("ok"), 200);
  });
  for (const id of ["database", "auth", "policy_engine"]) {
    it(`is down and HTTP 503 when ${id} fails (decisions are refused)`, () => {
      assert.equal(overallStatus(without(id)), "down");
      assert.equal(httpStatusFor(overallStatus(without(id))), 503);
    });
  }
  for (const id of ["mainnet_cosigner", "mainnet_bundler"]) {
    it(`is degraded and HTTP 503 when ${id} fails (decisions work, execution does not)`, () => {
      assert.equal(overallStatus(without(id)), "degraded");
      assert.equal(httpStatusFor("degraded"), 503);
    });
  }
  for (const id of ["testnet_cosigner", "testnet_bundler", "agent_model", "webhooks"]) {
    it(`is degraded when non-critical ${id} fails`, () => assert.equal(overallStatus(without(id)), "degraded"));
  }
  it("is down, not degraded, when decisions and execution both fail", () => {
    assert.equal(overallStatus(without("mainnet_bundler", without("database"))), "down");
  });
  it("treats an empty check list as ok only because nothing is required", () => assert.equal(overallStatus([]), "ok"));
});

describe("service state on the status page", () => {
  it("is unknown, never operational, when the health check could not be reached", () => {
    assert.deepEqual(serviceState(null, ["database"]), { state: "unknown", reason: "The health check could not be reached." });
  });
  it("is unknown when no check matches the service", () => assert.equal(serviceState(ALL_OK, ["nope"]).state, "unknown"));
  it("is not running, with the failing check's reason", () => {
    const s = serviceState(without("mainnet_bundler"), ["mainnet_cosigner", "mainnet_bundler"]);
    assert.equal(s.state, "not_running");
    assert.equal(s.reason, "mainnet_bundler is not running");
  });
  it("is operational when at least one live check proves it and none fail", () => {
    assert.equal(serviceState(ALL_OK, ["mainnet_cosigner", "mainnet_bundler"]).state, "operational");
  });
  it("is deployed but unchecked when only configuration was checked", () => {
    assert.equal(serviceState(ALL_OK, ["agent_model"]).state, "unchecked");
  });
});

describe("plain-words reasons", () => {
  it("explains every bundler state and stays silent when reachable", () => {
    assert.equal(bundlerReason("reachable", "Mainnet"), null);
    assert.equal(bundlerReason("network_not_enabled_in_alchemy", "Mainnet"), "Mainnet smart-account transactions can't be submitted: the network is not enabled in Alchemy.");
    for (const s of ["invalid_alchemy_key", "unreachable", "wrong_chain", "entrypoint_missing", "not_configured"]) {
      assert.match(bundlerReason(s, "Testnet") ?? "", /^Testnet smart-account transactions can't be submitted: .+\.$/);
    }
  });
  it("explains co-signer states", () => {
    assert.equal(cosignerReason("configured", "Mainnet"), null);
    assert.match(cosignerReason("not_configured", "Mainnet") ?? "", /key is not set/);
    assert.match(cosignerReason("same_as_testnet", "Mainnet") ?? "", /equals the testnet key/);
  });
});
