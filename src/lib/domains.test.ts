import { describe, expect, it } from "vitest";

import { isPublicHostname } from "./domains";

describe("public hostname validation", () => {
  it("accepts normal public domains and rejects reserved suffixes", () => {
    expect(isPublicHostname("acme.com")).toBe(true);
    expect(isPublicHostname("foo.local")).toBe(false);
    expect(isPublicHostname("foo.localhost")).toBe(false);
    expect(isPublicHostname("not a domain")).toBe(false);
    expect(isPublicHostname("127.0.0.1")).toBe(false);
    expect(isPublicHostname("0x7f000001")).toBe(false);
  });
});
