import { expect, test, type Page } from "@playwright/test";

async function navigate(page: Page, name: "今日" | "机会" | "设置") {
  const isMobile = (page.viewportSize()?.width ?? 0) < 820;
  const navigation = page.getByRole("navigation", {
    name: isMobile ? "移动导航" : "主要导航",
  });
  await navigation.getByRole("button", { name, exact: true }).click();
}

async function waitForServer(page: Page) {
  await expect(page.getByText("本地服务端已同步")).toBeVisible();
}

test("loads today's follow-up queue", async ({ page }) => {
  await page.goto("/");
  await waitForServer(page);

  await expect(page.getByRole("heading", { name: "今日待跟进" })).toBeVisible();
  await expect(page.locator(".follow-up-card").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "确认发送" }).first()).toBeVisible();
});

test("can confirm a follow-up draft", async ({ page }) => {
  await page.goto("/");
  await waitForServer(page);
  await page.getByRole("button", { name: "确认发送" }).first().click();

  await expect(page.getByRole("dialog", { name: "确认追问内容" })).toBeVisible();
  await page.getByRole("button", { name: "确认并记录发送" }).click();
  await expect(page.getByText("追问已保存到服务器")).toBeVisible();
});

test("switches to opportunity management", async ({ page }) => {
  await page.goto("/");
  await waitForServer(page);
  await navigate(page, "机会");

  await expect(page.getByRole("heading", { name: "求职机会" })).toBeVisible();
  await expect(page.getByText("AI 产品经理").first()).toBeVisible();
});

test("persists a new opportunity across reloads", async ({ page }, testInfo) => {
  const company = `烟霞系统-${testInfo.project.name}`;
  await page.goto("/");
  await waitForServer(page);
  await page.getByRole("button", { name: "添加机会" }).first().click();

  const dialog = page.getByRole("dialog", { name: "添加求职机会" });
  await dialog.getByLabel("公司名称").fill(company);
  await dialog.getByLabel("岗位名称").fill("平台产品经理");
  await dialog.getByLabel("薪资范围").fill("30-42K");
  await dialog.getByRole("button", { name: "加入跟进列表" }).click();
  await expect(page.getByText(company)).toBeVisible();

  await page.reload();
  await waitForServer(page);
  await navigate(page, "机会");
  await expect(page.getByText(company)).toBeVisible();
});

test("persists candidate settings across reloads", async ({ page }) => {
  await page.goto("/");
  await waitForServer(page);
  await navigate(page, "设置");

  await page.getByLabel("目标城市").fill("上海、苏州");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByText("设置已保存到服务器")).toBeVisible();

  await page.reload();
  await waitForServer(page);
  await navigate(page, "设置");
  await expect(page.getByLabel("目标城市")).toHaveValue("上海、苏州");
});
