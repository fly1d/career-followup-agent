import { expect, test } from "@playwright/test";

test("loads today's follow-up queue", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "今日待跟进" })).toBeVisible();
  await expect(page.getByText("澄屿科技").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "确认发送" }).first()).toBeVisible();
});

test("can confirm a follow-up draft", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "确认发送" }).first().click();

  await expect(page.getByRole("dialog", { name: "确认追问内容" })).toBeVisible();
  await page.getByRole("button", { name: "确认并记录发送" }).click();
  await expect(page.getByText("追问已记录")).toBeVisible();
});

test("switches to opportunity management", async ({ page }) => {
  await page.goto("/");
  const isMobile = (page.viewportSize()?.width ?? 0) < 820;
  const navigation = page.getByRole("navigation", {
    name: isMobile ? "移动导航" : "主要导航",
  });
  await navigation.getByRole("button", { name: "机会", exact: true }).click();

  await expect(page.getByRole("heading", { name: "求职机会" })).toBeVisible();
  await expect(page.getByText("AI 产品经理").first()).toBeVisible();
});
