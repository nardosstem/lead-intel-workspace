import { expect, test } from "@playwright/test";

const e2eEmail = process.env.E2E_TEST_EMAIL;
const e2ePassword = process.env.E2E_TEST_PASSWORD;

test.describe("authenticated lead workbench", () => {
  test.skip(
    !e2eEmail || !e2ePassword,
    "Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD for authenticated staging coverage.",
  );

  test.beforeEach(async ({ page }) => {
    await page.goto("/login?next=%2Fleads");
    await page.getByLabel("Email").fill(e2eEmail!);
    await page.getByLabel("Password").fill(e2ePassword!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/leads(?:\?|$)/);
  });

  test("renders searchable lead views and settings navigation", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Companies", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Contacts", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Companies", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Companies" })).toBeVisible();
    await expect(page.getByLabel("Search companies…")).toBeVisible();

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("Members and access")).toBeVisible();
  });
});
