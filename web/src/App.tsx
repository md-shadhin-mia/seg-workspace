import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import { ApiError } from './lib/api';
import { AuthProvider, GuestOnly, RequireAuth } from './lib/auth';
import { PageLoading, ToastProvider } from './components/ui';
import { Shell } from './components/Shell';
import { Login, Register, Forgot, Reset } from './pages/Auth';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const MyTasks = lazy(() => import('./pages/MyTasks'));
const ProjectPage = lazy(() => import('./pages/Project'));
const TeamPage = lazy(() => import('./pages/Team'));
const TaskPage = lazy(() => import('./pages/Task'));
const Inbox = lazy(() => import('./pages/Inbox'));
const Users = lazy(() => import('./pages/admin/Users'));
const Teams = lazy(() => import('./pages/admin/Teams'));
const Settings = lazy(() => import('./pages/Settings'));
const NotFound = lazy(() => import('./pages/NotFound'));

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
    },
  },
});

const page = (el: React.ReactNode) => <Suspense fallback={<PageLoading />}>{el}</Suspense>;

const router = createBrowserRouter([
  { path: '/login', element: <GuestOnly><Login /></GuestOnly> },
  { path: '/register', element: <GuestOnly><Register /></GuestOnly> },
  { path: '/forgot-password', element: <GuestOnly><Forgot /></GuestOnly> },
  { path: '/reset-password', element: <Reset mode="reset" /> },
  { path: '/accept-invite', element: <Reset mode="invite" /> },
  {
    element: <RequireAuth><Shell><Outlet /></Shell></RequireAuth>,
    children: [
      { path: '/', element: page(<Dashboard />) },
      { path: '/my-tasks', element: page(<MyTasks />) },
      { path: '/projects/:id', element: page(<ProjectPage />) },
      { path: '/teams/:id', element: page(<TeamPage />) },
      { path: '/tasks/:id', element: page(<TaskPage />) },
      { path: '/inbox', element: page(<Inbox />) },
      { path: '/settings', element: page(<Settings />) },
      { path: '/admin/users', element: <RequireAuth admin>{page(<Users />)}</RequireAuth> },
      { path: '/admin/teams', element: <RequireAuth admin>{page(<Teams />)}</RequireAuth> },
      { path: '*', element: page(<NotFound />) },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
