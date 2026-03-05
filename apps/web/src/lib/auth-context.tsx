"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';
import api from '@/lib/api';

interface AuthUser {
    sub: string;
    email: string;
    role: string;
    tenantId: string;
    tenantName: string;
}

interface AuthContextValue {
    user: AuthUser | null;
    loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({ user: null, loading: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get('/auth/me')
            .then(res => setUser(res.data))
            .catch(() => setUser(null))
            .finally(() => setLoading(false));
    }, []);

    return (
        <AuthContext.Provider value={{ user, loading }}>
            {children}
        </AuthContext.Provider>
    );
}

/** Hook — use this in any component instead of calling api.get('/auth/me') directly */
export function useAuth() {
    return useContext(AuthContext);
}
