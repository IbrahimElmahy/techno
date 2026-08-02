import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Button, Card, Space, Tag } from 'antd';
import { ExpandOutlined, TagOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { TabActiveContext } from '../components/keyboard';

/**
 * شاشة معلومات المنتج — the screen that faces the customer.
 *
 * Enter an item code, the item's name and price appear in type readable from the other side of a
 * desk. The «second screen» this needs is a place to put a browser window, not a reason for the
 * software not to exist — so it is a full-bleed page with a fullscreen button, and it runs on
 * whatever the counter has.
 *
 * Theirs scans a barcode. Ours takes the item code, because the client asked for barcodes out of
 * this system entirely — a deliberate divergence from a5, not a gap. A scanner configured to emit
 * the item code still works: to this screen it is a keyboard.
 *
 * **No visible input.** Whatever types the code — a person or a scanner — ends with Enter, and a
 * text box on a customer-facing screen is an invitation for a customer to type in it. Keystrokes
 * are collected at the window instead, so the screen shows only the answer.
 *
 * **The price is the one the invoice will bill** — the server builds it by the same steps a sale
 * line uses. A display that disagrees with the till is worse than no display: the customer has
 * already read a number and now has to be argued out of it.
 */

interface Shown {
  item_id: number; code: string; name: string; unit: string | null;
  unit_price: string; discount_pct: string; price_after_discount: string;
  vat_pct: string; price_with_vat: string;
  in_stock: boolean; on_hand: string;
}

const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/** How long an answer stays up before the screen goes back to «اكتب كود الصنف». */
const CLEAR_AFTER_MS = 20000;

export default function PriceDisplay() {
  // The workspace keeps every open tab mounted, so a window-level listener here would keep
  // collecting keystrokes while somebody works on another screen — firing lookups they did not
  // ask for and leaving a stale item waiting when they come back to this one.
  const onScreen = useContext(TabActiveContext);
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bufferRef = useRef('');
  const clearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const armClear = useCallback(() => {
    if (clearRef.current) clearTimeout(clearRef.current);
    // Left up forever, the last customer's price is still on the screen when the next one walks
    // up — and they will read it as theirs.
    clearRef.current = setTimeout(() => { setShown(null); setError(null); }, CLEAR_AFTER_MS);
  }, []);

  const lookup = useCallback(async (code: string) => {
    setBusy(true);
    try {
      const res = await api.get('/api/v1/price-display/lookup', { params: { code } });
      setShown(res.data); setError(null);
    } catch (err: any) {
      setShown(null);
      setError(err?.response?.data?.detail?.message || 'الكود ده مش معروف');
    } finally {
      setBusy(false);
      armClear();
    }
  }, [armClear]);

  useEffect(() => {
    if (!onScreen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      // Never steal typing from a real field — this page has none, but the workspace keeps other
      // tabs mounted and one of them may.
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        return;
      }
      if (e.key === 'Enter') {
        const code = bufferRef.current.trim();
        bufferRef.current = '';
        if (code) lookup(code);
        return;
      }
      // A scanner sends printable characters one at a time; anything else is not part of a code.
      if (e.key.length === 1) bufferRef.current += e.key;
      if (e.key === 'Escape') { bufferRef.current = ''; setShown(null); setError(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (clearRef.current) clearTimeout(clearRef.current);
    };
  }, [lookup, onScreen]);

  const goFullscreen = () => {
    const node = rootRef.current;
    if (!node) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else node.requestFullscreen?.();
  };

  return (
    <Card
      title={<span><TagOutlined /> شاشة معلومات المنتج</span>}
      extra={
        <Space>
          <Tag color="blue">اكتب كود الصنف واضغط Enter</Tag>
          <Button icon={<ExpandOutlined />} onClick={goFullscreen}>ملء الشاشة</Button>
        </Space>
      }
      styles={{ body: { padding: 0 } }}
    >
      <div
        ref={rootRef}
        style={{
          background: '#0f1419', color: '#fff', minHeight: '60vh',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 32, textAlign: 'center',
        }}
      >
        {busy ? (
          <div style={{ fontSize: 40, opacity: 0.6 }}>لحظة…</div>
        ) : error ? (
          <div>
            <div style={{ fontSize: 64, marginBottom: 12 }}>؟</div>
            <div style={{ fontSize: 40, color: '#ff7875' }}>{error}</div>
          </div>
        ) : shown ? (
          <div style={{ width: '100%', maxWidth: 900 }}>
            <div style={{
              fontSize: 'clamp(28px, 5vw, 56px)', fontWeight: 600, lineHeight: 1.3,
              marginBottom: 8,
            }}>
              {shown.name}
            </div>
            <div style={{ fontSize: 22, opacity: 0.55, marginBottom: 28 }}>
              {shown.code}{shown.unit ? ` · ${shown.unit}` : ''}
            </div>

            <div style={{
              fontSize: 'clamp(64px, 14vw, 160px)', fontWeight: 700, lineHeight: 1,
              color: '#6AB42D',
            }}>
              {money(shown.price_with_vat)}
              <span style={{ fontSize: '0.32em', marginInlineStart: 12, opacity: 0.8 }}>ج.م</span>
            </div>

            {/* The breakdown, small. A customer asking «why that much?» is answered here rather
                than by somebody opening the invoice screen in front of them. */}
            <div style={{ fontSize: 20, opacity: 0.65, marginTop: 20 }}>
              {Number(shown.discount_pct) > 0 && (
                <span style={{ marginInlineEnd: 18 }}>
                  قبل الخصم {money(shown.unit_price)} · خصم {Number(shown.discount_pct)}%
                </span>
              )}
              {Number(shown.vat_pct) > 0 && (
                <span>شامل ض.م {Number(shown.vat_pct)}%</span>
              )}
            </div>

            <div style={{ marginTop: 28 }}>
              {shown.in_stock ? (
                <Tag color="green" style={{ fontSize: 22, padding: '6px 18px' }}>
                  متوفر ({Number(shown.on_hand)})
                </Tag>
              ) : (
                <Tag color="red" style={{ fontSize: 22, padding: '6px 18px' }}>غير متوفر</Tag>
              )}
            </div>
          </div>
        ) : (
          <div style={{ opacity: 0.5 }}>
            <TagOutlined style={{ fontSize: 96, marginBottom: 20 }} />
            <div style={{ fontSize: 'clamp(28px, 4vw, 44px)' }}>اكتب كود الصنف</div>
          </div>
        )}
      </div>
    </Card>
  );
}
