/**
 * تجهيز بيئة الرسم للاختبارات.
 *
 * antd بتسأل المتصفح عن حاجات مالهاش وجود في jsdom — `matchMedia` للـresponsive، و
 * `ResizeObserver` للجداول والقوايم. من غيرهم أي مكوّن فيه `<Table>` بيرمي قبل ما يرسم،
 * فالاختبار بيفشل لسبب مالوش علاقة باللي بيتقاس.
 */
import '@testing-library/jest-dom/vitest';

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as any;
}

if (!(globalThis as any).ResizeObserver) {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom مافيهوش `scrollIntoView`، والقوايم اللي بتتنقّل بالكيبورد بتناديه.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
