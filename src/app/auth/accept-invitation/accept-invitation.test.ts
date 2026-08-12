import { describe, expect, it } from "vitest";

import { invitationTokensFromHash } from "./accept-invitation";

describe("invitationTokensFromHash", () => {
  it("extracts only the session tokens from a Supabase invitation fragment", () => {
    expect(invitationTokensFromHash("#access_token=access-token&refresh_token=refresh-token&type=invite")).toEqual({
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });
  });

  it("fails closed for direct visits, provider errors, and incomplete fragments", () => {
    expect(invitationTokensFromHash("")).toBeNull();
    expect(invitationTokensFromHash("#error=access_denied")).toBeNull();
    expect(invitationTokensFromHash("#access_token=access-token")).toBeNull();
  });
});
