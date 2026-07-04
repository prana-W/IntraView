import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/components/theme-provider';
import { Button } from '@/components/ui/button';
import { Mic, Sun, Moon, LogOut, LayoutDashboard } from 'lucide-react';
import { toast } from 'sonner';

export default function Navbar() {
    const { user, logout } = useAuth();
    const { theme, setTheme } = useTheme();
    const navigate = useNavigate();

    function handleLogout() {
        logout();
        toast.success('Logged out successfully');
        navigate('/auth');
    }

    return (
        <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
            <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
                {/* Logo */}
                <Link
                    to="/"
                    className="flex items-center gap-2.5 group"
                >
                    <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-lg shadow-primary/30 group-hover:shadow-primary/50 transition-shadow">
                        <Mic className="w-4 h-4 text-primary-foreground" />
                    </div>
                    <span className="font-bold text-lg tracking-tight">
                        Intra<span className="text-primary">View</span>
                    </span>
                </Link>

                {/* Right side */}
                <div className="flex items-center gap-2">
                    {user && (
                        <Link to="/">
                            <Button variant="ghost" size="sm" className="hidden sm:flex gap-2">
                                <LayoutDashboard className="w-4 h-4" />
                                Dashboard
                            </Button>
                        </Link>
                    )}

                    {/* Theme toggle */}
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                        aria-label="Toggle theme"
                    >
                        {theme === 'dark'
                            ? <Sun className="w-4 h-4" />
                            : <Moon className="w-4 h-4" />
                        }
                    </Button>

                    {user && (
                        <>
                            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-sm font-medium">
                                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold">
                                    {user.username?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase()}
                                </div>
                                <span className="text-muted-foreground">{user.username || user.email}</span>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={handleLogout}
                                aria-label="Logout"
                                className="text-muted-foreground hover:text-destructive"
                            >
                                <LogOut className="w-4 h-4" />
                            </Button>
                        </>
                    )}
                </div>
            </div>
        </header>
    );
}
