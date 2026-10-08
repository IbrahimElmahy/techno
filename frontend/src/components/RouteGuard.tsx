import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, RoleName, roleForAccess } from './AuthProvider';
import { Result, Button } from 'antd';

interface RouteGuardProps {
  children: React.ReactNode;
  allowedRoles?: RoleName[];
}

export default function RouteGuard({ children, allowedRoles }: RouteGuardProps) {
  const { isAuthenticated, user, isAuthenticating, logout } = useAuth();
  const location = useLocation();

  if (isAuthenticating) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && user && !allowedRoles.includes(roleForAccess(user.role) as RoleName)) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
        <Result
          status="403"
          title="403"
          subTitle="عذراً، ليس لديك صلاحية الوصول إلى هذه الصفحة."
          extra={
            <Button type="primary" onClick={() => window.location.hash = '/dashboard'}>
              العودة للرئيسية
            </Button>
          }
        />
      </div>
    );
  }

  return <>{children}</>;
}
