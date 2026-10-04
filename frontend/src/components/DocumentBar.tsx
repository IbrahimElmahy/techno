import React from 'react';
import { Button, Space, Tag, Tooltip } from 'antd';
import { RightOutlined, LeftOutlined } from '@ant-design/icons';

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
  const showPager = onPrev || onNext;
  // المرحلة الحالية بس — ومعاها عدد المراحل في التلميح.
  const now = steps?.find((s) => s.key === current);

  /**
   * **سطر العنوان، مش سطر لوحده** (طلب العميل ٢٠٢٦-٠٩-٣٠: «الجزء اللي فوق واخد نص الصفحة»).
   *
   * كان صف كامل تحت العنوان: «فواتير البيع › SINV-000041» — ورقم المستند مكتوب فوقه
   * بالظبط في العنوان، و«رجوع» جنبه بيعمل نفس اللي بيعمله المسار. وبعده المراحل التلاتة
   * كلها. دلوقتي الشريط بيتحط **جوّه سطر العنوان**: المرحلة الحالية بس، والعدّاد والأسهم.
   * `listLabel`/`listTo`/`title` فاضلين في الواجهة عشان الشاشات اللي بتبعتهم ماتتكسرش.
   */
  void listLabel; void listTo; void title;
  return (
    <Space size={6} style={{ fontWeight: 400 }}>
      {now && (
        <Tooltip title={steps!.map((s) => s.label).join(' ← ')}>
          <Tag color={now.color || 'blue'} style={{ marginInlineEnd: 0 }}>{now.label}</Tag>
        </Tooltip>
      )}
      {extra}
      {showPager && (
        <Space size={0}>
          {/* الاتجاه معكوس عن اللاتيني: في واجهة عربية «السابق» على اليمين. */}
          <Tooltip title="السابق">
            <Button size="small" type="text" icon={<RightOutlined />}
                    disabled={!onPrev} onClick={onPrev} />
          </Tooltip>
          {position != null && total != null && (
            <span style={{ color: '#888', fontSize: 14, minWidth: 48, textAlign: 'center' }}>
              {position} / {total}
            </span>
          )}
          <Tooltip title="التالي">
            <Button size="small" type="text" icon={<LeftOutlined />}
                    disabled={!onNext} onClick={onNext} />
          </Tooltip>
        </Space>
      )}
    </Space>
  );
}
