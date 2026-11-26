import { describe, expect, it } from "vitest";
import { vercelChanges, vercelPath } from "../src/hosting-lib";

describe("hosting", () => {
  it("sets every site variable and removes only an emptied lock", () => {
    const remote = [
      { id: "1", key: "SITE_ACCESS_KEY" },
      { id: "2", key: "DATABASE_URL" },
      { id: "3", key: "SOMETHING_ELSE" },
    ];
    const locked = vercelChanges({ RPC_URL: "r", SITE_ACCESS_KEY: "k" }, remote);
    expect(locked.set).toEqual(["RPC_URL", "SITE_ACCESS_KEY"]);
    expect(locked.remove).toEqual([]);
    const open = vercelChanges({ RPC_URL: "r", DATABASE_URL: "d" }, remote);
    expect(open.set).toEqual(["DATABASE_URL", "RPC_URL"]);
    expect(open.remove.map((r) => r.key)).toEqual(["SITE_ACCESS_KEY"]);
  });

  it("adds the team to API paths", () => {
    expect(vercelPath("/v9/projects/lotz", undefined)).toBe("/v9/projects/lotz");
    expect(vercelPath("/v9/projects/lotz", "my team")).toBe("/v9/projects/lotz?slug=my%20team");
    expect(vercelPath("/v10/projects/x/env?upsert=true", "t")).toBe("/v10/projects/x/env?upsert=true&slug=t");
  });
});
