import { randomUUID } from "node:crypto";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const password = "reliable-pass-2026";

function accountFor(testInfo: TestInfo, suffix = "") {
  const unique = `${testInfo.project.name}-${testInfo.workerIndex}-${randomUUID()}${suffix}`;
  return {
    displayName: `测试用户${testInfo.workerIndex}`,
    email: `${unique}@example.com`,
    password,
  };
}

async function registerUnonboarded(page: Page, testInfo: TestInfo, suffix = "") {
  const account = accountFor(testInfo, suffix);
  const response = await page.request.post("/api/auth/register", { data: account });
  expect(response.status()).toBe(201);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "先确认你正在找什么" }),
  ).toBeVisible();
  return account;
}

async function finishOnboarding(page: Page) {
  await page.getByRole("textbox", { name: "目标岗位", exact: true }).fill("AI 产品经理");
  await page.getByRole("textbox", { name: "目标城市", exact: true }).fill("上海");
  await page.getByRole("spinbutton").fill("2");
  await page.getByRole("button", { name: "保存并添加第一个机会" }).click();
  const dialog = page.getByRole("dialog", { name: "添加求职机会" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "关闭" }).click();
  await expect(
    page.getByRole("heading", { name: "添加第一个真实机会" }),
  ).toBeVisible();
}

async function register(page: Page, testInfo: TestInfo, suffix = "") {
  const account = await registerUnonboarded(page, testInfo, suffix);
  await finishOnboarding(page);
  return account;
}

async function createTestOpportunity(page: Page, company = "云帆软件") {
  const response = await page.request.post("/api/opportunities", {
    data: {
      company,
      role: "AI 产品经理",
      location: "上海",
      salary: "30-42K",
    },
  });
  expect(response.status()).toBe(201);
  const created = await response.json();
  await page.reload();
  return created;
}

async function navigate(
  page: Page,
  name: "今日" | "机会" | "冲刺版" | "设置",
) {
  const isMobile = (page.viewportSize()?.width ?? 0) < 820;
  const navigation = page.getByRole("navigation", {
    name: isMobile ? "移动导航" : "主要导航",
  });
  await navigation.getByRole("button", { name, exact: true }).click();
}

test("requires authentication for private APIs", async ({ request }) => {
  const workspace = await request.get("/api/workspace");
  const opportunity = await request.post("/api/opportunities", {
    data: { company: "未授权公司", role: "产品经理" },
  });
  const onboarding = await request.patch("/api/onboarding", {
    data: {
      targetRole: "产品经理",
      targetCity: "上海",
      searchStage: "actively_applying",
      currentOpportunityCount: 0,
    },
  });
  const pilot = await request.post("/api/pilot", {
    data: { contactMethod: "wechat", contactValue: "private", note: "" },
  });
  const operations = await request.get("/api/admin/pilot");

  expect(workspace.status()).toBe(401);
  expect(opportunity.status()).toBe(401);
  expect(onboarding.status()).toBe(401);
  expect(pilot.status()).toBe(401);
  expect(operations.status()).toBe(401);
  await expect(workspace.json()).resolves.toMatchObject({
    error: { code: "authentication_required" },
  });
});

test("submits a pilot request and activates access after admin confirms payment", async ({
  browser,
  page,
}, testInfo) => {
  const applicant = await register(page, testInfo, "-pilot-applicant");
  await navigate(page, "冲刺版");
  await expect(page.getByRole("heading", { name: "求职冲刺版" })).toBeVisible();
  const layout = await page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    headingWidth:
      document.querySelector(".pilot-page h1")?.getBoundingClientRect().width ?? 0,
    actionWidth:
      document.querySelector(".pilot-action-panel")?.getBoundingClientRect().width ?? 0,
    mobileNavWidths: Array.from(
      document.querySelectorAll(".mobile-navigation button"),
    ).map((element) => element.getBoundingClientRect().width),
  }));
  expect(layout.overflowX).toBe(false);
  expect(layout.headingWidth).toBeGreaterThan(160);
  expect(layout.actionWidth).toBeGreaterThan(300);
  if ((page.viewportSize()?.width ?? 0) < 820) {
    expect(layout.mobileNavWidths).toHaveLength(4);
    expect(Math.min(...layout.mobileNavWidths)).toBeGreaterThan(70);
  }
  await page.getByLabel("联系方式").fill(`wx-${testInfo.project.name}`);
  await page.getByLabel("希望优先解决什么（选填）").fill("面试后的追问节奏");
  await page.getByRole("button", { name: "申请 99 元冲刺版" }).click();
  await expect(page.getByRole("heading", { name: "等待人工联系确认" })).toBeVisible();

  const forbidden = await page.request.get("/api/admin/pilot");
  expect(forbidden.status()).toBe(403);

  const adminContext = await browser.newContext({ baseURL: "http://localhost:3100" });
  const adminPage = await adminContext.newPage();
  try {
    const admin = {
      displayName: "测试运营员",
      email: `e2e-admin-${testInfo.project.name}@example.com`,
      password,
    };
    const registration = await adminPage.request.post("/api/auth/register", {
      data: admin,
    });
    expect(registration.status()).toBe(201);
    await adminPage.goto("/admin");
    await expect(
      adminPage.getByRole("heading", { name: "求职冲刺版" }),
    ).toBeVisible();
    const applicantRow = adminPage.locator(".order-row", {
      hasText: applicant.email,
    });
    await expect(applicantRow).toContainText(`wx-${testInfo.project.name}`);
    adminPage.once("dialog", (dialog) => dialog.accept());
    await applicantRow.getByRole("button", { name: "确认收款" }).click();
    await expect(adminPage.getByText("收款已确认，30 天权益已经生效。"))
      .toBeVisible();
    await expect(applicantRow).toContainText("权益生效");
  } finally {
    await adminContext.close();
  }

  await page.reload();
  await navigate(page, "冲刺版");
  await expect(page.getByRole("heading", { name: "冲刺期正在进行" })).toBeVisible();
});

test("registers through the UI and receives a protected session cookie", async ({
  page,
}, testInfo) => {
  const account = accountFor(testInfo);
  await page.goto("/");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("姓名").fill(account.displayName);
  await page.getByLabel("邮箱").fill(account.email);
  await page.getByLabel("密码").fill(account.password);

  const responsePromise = page.waitForResponse("**/api/auth/register");
  await page.getByRole("button", { name: "创建工作区" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const sessionCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "career_session",
  );
  expect(sessionCookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });
  await expect(
    page.getByRole("heading", { name: "先确认你正在找什么" }),
  ).toBeVisible();
  const workspace = await page.request.get("/api/workspace");
  await expect(workspace.json()).resolves.toMatchObject({
    opportunities: [],
    followUps: [],
    onboarding: { completedAt: null },
  });
});

test("persists onboarding and starts with an empty real workspace", async ({
  page,
}, testInfo) => {
  await registerUnonboarded(page, testInfo);
  await finishOnboarding(page);

  const workspace = await page.request.get("/api/workspace");
  await expect(workspace.json()).resolves.toMatchObject({
    opportunities: [],
    followUps: [],
    onboarding: {
      targetRole: "AI 产品经理",
      targetCity: "上海",
      searchStage: "actively_applying",
      currentOpportunityCount: 2,
      completedAt: expect.any(String),
    },
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "添加第一个真实机会" }),
  ).toBeVisible();
});

test("rate limits repeated invalid logins", async ({ page }, testInfo) => {
  const account = await register(page, testInfo, "-rate-limit");
  const attempts = await Promise.all(
    Array.from({ length: 5 }, () =>
      page.request.post("/api/auth/login", {
        data: { email: account.email, password: "wrong-pass-2026" },
      }),
    ),
  );
  expect(attempts.map((response) => response.status())).toEqual([
    401, 401, 401, 401, 401,
  ]);

  const blocked = await page.request.post("/api/auth/login", {
    data: { email: account.email, password: "wrong-pass-2026" },
  });
  expect(blocked.status()).toBe(429);
  expect(Number(blocked.headers()["retry-after"])).toBeGreaterThan(0);
  await expect(blocked.json()).resolves.toMatchObject({
    error: { code: "rate_limited" },
  });
});

test("logs out, logs back in, and keeps the account session across reloads", async ({
  page,
}, testInfo) => {
  const account = await register(page, testInfo);
  if ((page.viewportSize()?.width ?? 0) < 820) {
    await page.getByRole("button", { name: "打开菜单" }).click();
  }
  await page.getByRole("button", { name: new RegExp(account.displayName) }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page.getByRole("heading", { name: "登录工作台" })).toBeVisible();

  await page.getByLabel("邮箱").fill(account.email);
  await page.getByLabel("密码").fill(account.password);
  await page.locator("form").getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "添加第一个真实机会" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "添加第一个真实机会" }),
  ).toBeVisible();
});

test("loads today's follow-up queue", async ({ page }, testInfo) => {
  await register(page, testInfo);
  await createTestOpportunity(page);
  await page.getByRole("button", { name: /已安排/ }).click();
  await expect(page.locator(".follow-up-card").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "确认发送" }).first()).toBeVisible();
});

test("can confirm a follow-up draft", async ({ page }, testInfo) => {
  await register(page, testInfo);
  await createTestOpportunity(page);
  await page.getByRole("button", { name: /已安排/ }).click();
  await page.getByRole("button", { name: "确认发送" }).first().click();

  await expect(page.getByRole("dialog", { name: "确认追问内容" })).toBeVisible();
  await page.getByRole("button", { name: "确认并记录发送" }).click();
  await expect(page.getByText("追问已保存到服务器")).toBeVisible();
});

test("switches to opportunity management", async ({ page }, testInfo) => {
  await register(page, testInfo);
  await createTestOpportunity(page);
  await navigate(page, "机会");

  await expect(page.getByRole("heading", { name: "求职机会" })).toBeVisible();
  await expect(page.getByText("AI 产品经理").first()).toBeVisible();
});

test("persists a new opportunity across reloads", async ({ page }, testInfo) => {
  const company = `烟霞系统-${testInfo.project.name}`;
  await register(page, testInfo);
  await page.getByRole("button", { name: "添加真实机会" }).click();

  const dialog = page.getByRole("dialog", { name: "添加求职机会" });
  await dialog.getByLabel("公司名称").fill(company);
  await dialog.getByLabel("岗位名称").fill("平台产品经理");
  await dialog.getByLabel("薪资范围").fill("30-42K");
  await dialog.getByRole("button", { name: "加入跟进列表" }).click();
  await expect(page.getByText(company)).toBeVisible();

  await page.reload();
  await navigate(page, "机会");
  await expect(page.getByText(company)).toBeVisible();
});

test("persists candidate settings across reloads", async ({ page }, testInfo) => {
  await register(page, testInfo);
  await navigate(page, "设置");

  await page.getByLabel("目标城市").fill("上海、苏州");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByText("设置已保存到服务器")).toBeVisible();

  await page.reload();
  await navigate(page, "设置");
  await expect(page.getByLabel("目标城市")).toHaveValue("上海、苏州");
});

test("keeps account workspaces isolated", async ({ browser, page }, testInfo) => {
  const privateCompany = `仅账号一可见-${testInfo.project.name}`;
  await register(page, testInfo, "-owner");
  const created = await page.request.post("/api/opportunities", {
    data: { company: privateCompany, role: "平台产品经理", location: "上海", salary: "" },
  });
  expect(created.status()).toBe(201);
  const createdRecord = await created.json();

  const secondContext = await browser.newContext({ baseURL: "http://localhost:3100" });
  const secondPage = await secondContext.newPage();
  try {
    await register(secondPage, testInfo, "-member");
    await navigate(secondPage, "机会");
    await expect(secondPage.getByText(privateCompany)).toHaveCount(0);

    const foreignMutation = await secondPage.request.patch(
      `/api/follow-ups/${createdRecord.followUp.id}`,
      { data: { action: "skip" } },
    );
    expect(foreignMutation.status()).toBe(404);
  } finally {
    await secondContext.close();
  }
});
