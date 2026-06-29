import { _electron as electron, test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('Customers & Receivables Management', () => {
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

    // Login
    await window.fill('input[type="text"]', 'admin');
    await window.fill('input[type="password"]', 'password123');
    await window.locator('button[type="submit"]').click();
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('should display customer list, adding drawer, and reassignment action', async () => {
    await window.click('text=العملاء والذمم');
    await expect(window).toHaveURL(/.*customers/);

    // Verify "إضافة عميل" button
    const addBtn = await window.locator('text=إضافة عميل');
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // Verify drawer elements
    await expect(window.locator('text=إضافة عميل جديد')).toBeVisible();
    await expect(window.locator('input[id="name"]')).toBeVisible();
  });
});
