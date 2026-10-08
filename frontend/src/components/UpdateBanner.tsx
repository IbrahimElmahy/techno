import React, { useEffect, useState } from 'react';
import { Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const ENTRY = /assets\/index-[\w-]+\.js/;

function runningEntry(): string | null {
  const el = document.querySelector('script[type="module"][src*="/assets/index-"]');
  const m = el?.getAttribute('src')?.match(ENTRY);
  return m ? m[0] : null;
}

async function latestEntry(): Promise<string | null> {
  try {
    const r = await fetch(`${BASE}/index.html?v=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const m = (await r.text()).match(ENTRY);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

export default function UpdateBanner() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const running = runningEntry();
    if (!running) return undefined;
    let stop = false;
    const check = async () => {
      if (stop) return;
      const latest = await latestEntry();
      if (!latest || latest === running) return;
      if (document.hidden) { window.location.reload(); return; }
      setReady(true);
    };
    const onVisible = () => { if (!document.hidden) check(); };
    const onPreloadError = (e: Event) => { e.preventDefault(); window.location.reload(); };
    const timer = window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('vite:preloadError', onPreloadError);
    return () => {
      stop = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('vite:preloadError', onPreloadError);
    };
  }, []);

  if (!ready) return null;
  return (
    <div style={{
      position: 'fixed', top: 0, insetInline: 0, zIndex: 2000, background: '#6AB42D',
      color: '#fff', padding: '6px 16px', display: 'flex', alignItems: 'center',
      justifyContent: 'center', gap: 12, fontWeight: 700, boxShadow: '0 2px 6px rgba(0,0,0,.15)',
    }}>
      فيه تحديث جديد للنظام — احفظ اللي بتكتبه ودوس «حدّث»
      <Button size="small" icon={<ReloadOutlined />} onClick={() => window.location.reload()}>
        حدّث
      </Button>
    </div>
  );
}
