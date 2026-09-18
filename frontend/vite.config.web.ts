// إعداد الويب — **وهو اللي بيتبني للنشر على السيرفر**، مش للمعاينة بس.
//
// الفرق الوحيد المهم عن `vite.config.ts` هو `base`:
//
// * سطح المكتب (Electron) بيحمّل من `file://`، فالمسار لازم يبقى نسبي (`./`) —
//   المطلق هناك بيدوّر على `/assets` في جذر القرص.
// * والويب بقى على `BrowserRouter` (رابط من غير `#`)، وفيه مسارات من جزئين زي
//   `/customers/3761`. مع `base: './'` الصفحة دي بتحاول تجيب
//   `/customers/assets/index.js` وتطلع بيضا. فالمطلق (`/`) هو الوحيد اللي بيشتغل.
//
// يعني **مافيش بيلد واحد يخدم الاتنين**: `npm run build` للإلكترون،
// و`npm run build:web` للسيرفر.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';

export default defineConfig({
  base: '/',
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { port: 5173, strictPort: true },
});
