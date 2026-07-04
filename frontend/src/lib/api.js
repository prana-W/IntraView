const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8765';

function getToken() {
    const expiry = parseInt(localStorage.getItem('iv_token_exp') || '0', 10);
    if (Date.now() > expiry) return null;
    return localStorage.getItem('iv_token');
}

async function request(method, path, body) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

const api = {
    get:    (path)        => request('GET',    path),
    post:   (path, body)  => request('POST',   path, body),
    put:    (path, body)  => request('PUT',    path, body),
    delete: (path)        => request('DELETE', path),
};

export default api;
