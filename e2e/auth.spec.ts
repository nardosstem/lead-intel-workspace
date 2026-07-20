import { expect, test } from "@playwright/test";

test.describe("authentication shell", () => {
  test("renders an accessible sign-in form and supports sign-up mode", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "Lead Intel Workspace" })).toBeVisible();
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
    await expect(page.getByLabel("New password", { exact: true })).toHaveAttribute("autocomplete", "new-password");
    await expect(page.getByLabel("Confirm new password", { exact: true })).toHaveAttribute("autocomplete", "new-password");
    await expect(page.getByRole("button", { name: "Update password", exact: true })).toBeVisible();
  });

  test("supports dark mode without losing form contrast or labels", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/login");

    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
  });

  test("redirects unauthenticated users away from the lead workbench", async ({ page }) => {
    await page.goto("/leads");

    await expect(page).toHaveURL(/\/login\?next=(%2F|\/)leads/);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  });
});
