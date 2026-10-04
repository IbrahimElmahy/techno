import { Spin } from 'antd';

/**
 * مكان الكشف وهو بيفتح مستند جاي من شاشة تانية (كارت صنف، كشف حساب…).
 *
 * الشاشة كانت بترسم كشفها الأول وبعدين المستند لما يوصل — فاللي فاتح فاتورة من كارت الصنف
 * بيشوف سجل المبيعات جزء من الثانية. دلوقتي المكان ده بيفضل فاضي بمؤشر لحد ما المستند يفتح.
 */
export default function DocOpening() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: 'calc(100vh - 140px)',
    }}>
      <Spin size="large" tip="جاري فتح المستند…"><div style={{ width: 120, height: 60 }} /></Spin>
    </div>
  );
}
