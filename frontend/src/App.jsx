import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ThemeProvider } from '@/components/theme-provider';
import { AuthProvider } from '@/context/AuthContext';
import ErrorBoundary from '@/components/ErrorBoundary.jsx';
import ProtectedRoute from '@/components/ProtectedRoute.jsx';
import Layout from './Layout.jsx';

import AuthPage         from './pages/AuthPage.jsx';
import Dashboard        from './pages/Dashboard.jsx';
import TranscriptDetail from './pages/TranscriptDetail.jsx';
import { NotFound }     from './pages';

const router = createBrowserRouter([
    {
        path: '/auth',
        element: <AuthPage />,
    },
    {
        path: '/',
        element: <Layout />,
        children: [
            {
                index: true,
                element: (
                    <ProtectedRoute>
                        <Dashboard />
                    </ProtectedRoute>
                ),
            },
            {
                path: 'transcript/:id',
                element: (
                    <ProtectedRoute>
                        <TranscriptDetail />
                    </ProtectedRoute>
                ),
            },
            {
                path: '*',
                element: <NotFound />,
            },
        ],
    },
]);

function App() {
    return (
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
            <AuthProvider>
                <ErrorBoundary>
                    <RouterProvider router={router} />
                </ErrorBoundary>
            </AuthProvider>
        </ThemeProvider>
    );
}

export default App;
