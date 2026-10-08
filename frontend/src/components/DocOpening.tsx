import { Spin } from 'antd';

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
