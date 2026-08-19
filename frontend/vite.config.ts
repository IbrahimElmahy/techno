import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import * as path from 'path';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    electron([
      {
        // Main process entry
        entry: 'electron/main.ts',
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          // Notify the Renderer-Process to reload the page when the Preload-Script build is complete
          options.reload();
        },
      },
    ]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Vitest and Playwright both look for `*.spec.ts`, and without this vitest picks up the ten
  // end-to-end specs and fails all of them on «test.describe() was not expected here» — so
  // `npm test` has been red regardless of whether anything is actually broken, which is the same
  // as having no test command at all. Playwright runs those through its own config.
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    /*
     * بيئة DOM — عشان يبقى فيه اختبارات بتشغّل الشاشة فعلاً مش بتقرا نصّها.
     *
     * الاختبارات كلها كانت بتفحص شكل الكود: «الدالة دي بتنادي كذا». وده بيمسك حاجات كتير،
     * وبيعمى تماماً عن نوع واحد — الضغطة اللي مابتوديش مكان. حصل مرتين ورا بعض: فتح بيعكس
     * مستند فيقع، وفتح بيملا شاشة ومابيفتحهاش. الاتنين كودهم «صح» والسويت خضرا، والمستخدم هو
     * اللي شافهم.
     *
     * الملفات اللي `.dom.test.tsx` بترسم المكوّن وتضغط عليه بجد. غالية شوية، فمش كل اختبار
     * يبقى كده — بس المسارات اللي بتوصل لضغطة لازم واحد منهم.
     */
    environment: 'jsdom',
    // اختبارات الرسم بتاخد وقت أطول من قراية النص — خمس تواني مش كفاية لشاشة كاملة.
    testTimeout: 20000,
    setupFiles: ['src/test/setup.ts'],
  },
});
