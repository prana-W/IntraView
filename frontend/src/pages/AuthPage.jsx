import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Mic, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';

export default function AuthPage() {
    const { login, token } = useAuth();
    const navigate = useNavigate();

    // Redirect if already logged in
    if (token) return <Navigate to="/" replace />;

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
            {/* Background blobs */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-primary/10 blur-3xl" />
                <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-primary/8 blur-3xl" />
            </div>

            {/* Logo */}
            <div className="flex items-center gap-3 mb-8">
                <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center shadow-xl shadow-primary/40">
                    <Mic className="w-6 h-6 text-primary-foreground" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">
                        Intra<span className="text-primary">View</span>
                    </h1>
                    <p className="text-xs text-muted-foreground">Voice recorder for LeetCode</p>
                </div>
            </div>

            <Tabs defaultValue="login" className="w-full max-w-md">
                <TabsList className="grid w-full grid-cols-2 mb-6">
                    <TabsTrigger value="login">Login</TabsTrigger>
                    <TabsTrigger value="register">Register</TabsTrigger>
                </TabsList>

                {/* ── Login ── */}
                <TabsContent value="login">
                    <LoginForm onSuccess={(token, user) => {
                        login(token, user);
                        toast.success(`Welcome back, ${user.username}! 👋`);
                        navigate('/');
                    }} />
                </TabsContent>

                {/* ── Register ── */}
                <TabsContent value="register">
                    <RegisterForm onSuccess={(token, user) => {
                        login(token, user);
                        toast.success(`Account created! Welcome, ${user.username}! 🎉`);
                        navigate('/');
                    }} />
                </TabsContent>
            </Tabs>
        </div>
    );
}

/* ── Login Form ────────────────────────────────────────────────────────────── */
function LoginForm({ onSuccess }) {
    const [email,    setEmail]    = useState('');
    const [password, setPassword] = useState('');
    const [loading,  setLoading]  = useState(false);

    async function handleSubmit(e) {
        e.preventDefault();
        if (!email || !password) { toast.error('Please fill in all fields'); return; }
        setLoading(true);
        try {
            const data = await api.post('/auth/login', { email, password });
            onSuccess(data.token, data.user);
        } catch (err) {
            toast.error(err.message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Welcome back</CardTitle>
                <CardDescription>Sign in to view your transcripts</CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="login-email">Email</Label>
                        <Input
                            id="login-email"
                            type="email"
                            placeholder="you@example.com"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            autoComplete="email"
                            required
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="login-password">Password</Label>
                        <Input
                            id="login-password"
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            autoComplete="current-password"
                            required
                        />
                    </div>
                    <Button type="submit" className="w-full" disabled={loading}>
                        {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Signing in…</> : 'Sign In'}
                    </Button>
                </form>
            </CardContent>
        </Card>
    );
}

/* ── Register Form ─────────────────────────────────────────────────────────── */
function RegisterForm({ onSuccess }) {
    const [username, setUsername] = useState('');
    const [email,    setEmail]    = useState('');
    const [password, setPassword] = useState('');
    const [loading,  setLoading]  = useState(false);

    async function handleSubmit(e) {
        e.preventDefault();
        if (!username || !email || !password) { toast.error('Please fill in all fields'); return; }
        if (password.length < 6) { toast.error('Password must be at least 6 characters'); return; }
        setLoading(true);
        try {
            const data = await api.post('/auth/register', { username, email, password });
            onSuccess(data.token, data.user);
        } catch (err) {
            toast.error(err.message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Create an account</CardTitle>
                <CardDescription>Start recording your problem-solving sessions</CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="reg-username">Username</Label>
                        <Input
                            id="reg-username"
                            type="text"
                            placeholder="coolcoder"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            autoComplete="username"
                            required
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="reg-email">Email</Label>
                        <Input
                            id="reg-email"
                            type="email"
                            placeholder="you@example.com"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            autoComplete="email"
                            required
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="reg-password">Password</Label>
                        <Input
                            id="reg-password"
                            type="password"
                            placeholder="min 6 characters"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            autoComplete="new-password"
                            required
                        />
                    </div>
                    <Button type="submit" className="w-full" disabled={loading}>
                        {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating…</> : 'Create Account'}
                    </Button>
                </form>
            </CardContent>
        </Card>
    );
}
