import React, { createContext, useContext, useLayoutEffect, useMemo, useState } from 'react';
import { Button, Switch, Tooltip } from 'antd';
import type { ThemeConfig } from 'antd';
import { EyeOutlined } from '@ant-design/icons';

export type UiTheme = 'default' | 'hc';

const STORAGE_KEY = 'ui.theme';
const HTML_CLASS = 'theme-hc';

function stored(): UiTheme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'hc' ? 'hc' : 'default';
  } catch {}
  return 'default';
}

interface Ctx { theme: UiTheme; setTheme: (t: UiTheme) => void; toggle: () => void; }

const UiThemeContext = createContext<Ctx>({
  theme: 'default', setTheme: () => {}, toggle: () => {},
});

export function useUiTheme() { return useContext(UiThemeContext); }

export function useUiThemeState(): Ctx {
  const [theme, setTheme] = useState<UiTheme>(stored);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle(HTML_CLASS, theme === 'hc');
    try { localStorage.setItem(STORAGE_KEY, theme); } catch {}
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

export const HC_THEME: ThemeConfig = {
  token: {
    colorPrimary: '#356F18',
    colorInfo: '#356F18',
    colorLink: '#1f4f8f',
    colorSuccess: '#2F6B12',
    colorWarning: '#9a5600',
    colorError: '#b3141a',
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

export default function ContrastToggle() {
  const { theme, setTheme } = useUiTheme();
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
      <Switch checked={theme === 'hc'} onChange={(v) => setTheme(v ? 'hc' : 'default')} />
      <span>ألوان واضحة / خط أكبر</span>
    </label>
  );
}
