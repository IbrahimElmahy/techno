import React, { useState } from 'react';
import { Form, Input, Button, Card, Checkbox, Typography, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth, User, RoleName } from '../components/AuthProvider';
import { api } from '../api/client';
import Logo from '../components/Logo';

const REMEMBER_KEY = 'techno.remember_username';
const REMEMBER_PWD_KEY = 'techno.remember_password';

const readKey = (k: string) => {
  try { return localStorage.getItem(k) || ''; } catch { return ''; }
};

export default function Login() {
  const [loading, setLoading] = useState(false);
  const [remembered] = useState(() => readKey(REMEMBER_KEY));
  const [rememberedPwd] = useState(() => readKey(REMEMBER_PWD_KEY));
  const [remember, setRemember] = useState(() => Boolean(remembered));
  const { login } = useAuth();
  const navigate = useNavigate();

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      try {
        if (remember) {
          localStorage.setItem(REMEMBER_KEY, values.username);
          localStorage.setItem(REMEMBER_PWD_KEY, values.password);
        } else {
          localStorage.removeItem(REMEMBER_KEY);
          localStorage.removeItem(REMEMBER_PWD_KEY);
        }
      } catch {}
      const loginRes = await api.post('/api/v1/auth/login', {
        username: values.username,
        password: values.password,
      });

      const { access_token } = loginRes.data;
      
      localStorage.setItem('token', access_token);

      const userRes = await api.get('/api/v1/auth/me');
      const profile = userRes.data;

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
        capabilities: profile.capabilities ?? [],
        pages_shown: profile.pages_shown ?? [],
        pages_hidden: profile.pages_hidden ?? [],
      };

      login(access_token, activeUser);
      message.success('تم تسجيل الدخول بنجاح');
      navigate('/dashboard', { replace: true });
    } catch (err) {
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
          <Logo width={230} style={{ justifyContent: 'center', marginBottom: 8 }} />
          <Typography.Text type="secondary" style={{ display: 'block' }}>
            بوابة موظفي الإدارة والفروع
          </Typography.Text>
        </div>

        <h2 style={{ textAlign: 'center', marginBottom: 24, fontWeight: 'normal', fontSize: '20px' }}>
          تسجيل الدخول
        </h2>

        <Form name="login_form" layout="vertical" onFinish={onFinish} requiredMark={false}
          initialValues={{ username: remembered, password: rememberedPwd }}>
          <Form.Item
            name="username"
            rules={[{ required: true, message: 'يرجى إدخال اسم المستخدم!' }]}
          >
            <Input
              prefix={<UserOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="اسم المستخدم"
              size="large"
              autoFocus={!remembered}
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
              autoFocus={Boolean(remembered) && !rememberedPwd}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 12 }}>
            <Checkbox
              checked={remember}
              onChange={(e) => {
                setRemember(e.target.checked);
                if (!e.target.checked) {
                  try {
                    localStorage.removeItem(REMEMBER_KEY);
                    localStorage.removeItem(REMEMBER_PWD_KEY);
                  } catch {}
                }
              }}
            >
              تذكّر بيانات الدخول
            </Checkbox>
            <div style={{ fontSize: 14, color: '#555b65', marginTop: 2 }}>
              يُحفظ اسم المستخدم وكلمة المرور على هذا الجهاز — اتركها غير مفعّلة على جهاز مشترك.
            </div>
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
