import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

const TARGETS = '.sale-grid-wrap';
const BAR = 12;
const MIN_VISIBLE = 60;

interface Box { left: number; top: number; width: number; inner: number; dir: string; z: number }

function scrollParent(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement;
  while (p) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return p;
    p = p.parentElement;
  }
  return null;
}

function same(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return a === b;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.inner === b.inner
    && a.dir === b.dir && a.z === b.z;
}

function pick(): { el: HTMLElement; box: Box } | null {
  const dialogs = [...document.querySelectorAll<HTMLElement>('.ant-modal-wrap, .ant-drawer-content-wrapper')]
    .filter((d) => getComputedStyle(d).display !== 'none' && d.getClientRects().length > 0);
  for (const el of document.querySelectorAll<HTMLElement>(TARGETS)) {
    if (el.offsetParent === null) continue;
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    if (dialogs.length && !dialogs.some((d) => d.contains(el))) continue;
    const r = el.getBoundingClientRect();
    const parent = scrollParent(el);
    const pr = parent ? parent.getBoundingClientRect() : null;
    let bottom = Math.min(pr ? pr.bottom : window.innerHeight, window.innerHeight);
    const top = Math.max(pr ? pr.top : 0, 0);
    const doc = el.closest('.sale-doc');
    const stuck = doc?.querySelector<HTMLElement>('.sale-bottom');
    if (stuck && stuck.offsetParent !== null) {
      const sr = stuck.getBoundingClientRect();
      if (sr.height > 0 && sr.top < bottom) bottom = sr.top;
    }
    if (r.bottom <= bottom) continue;
    if (r.top > bottom - MIN_VISIBLE || r.bottom < top + MIN_VISIBLE) continue;
    const left = Math.round(r.left + el.clientLeft);
    return {
      el,
      box: {
        left, top: Math.round(bottom - BAR), width: el.clientWidth, inner: el.scrollWidth,
        dir: getComputedStyle(el).direction,
        z: dialogs.length ? 1100 : 30,
      },
    };
  }
  return null;
}

export default function HScrollDock() {
  const barRef = useRef<HTMLDivElement>(null);
  const target = useRef<HTMLElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const boxRef = useRef<Box | null>(null);

  useEffect(() => {
    let timer = 0;
    const measure = () => {
      timer = 0;
      const found = pick();
      target.current = found?.el ?? null;
      const next = found?.box ?? null;
      if (!same(boxRef.current, next)) { boxRef.current = next; setBox(next); }
      const bar = barRef.current;
      if (found && bar && Math.abs(bar.scrollLeft - found.el.scrollLeft) > 1) {
        bar.scrollLeft = found.el.scrollLeft;
      }
    };
    const schedule = () => { if (!timer) timer = window.setTimeout(measure, 16); };
    document.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    const iv = window.setInterval(schedule, 400);
    schedule();
    return () => {
      document.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      window.clearInterval(iv);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (bar && target.current) bar.scrollLeft = target.current.scrollLeft;
  }, [box]);

  if (!box) return null;
  return (
    <div
      ref={barRef}
      className="hscroll-dock"
      onScroll={(e) => {
        const t = target.current;
        const x = (e.currentTarget as HTMLDivElement).scrollLeft;
        if (t && Math.abs(t.scrollLeft - x) > 1) t.scrollLeft = x;
      }}
      style={{
        position: 'fixed', left: box.left, top: box.top, width: box.width, height: BAR,
        direction: box.dir as React.CSSProperties['direction'],
        overflowX: 'scroll', overflowY: 'hidden', zIndex: box.z,
      }}
    >
      <div style={{ width: box.inner, height: 1 }} />
    </div>
  );
}
