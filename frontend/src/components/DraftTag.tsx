import React from 'react';
import { Button, Space, Tag, message } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';

/**
 * علامة «مسودّة» على سطر الكشف — **ومعاها الحذف**.
 *
 * المسودّة كانت بتتفتح بالضغط عليها وبس. اللي كتب واحدة بالغلط، أو خلّص شغله
 * بطريقة تانية، ما كانش قدامه غير إنه يفتحها ويفضّيها بإيده — ولو سابها بتفضل فوق
 * الكشف للأبد بين المستندات الحقيقية. `useDraft` كان مصدّر `remove` من الأول
 * ومحدش بيستعملها في أي شاشة.
 *
 * **والزرار مكتوب عليه، مش أيقونة لوحدها.**
 *
 * كان أيقونة سلّة ١٥×١٥ بيكسل جوّه خلية، والسطر كله بيفتح المسودّة لما يتضغط. يعني
 * الهدف الصح ربع سنتيمتر، واللي حواليه كله بيعمل حاجة تانية: أي ضغطة قريبة بتفتح
 * المسودّة بدل ما تمسحها. على لوحة لمس ده بيفشل كل شوية، واللي بيحصل إن اللي
 * بيحاول يمسح بيلاقي نفسه جوّه الشاشة كل مرة ويقول «مش عارف أحذف». الزرار المكتوب
 * هدفه أكبر بمرّات، وشكله بيقول إنه زرار.
 *
 * والزرار جوّه الخلية عن قصد: الضغط على السطر بيستكمل المسودّة، فالحذف لازم يوقف
 * الحدث عند نفسه (`stopPropagation`) وإلا بيفتحها وهو بيمسحها — والوقفة على
 * الاتنين: على الزرار نفسه وعلى اللي لافّه.
 *
 * **والفشل بيتقال.** كان `remove` بيبلع أي خطأ ويعيد قراءة الكشف، فالمسودّة بترجع
 * مكانها من غير ولا كلمة — ومحدش يعرف إن فيه حاجة وقعت أصلاً.
 *
 * والمكوّن واحد لست شاشات (البيع، الشرا، المرتجعين، التحويلات، الأذون) عشان
 * الشكل والسؤال والتأكيد يبقوا نفسهم — ست نسخ معناها ست سلوكيات بتفرق مع الوقت.
 */
export default function DraftTag({
  onDelete,
  label = 'مسودّة — لسه ما اترحّلتش',
}: {
  onDelete: () => void | Promise<void>;
  label?: string;
}) {
  const [busy, setBusy] = React.useState(false);

  const run = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onDelete();
      message.success('المسودّة اتمسحت');
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر مسح المسودّة');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Space size={6} onClick={(e) => e.stopPropagation()}>
      <Tag color="gold" style={{ marginInlineEnd: 0 }}>{label}</Tag>
      <Button
        size="small"
        danger
        loading={busy}
        icon={<DeleteOutlined />}
        onClick={run}
      >
        امسح
      </Button>
    </Space>
  );
}
