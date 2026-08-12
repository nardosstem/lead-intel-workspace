import { expect, test } from "@playwright/test";

test.describe("authentication shell", () => {
  test("renders an accessible sign-in form and supports sign-up mode", async ({ page }) => {
    const response = await page.goto("/login");

    await expect(page.getByRole("heading", { name: "Lead Intel Workspace" })).toBeVisible();
    expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "email");
    await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "current-password");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "New here? Create an account" }).click();

    await expect(page.getByLabel(/Name/)).toBeVisible();
    await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "new-password");
    await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Already have an account? Sign in" }).click();
    await page.getByRole("button", { name: "Forgot your password?" }).click();
    await expect(page.getByRole("button", { name: "Send reset link", exact: true })).toBeVisible();
    await expect(page.getByLabel("Password")).toHaveCount(0);
  });

  test("renders an accessible password reset form", async ({ page }) => {
    await page.goto("/login/reset-password");

    await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
    await expect(page.getByText("This page needs a valid password-reset link.", { exact: false })).toBeVisible();
    await expect(page.getByLabel("New password", { exact: true })).toHaveAttribute("autocomplete", "new-password");
    await expect(page.getByLabel("Confirm new password", { exact: true })).toHaveAttribute("autocomplete", "new-password");
    await expect(page.getByRole("button", { name: "Update password", exact: true })).toBeDisabled();
  });

  test("fails a direct invitation visit closed without an implicit-flow session", async ({ page }) => {
    await page.goto("/auth/accept-invitation");

    await expect(page.getByRole("heading", { name: "Accept workspace invitation" })).toBeVisible();
    await expect(page.getByText("This invitation link is invalid or expired.", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: "Return to sign in" })).toHaveAttribute("href", "/login");
  });

  test("supports dark mode without losing form contrast or labels", async ({ page }) => {
    const cspViolations: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && /content security policy|violates/i.test(message.text())) {
        cspViolations.push(message.text());
      }
    });

    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/login");

    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    expect(cspViolations).toEqual([]);
  });

  test("redirects unauthenticated users away from the lead workbench", async ({ page }) => {
    await page.goto("/leads");

    await expect(page).toHaveURL(/\/login\?next=(%2F|\/)leads/);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  });

  test("exposes a non-secret deployment health response", async ({ request }) => {
    const response = await request.get("/api/health");
    const health = await response.json();

    if (process.env.E2E_REQUIRE_HEALTH === "1") {
      expect(response.status()).toBe(200);
    } else {
      // Local development may intentionally point at an unavailable staging
      // database. Verify that the endpoint fails closed without requiring
      // external infrastructure for the browser suite itself.
      expect([200, 503]).toContain(response.status());
    }
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(health).toMatchObject({
      status: expect.stringMatching(/^(ok|degraded|unhealthy)$/),
      checks: expect.objectContaining({ database: expect.stringMatching(/^(ok|error)$/) }),
    });
    if (response.status() === 503) {
      expect(health.status).toBe("unhealthy");
      expect(health.checks.database).toBe("error");
    }
  });
});
