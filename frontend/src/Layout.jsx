import { Outlet } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import Navbar from '@/components/Navbar.jsx';
import Footer from '@/components/Footer.jsx';

function Layout() {
    return (
        <div className="min-h-screen flex flex-col bg-background">
            <Navbar />
            <main className="flex-1 flex flex-col w-full">
                <Outlet />
            </main>
            <Footer />
        </div>
    );
}

export default Layout;
