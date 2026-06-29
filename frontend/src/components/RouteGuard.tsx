import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, RoleName } from './AuthProvider';
import { Result, Button } from 'antd';

interface RouteGuardProps {
  children: React.ReactNode;
  allowedRoles?: RoleName[];
}

export default function RouteGuard({ children, allowedRoles }: RouteGuardProps) {
  const { isAuthenticated, user, isAuthenticating, logout } = useAuth();
  const location = useLocation();

  if (isAuthenticating) {
    return null; // The spinner is already displayed at the App/AuthProvider level
  }

  if (!isAuthenticated) {
    // Redirect to login page and remember current location
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check if role is allowed to access the target route
  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
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
