import React from 'react';
import { Button, Card, Empty, Tag, Typography } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { allScreens } from '../components/navigation';

/**
 * What each unbuilt screen will do, and the nearest thing that exists today.
 *
 * «لسه بتتبني» alone leaves the person with nothing to do next. Half of these have data already in
 * the system reachable from another screen — the serials are on the documents, the expiry lots are
 * in the alerts — so saying only «not yet» sends somebody away from an answer they could have had.
 * The other half genuinely have nothing standing in for them, and say so rather than pointing at
 * something that would waste the trip.
 */
interface Pending {
  /** What the screen will do, in one sentence. */
  what: string;
  /** Where its data can be reached today, where anywhere can. */
  insteadLabel?: string;
  insteadPath?: string;
  /** Why it is not built, where there is a reason worth stating. */
  note?: string;
}

const PENDING: Record<string, Pending> = {
  '/reservations': {
    what: 'حجز كمية من صنف لعميل لمدة محدودة، فتتحجز عن البيع لغيره لحد ما الحجز يتحوّل لفاتورة أو ينتهي.',
    note: 'الحجز بيمسك رصيد من غير ما يبيعه، يعني لازم يدخل في حساب المتاح على كل شاشة بتبيع — مش شاشة لوحدها.',
  },
  '/inventory-count': {
    what: 'جرد مخزن واحد: تطبع كشف بأرصدته، تعدّ على الورق، تدخّل المعدود، والفرق يتقفل بتسوية.',
    insteadLabel: 'جرد حتى تاريخ',
    insteadPath: '/stocktake',
    note: 'اللي عندنا بيقرا الرصيد الدفتري في يوم معيّن؛ اللي ناقص هو دورة العدّ نفسها — كشف، ومعدود، وفرق.',
  },
  '/inventory-count-general': {
    what: 'نفس دورة الجرد بس على كل المخازن مرة واحدة.',
    insteadLabel: 'جرد حتى تاريخ',
    insteadPath: '/stocktake',
  },
  '/price-display': {
    what: 'شاشة سعر للعميل — يتقرا الباركود فيظهر اسم الصنف وسعره على شاشة تانية.',
    note: 'محتاجة شاشة تانية عند الكاشير، مش بس كود.',
  },
};

/**
 * What a menu entry shows before its screen exists.
 *
 * The menu was rebuilt to the shape of the system the client is migrating from, all fifty-seven
 * screens of it, because a half-copied menu teaches the wrong map — someone learns that «السرايل»
 * is missing, and keeps believing it after we add it.
 *
 * So every entry is present and every entry tells the truth. A dead link that silently does nothing
 * is the worst of the options: the person clicking cannot tell it apart from a broken system, and
 * they report it as a bug. This says plainly that the screen is still being built, and names the
 * screen it will mirror so it can be checked against the original when it arrives.
 */
export default function PendingScreen() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const here = pathname + (search || '');
  // Exact match first, across the WHOLE list, before falling back to the path alone. Two entries
  // can share a path and differ only by query — «السرايل» and «حركات سرايل» are both `/serials` —
  // and a single find() with an `||` lets whichever comes first in the menu answer for both, so
  // «حركات سرايل» opened under the title «السرايل».
  const screens = allScreens();
  const screen = screens.find((s) => s.key === here)
    ?? screens.find((s) => s.key.split('?')[0] === pathname);
  const pending = PENDING[here] || PENDING[pathname];

  return (
    <Card>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <div style={{ textAlign: 'center', maxWidth: 520, margin: '0 auto' }}>
            <Typography.Title level={4} style={{ marginBottom: 4 }}>
              {screen?.label || 'شاشة غير معروفة'}
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              الشاشة دي لسه بتتبني. موجودة في المنيو عشان الترتيب يبقى كامل من أول يوم.
            </Typography.Paragraph>
            {pending && (
              <Typography.Paragraph style={{ marginBottom: 8 }}>
                {pending.what}
              </Typography.Paragraph>
            )}
            {pending?.note && (
              <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 8 }}>
                {pending.note}
              </Typography.Paragraph>
            )}
            {pending?.insteadPath && (
              <Typography.Paragraph style={{ marginBottom: 8 }}>
                <Typography.Text type="secondary">لحد ما تتعمل، أقرب حاجة موجودة:</Typography.Text>
                <Button type="link" onClick={() => navigate(pending.insteadPath!)}>
                  {pending.insteadLabel}
                </Button>
              </Typography.Paragraph>
            )}
            {screen?.a5 && (
              <Tag color="blue">تقابل عندهم: {screen.a5}</Tag>
            )}
          </div>
        }
      />
    </Card>
  );
}
