import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import { ApiError, api, setUnauthorizedHandler } from './api';
import type { MeResponse } from './types';
import { PageLoading } from '../components/ui';

interface AuthState { data: MeResponse | null; loading: boolean; refresh: () => Promise<unknown>; signOut: () => Promise<void> }
const Ctx = createContext<AuthState>({ data: null, loading: true, refresh: async () => {}, signOut: async () => {} });
export const useAuth = () => useContext(Ctx);
export const useMe = () => useContext(Ctx).data!.user;

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try { return await api.get<MeResponse>('/auth/me'); } catch (e) { if (e instanceof ApiError && e.status === 401) return null; throw e; }
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  useEffect(() => {
    setUnauthorizedHandler(() => { qc.setQueryData(['me'], null); });
  }, [qc]);
  const value: AuthState = {
    data: q.data ?? null,
    loading: q.isLoading,
    refresh: () => q.refetch(),
    signOut: async () => {
      await api.post('/auth/logout').catch(() => {});
      qc.clear();
      qc.setQueryData(['me'], null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { data, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <PageLoading />;
  if (!data) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (admin && data.user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function GuestOnly({ children }: { children: ReactNode }) {
  const { data, loading } = useAuth();
  if (loading) return null;
  if (data) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export const isLeadOf = (me: MeResponse['user'], teamId: string) => me.role === 'admin' || me.teams.some((t) => t.teamId === teamId && t.role === 'lead');
export const isAnyLead = (me: MeResponse['user']) => me.role === 'admin' || me.teams.some((t) => t.role === 'lead');
