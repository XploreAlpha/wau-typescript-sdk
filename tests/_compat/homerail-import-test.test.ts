/**
 * Test homerail-style import: wau-sdk root entry + wau-sdk/wau subpath
 */
import { describe, it, expect } from "vitest";

describe("homerail import compat (per SDK Consumer Contract §三)", () => {
  it("imports from 'wau-sdk' root entry", async () => {
    const sdk = await import("../wau-typescript-sdk/dist/index.js");
    expect(typeof sdk.WauClient).toBe("function");
    expect(typeof sdk.WauWorkflowError).toBe("function");
    expect(sdk.WAU_DEFAULT_USER_AGENT).toBe("wau-typescript-sdk/wau/v1.3.1");
  });

  it("imports from 'wau-sdk/wau' subpath", async () => {
    const wau = await import("../wau-typescript-sdk/dist/wau/index.js");
    expect(typeof wau.WauClient).toBe("function");
    expect(typeof wau.WauWorkflowError).toBe("function");
  });

  it("constructs WauClient with sample config", async () => {
    const sdk = await import("../wau-typescript-sdk/dist/index.js");
    const cli = new sdk.WauClient({
      registry_url: "http://localhost:18401",
      intent_url: "http://localhost:18402",
      edge_url: "http://localhost:18403",
      heartbeat_interval_ms: 30000,
      dag_patterns_path: "p",
      system_capability: {
        category: "USER_ENTRY",
        sub_capabilities: [],
        trust_exempt: true,
      },
    });
    expect(cli).toBeInstanceOf(sdk.WauClient);
  });
});
