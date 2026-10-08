import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

export function useBackTo(fallback: string) {
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = (window.history.state as any)?.idx;
    if (typeof idx === 'number' && idx > 0) {
      navigate(-1);
      return;
    }
    navigate(fallback);
  }, [navigate, fallback]);
}

export default useBackTo;
