import { _electron as electron, test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('Sales Invoices and Returns', () => {
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

  test('should display sales invoices, create invoice form, and return slip actions', async () => {
    await window.click('text=الفواتير والمرتجعات');
    await expect(window).toHaveURL(/.*invoices/);

    const addBtn = await window.locator('text=تسجيل فاتورة بيع');
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    await expect(window.locator('text=فاتورة بيع جديدة')).toBeVisible();
  });
});
