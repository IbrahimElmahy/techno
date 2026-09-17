import React from 'react';
import { Button, Space, Tag, Tooltip } from 'antd';
import { RightOutlined, LeftOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

/**
 * شريط المستند — المسار، والمكان في السجل، والحالة. زي ترويسة الفورم في أودو.
 *
 * المستند عندنا كان بيتفتح وانت مش عارف تلات حاجات: انت جاي منين، وده رقم كام من
 * كام، وهو واقف في أنهي مرحلة. التلاتة موجودين في النظام وماحدش كان بيعرضهم في
 * مكان واحد.
 *
 * * **المسار** بيرجّعك للسجل بضغطة، وبيقول اسم السجل اللي انت فيه — التبويبات
 *   بتخلّي أربع شاشات مفتوحة مع بعض، والعنوان لوحده مابيقولش انت في أنهي واحدة.
 * * **العدّاد** — «٤٢ / ٥٧». السهم لوحده بيمشي وانت مش عارف فاضل كام ولا انت فين،
 *   فاللي بيراجع فواتير الشهر بيفضل يضغط لحد ما السهم يقف. الرقم بيقول خلاص.
 * * **شريط الحالة** بيرسم المراحل كلها والحالية مميّزة، مش الحالية وبس: اللي شايف
 *   «مرحّل» بس مايعرفش إن فيه «ملغي» بعدها، ولا إن «مسودة» كانت قبلها.
 *
 * الأسهم بتاخد دوالها من الشاشة، فهي بتمشي على **نفس الترتيب المفلتر** اللي
 * المستخدم شايفه — مش على ترتيب القاعدة. لو فلتر على عميل، الأسهم بتمشي على
 * فواتير العميل ده وبس، وده اللي بيخلّي «التالي» يعني حاجة.
 */

export interface DocumentStep {
  key: string;
  label: string;
  /** لون الشريحة لما تكون هي الحالية. */
  color?: string;
}

export default function DocumentBar({
  listLabel, listTo, title, position, total, onPrev, onNext, steps, current, extra,
}: {
  /** اسم السجل اللي المستند جاي منه — «فواتير البيع». */
  listLabel: string;
  /** مسار الرجوع للسجل. لو مش متبعت، المسار بيبقى نص مش زرار. */
  listTo?: string;
  /** رقم المستند أو عنوانه. */
  title: string;
  /** ترتيبه في السجل (١-based) وعدد السجل — الاتنين أو ولا واحد. */
  position?: number | null;
  total?: number | null;
  onPrev?: () => void;
  onNext?: () => void;
  steps?: DocumentStep[];
  current?: string | null;
  extra?: React.ReactNode;
}) {
  const navigate = useNavigate();
  const showPager = onPrev || onNext;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      padding: '6px 0 10px', borderBottom: '1px solid rgba(0,0,0,.06)', marginBottom: 12,
    }}>
      <Space size={4} style={{ flex: '1 1 auto', minWidth: 200 }}>
        {listTo ? (
          <Button type="link" style={{ padding: 0 }} onClick={() => navigate(listTo)}>
            {listLabel}
          </Button>
        ) : <span style={{ color: '#888' }}>{listLabel}</span>}
        <span style={{ color: '#bbb' }}>›</span>
        <b>{title}</b>
      </Space>

      {steps && steps.length > 0 && (
        <Space size={4}>
          {steps.map((s) => (
            <Tag
              key={s.key}
              color={s.key === current ? (s.color || 'blue') : 'default'}
              style={{ marginInlineEnd: 0, opacity: s.key === current ? 1 : 0.5 }}
            >
              {s.label}
            </Tag>
          ))}
        </Space>
      )}

      {extra}

      {showPager && (
        <Space size={2}>
          {/* الاتجاه معكوس عن اللاتيني: في واجهة عربية «السابق» على اليمين. */}
          <Tooltip title="السابق">
            <Button size="small" type="text" icon={<RightOutlined />}
                    disabled={!onPrev} onClick={onPrev} />
          </Tooltip>
          {position != null && total != null && (
            <span style={{ color: '#888', fontSize: 13, minWidth: 54, textAlign: 'center' }}>
              {position} / {total}
            </span>
          )}
          <Tooltip title="التالي">
            <Button size="small" type="text" icon={<LeftOutlined />}
                    disabled={!onNext} onClick={onNext} />
          </Tooltip>
        </Space>
      )}
    </div>
  );
}
