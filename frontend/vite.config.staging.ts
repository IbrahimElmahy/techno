// إعداد **البيئة التجريبية** — نفس كود الويب، بس متقدّم من `/staging/`.
//
// البيئة دي بتشتغل على نسخة من قاعدة الإنتاج جنبها على نفس السيرفر، عشان التجربة
// تحصل على داتا حقيقية من غير ما تلمس الشغل الجاري. والفرق الوحيد عن `vite.config.web`
// هو `base`: الأصول بتتقدّم من `/staging/assets/...`، والراوتر بياخد نفس البادئة من
// `import.meta.env.BASE_URL` (شوف `src/App.tsx`).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';

export default defineConfig({
  base: '/staging/',
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: { outDir: 'dist-staging' },
});
