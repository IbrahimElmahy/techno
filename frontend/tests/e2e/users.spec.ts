import { _electron as electron, test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('Users and Organization Administration', () => {
  let electronApp: any;
  let window: any;

  test.beforeEach(async () => {
    electronApp = await electron.launch({
      args: [path.join(__dirname, '../../dist-electron/main.js')],
    });
    window = await electronApp.firstWindow();
    await window.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await window.reload();

    // Login first to bypass auth guard
    await window.fill('input[type="text"]', 'admin');
    await window.fill('input[type="password"]', 'password123');
    await window.locator('button[type="submit"]').click();
    await expect(window).toHaveURL(/.*dashboard/);
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('should list users and support user creation modal drawer', async () => {
    // Navigate to users page
    await window.click('text=إدارة المستخدمين');
    await expect(window).toHaveURL(/.*users/);

    // Click "إضافة مستخدم"
    const addBtn = await window.locator('text=إضافة مستخدم');
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // Drawer should open, check form inputs
    const drawerTitle = await window.locator('.ant-drawer-title');
    await expect(drawerTitle).toContainText('إضافة مستخدم جديد');

    const usernameInput = await window.locator('input[id="username"]');
    await expect(usernameInput).toBeVisible();
  });

  test('should load organization tabs and creation dialogs', async () => {
    // Navigate to org page
    await window.click('text=الهيكل التنظيمي');
    await expect(window).toHaveURL(/.*org/);

    // Verify tabs are visible
    await expect(window.locator('text=الفروع')).toBeVisible();
    await expect(window.locator('text=المخازن')).toBeVisible();
    await expect(window.locator('text=العهد')).toBeVisible();
  });
});
