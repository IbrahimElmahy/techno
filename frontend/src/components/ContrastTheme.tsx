import React, { createContext, useContext, useLayoutEffect, useMemo, useState } from 'react';
import { Button, Switch, Tooltip } from 'antd';
import type { ThemeConfig } from 'antd';
import { EyeOutlined } from '@ant-design/icons';

/**
 * **«ألوان واضحة / خط أكبر»** — شكل تاني للنظام كله، بيختاره اللي محتاجه بس.
 *
 * طلب العميل (٢٠٢٦-١٠-٠٦): فيه ناس نظرها ضعيف، وناس عينها بتتعب من الألوان الحالية —
 * الأخضر الفاتح والرمادي الفاتح وخطوط الجدول اللي بالعافية بتبان. والباقيين متعوّدين على
 * الشكل الحالي وشغّالين عليه، فده **اختيار مش فرض**: الافتراضي زي ما هو، واللي عايز
 * يقلب يقلب من زرار العين فوق أو من قايمة المستخدم.
 *
 * نفس طريقة ارتفاع الصف (`RowDensity.tsx`): كلاس واحد على `<html>` والـCSS في
 * `theme-hc.css` بيعمل الباقي، عشان الـ١٧٠+ جدول وكل شاشة اتكتبت أو هتتكتب تمشي وراه من
 * غير ما حد يعدّلها. وجنبه توكنز antd (`HC_THEME`) لأن antd بترسم البوبابات والقوايم
 * والتنبيهات من التوكنز، ودي مالهاش كلاس نمسكه من CSS.
 *
 * محفوظ في `localStorage` على الجهاز — اللي نظره ضعيف بيختاره مرة، مش كل صبح.
 */

export type UiTheme = 'default' | 'hc';

const STORAGE_KEY = 'ui.theme';
const HTML_CLASS = 'theme-hc';

function stored(): UiTheme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'hc' ? 'hc' : 'default';
  } catch { /* وضع خاص — الافتراضي */ }
  return 'default';
}

interface Ctx { theme: UiTheme; setTheme: (t: UiTheme) => void; toggle: () => void; }

const UiThemeContext = createContext<Ctx>({
  theme: 'default', setTheme: () => {}, toggle: () => {},
});

export function useUiTheme() { return useContext(UiThemeContext); }

/**
 * الحالة نفسها — بتتنادى من `App` لأن `App` هو اللي بيرسم `ConfigProvider`، والتوكنز لازم
 * تتغيّر في نفس الرندر اللي الكلاس اتحط فيه، وإلا الشاشة بتترسم مرة بنص شكل.
 */
export function useUiThemeState(): Ctx {
  const [theme, setTheme] = useState<UiTheme>(stored);

  // Layout مش عادي: الكلاس لازم يتحط قبل ما المتصفح يرسم، وإلا أول فتحة بتومض بالشكل القديم.
  useLayoutEffect(() => {
    document.documentElement.classList.toggle(HTML_CLASS, theme === 'hc');
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* مش مستاهلة نوقع عشانها */ }
  }, [theme]);

  return useMemo(() => ({
    theme,
    setTheme,
    toggle: () => setTheme((t) => (t === 'hc' ? 'default' : 'hc')),
  }), [theme]);
}

export function UiThemeProvider({ value, children }: { value: Ctx; children: React.ReactNode }) {
  return <UiThemeContext.Provider value={value}>{children}</UiThemeContext.Provider>;
}

/**
 * توكنز antd للشكل الواضح — بتتدمج **فوق** التوكنز العادية في `App.tsx`.
 *
 * الأرقام مختارة بنسبة التباين (WCAG) مش بالعين:
 * - الأخضر الأساسي `#356F18` = ٦٫١ : ١ على الأبيض (الحالي `#6AB42D` = ٢٫٦ : ١، أقل من
 *   الحد الأدنى ٤٫٥ للكلام). الكلام الأبيض على الزرار الأخضر بيعدّي بنفس النسبة.
 * - خطوط الشبكة `#737373` = ٤٫٧ : ١ (الحالية `#e4ebe1` تقريباً ١٫٢ : ١ — بتختفي على
 *   شاشة إضاءتها عالية أو عين تعبانة).
 * - البرتقالي والأحمر والأخضر بتوع الحالات اتغمّقوا لنفس السبب: كلام برتقالي فاتح على
 *   أبيض (٢ : ١) مابيتقريش.
 */
export const HC_THEME: ThemeConfig = {
  token: {
    colorPrimary: '#356F18',
    colorInfo: '#356F18',
    colorLink: '#1f4f8f',
    colorSuccess: '#2F6B12',
    colorWarning: '#9a5600',
    colorError: '#b3141a',
    // الخلفيات الفاتحة بتاعة الحالات (التاجات والتنبيهات) بالصريح: antd بتشتقها من اللون
    // الأساسي، ومن أخضر غامق زي ده بيطلع رمادي باهت — «معتمد» كان بيبان زي «ملغي».
    colorPrimaryBg: '#e3efdb',
    colorPrimaryBgHover: '#d3e7c6',
    colorInfoBg: '#e3efdb',
    colorInfoBorder: '#6f9a55',
    colorSuccessBg: '#dff2d2',
    colorSuccessBorder: '#5c9a3a',
    colorWarningBg: '#fff0d4',
    colorWarningBorder: '#c98a2b',
    colorErrorBg: '#fde3e3',
    colorErrorBorder: '#d9686b',
    fontSize: 18,
    fontSizeSM: 16,
    fontSizeLG: 20,
    colorText: '#000000',
    colorTextSecondary: '#1a1a1a',
    colorTextTertiary: '#262626',
    colorTextDescription: '#262626',
    colorTextPlaceholder: '#595959',
    colorTextDisabled: '#3d3d3d',
    colorBgContainerDisabled: '#ececec',
    colorBorder: '#595959',
    colorBorderSecondary: '#8c8c8c',
    colorSplit: '#8c8c8c',
    controlHeight: 38,
    controlHeightSM: 32,
    controlHeightLG: 44,
    controlOutlineWidth: 3,
    lineWidthFocus: 3,
    lineHeight: 1.6,
  },
  components: {
    Table: {
      headerBg: '#d6dfd2',
      headerColor: '#000000',
      headerSplitColor: '#595959',
      borderColor: '#737373',
      rowHoverBg: '#e3efdb',
      rowSelectedBg: '#c9e4b3',
      rowSelectedHoverBg: '#bcdca2',
      cellFontSize: 17,
      cellFontSizeMD: 17,
      cellFontSizeSM: 17,
    },
    Menu: {
      itemColor: '#000000',
      horizontalItemSelectedColor: '#356F18',
    },
    Tag: {
      defaultColor: '#000000',
    },
  },
};

/** زرار العين في الشريط العلوي — مكان ظاهر، عشان اللي محتاجه يلاقيه من غير ما يدوّر. */
export function ContrastHeaderButton() {
  const { theme, toggle } = useUiTheme();
  const on = theme === 'hc';
  return (
    <Tooltip title={on ? 'رجوع للألوان العادية' : 'ألوان واضحة / خط أكبر'}>
      <Button
        type={on ? 'primary' : 'default'}
        shape="circle"
        icon={<EyeOutlined />}
        onClick={toggle}
        aria-pressed={on}
        aria-label="ألوان واضحة / خط أكبر"
      />
    </Tooltip>
  );
}

/** المفتاح جوّه قايمة المستخدم — جنب ارتفاع الصف وشكل الأرقام، بالاسم كامل. */
export default function ContrastToggle() {
  const { theme, setTheme } = useUiTheme();
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
      <Switch checked={theme === 'hc'} onChange={(v) => setTheme(v ? 'hc' : 'default')} />
      <span>ألوان واضحة / خط أكبر</span>
    </label>
  );
}
