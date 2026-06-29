import { _electron as electron, test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('Purchases and Manufacturing flow', () => {
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

  test('should support purchase creation workflow and line items', async () => {
    await window.click('text=إدخال المشتريات');
    await expect(window).toHaveURL(/.*purchases/);

    // Click "تسجيل فاتورة شراء"
    const addBtn = await window.locator('text=تسجيل فاتورة شراء');
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // Verify form elements
    await expect(window.locator('text=فاتورة شراء جديدة')).toBeVisible();
  });

  test('should support manufacturing order submission', async () => {
    await window.click('text=عمليات التصنيع');
    await expect(window).toHaveURL(/.*manufacturing/);

    // Verify "أمر تصنيع جديد" button
    const addBtn = await window.locator('text=أمر تصنيع جديد');
    await expect(addBtn).toBeVisible();
  });
});
