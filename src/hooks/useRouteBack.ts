import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/** Return to a route already in the app's HashRouter history, or leave a direct deep link for home. */
export function useRouteBack(fallback = '/') {
  const navigate = useNavigate();
  return useCallback(() => {
    if (typeof window !== 'undefined' && window.history.state?.idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate, fallback]);
}
