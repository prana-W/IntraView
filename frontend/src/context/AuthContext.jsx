import { createContext, useContext, useEffect, useState } from 'react';

const TOKEN_KEY     = 'iv_token';
const EXPIRY_KEY    = 'iv_token_exp';
const USER_KEY      = 'iv_user';
const TOKEN_TTL_MS  = 10 * 24 * 60 * 60 * 1000; // 10 days

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [token, setToken]   = useState(null);
    const [user,  setUser]    = useState(null);
    const [loading, setLoading] = useState(true);

    // Rehydrate from localStorage on mount
    useEffect(() => {
        const stored    = localStorage.getItem(TOKEN_KEY);
        const expiry    = parseInt(localStorage.getItem(EXPIRY_KEY) || '0', 10);
        const storedUser = localStorage.getItem(USER_KEY);

        if (stored && expiry > Date.now()) {
            setToken(stored);
            if (storedUser) setUser(JSON.parse(storedUser));
        } else {
            // Expired — wipe storage
            _clear();
        }
        setLoading(false);
    }, []);

    function _clear() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(EXPIRY_KEY);
        localStorage.removeItem(USER_KEY);
    }

    /** Call after a successful login / register */
    function login(newToken, newUser) {
        localStorage.setItem(TOKEN_KEY,  newToken);
        localStorage.setItem(EXPIRY_KEY, String(Date.now() + TOKEN_TTL_MS));
        localStorage.setItem(USER_KEY,   JSON.stringify(newUser));
        setToken(newToken);
        setUser(newUser);
    }

    function logout() {
        _clear();
        setToken(null);
        setUser(null);
    }

    return (
        <AuthContext.Provider value={{ token, user, login, logout, loading }}>
            {children}
        </AuthContext.Provider>
    );
}

/** Convenience hook */
export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
    return ctx;
}
