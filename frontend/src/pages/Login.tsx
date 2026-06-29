import React, { useState } from 'react';
import { Form, Input, Button, Card, Typography, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth, User, RoleName } from '../components/AuthProvider';
import { api } from '../api/client';

const { Title } = Typography;

export default function Login() {
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      // 1. Authenticate with backend (consumes POST /auth/login)
      const loginRes = await api.post('/api/v1/auth/login', {
        username: values.username,
        password: values.password,
      });

      const { access_token } = loginRes.data;
      
      // Temporarily store token so the subsequent /auth/me request can pick it up
      localStorage.setItem('token', access_token);

      // 2. Fetch current user profiles (consumes GET /auth/me)
      const userRes = await api.get('/api/v1/auth/me');
      const profile = userRes.data;

      // Restrict access to back-office roles only (Sales Rep is out of scope for desktop app)
      if (profile.role === 'sales_rep') {
        localStorage.removeItem('token');
        message.error('عذراً، تطبيق المندوب متاح فقط عبر الهاتف المحمول.');
        setLoading(false);
        return;
      }

      const activeUser: User = {
        username: profile.username,
        role: profile.role as RoleName,
        branch_id: profile.branch_id,
        name: profile.full_name,
      };

      // 3. Confirm login in auth context
      login(access_token, activeUser);
      message.success('تم تسجيل الدخول بنجاح');
      navigate('/dashboard');
    } catch (err) {
      // Errors are handled by the Axios response interceptor (displays warning toasts)
      localStorage.removeItem('token');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        backgroundColor: '#f0f2f5',
        backgroundImage: 'radial-gradient(circle at center, #ffffff 0%, #f0f2f5 100%)',
      }}
    >
      <Card
        style={{
          width: 400,
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
          borderRadius: 8,
          border: 'none',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              backgroundColor: '#6AB42D',
              display: 'inline-flex',
              justifyContent: 'center',
              alignItems: 'center',
              color: '#fff',
              fontSize: 28,
              fontWeight: 'bold',
              marginBottom: 12,
            }}
          >
            T
          </div>
          <Title level={3} style={{ margin: 0, color: '#6AB42D' }}>
            تكنو ثيرم (Techno Therm)
          </Title>
          <Typography.Text type="secondary">بوابة موظفي الإدارة والفروع</Typography.Text>
        </div>

        <h2 style={{ textAlign: 'center', marginBottom: 24, fontWeight: 'normal', fontSize: '20px' }}>
          تسجيل الدخول
        </h2>

        <Form name="login_form" layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item
            name="username"
            rules={[{ required: true, message: 'يرجى إدخال اسم المستخدم!' }]}
          >
            <Input
              prefix={<UserOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="اسم المستخدم"
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: 'يرجى إدخال كلمة المرور!' }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="كلمة المرور"
              size="large"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              size="large"
              block
              loading={loading}
              style={{ height: 45, fontSize: 16 }}
            >
              تسجيل الدخول
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
