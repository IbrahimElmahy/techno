import React from 'react';
import { Space, Tag, Tooltip } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { Popconfirm } from './noConfirm';

/**
 * علامة «مسودّة» على سطر الكشف — **ومعاها الحذف**.
 *
 * المسودّة كانت بتتفتح بالضغط عليها وبس. اللي كتب واحدة بالغلط، أو خلّص شغله
 * بطريقة تانية، ما كانش قدامه غير إنه يفتحها ويفضّيها بإيده — ولو سابها بتفضل فوق
 * الكشف للأبد بين المستندات الحقيقية. `useDraft` كان مصدّر `remove` من الأول
 * ومحدش بيستعملها في أي شاشة.
 *
 * والزرار جوّه الخلية عن قصد: الضغط على السطر بيستكمل المسودّة، فالحذف لازم
 * يوقف الحدث عند نفسه (`stopPropagation`) وإلا بيفتحها وهو بيمسحها.
 *
 * والمكوّن واحد لست شاشات (البيع، الشرا، المرتجعين، التحويلات، الأذون) عشان
 * الشكل والسؤال والتأكيد يبقوا نفسهم — ست نسخ معناها ست سلوكيات بتفرق مع الوقت.
 */
export default function DraftTag({
  onDelete,
  label = 'مسودّة — لسه ما اترحّلتش',
}: {
  onDelete: () => void;
  label?: string;
}) {
  return (
    <Space size={4} onClick={(e) => e.stopPropagation()}>
      <Tag color="gold" style={{ marginInlineEnd: 0 }}>{label}</Tag>
      <Popconfirm
        title="تمسح المسودّة؟"
        description="اللي اتكتب فيها بيروح، والمستند مش هيتعمل."
        okText="امسح"
        cancelText="سيبها"
        okButtonProps={{ danger: true }}
        onConfirm={onDelete}
      >
        {/* **من غير `onClick` على الأيقونة.**
            `Popconfirm` بتاعتنا بتلفّ اللي جوّاها في `<span onClick>` وبتنفّذ من
            هناك. أي `onClick` على الأيقونة نفسها بيشتغل الأول وبيوقف الحدث قبل ما
            يوصل للّفّة — فالضغط ماكانش بيمسح حاجة، وباين إنه اشتغل. والوقفة اللي
            بتمنع السطر إنه يفتح المستند موجودة في اللفّة نفسها. */}
        <Tooltip title="مسح المسودّة">
          <DeleteOutlined style={{ color: '#cf1322', cursor: 'pointer' }} />
        </Tooltip>
      </Popconfirm>
    </Space>
  );
}
