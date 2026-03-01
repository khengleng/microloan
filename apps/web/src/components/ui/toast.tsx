"use client";

import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { CheckCircle, XCircle, X, Info } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
    id: string;
    message: string;
    type: ToastType;
}

interface ToastContextValue {
    showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => { } });

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const showToast = useCallback((message: string, type: ToastType = 'info') => {
        const id = Math.random().toString(36).slice(2);
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 4000);
    }, []);

    const remove = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80">
                {toasts.map(toast => (
                    <div
                        key={toast.id}
                        className={`flex items-start gap-3 p-4 rounded-lg shadow-lg border text-sm animate-in slide-in-from-bottom-2 duration-300 ${toast.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
                                toast.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' :
                                    'bg-blue-50 border-blue-200 text-blue-800'
                            }`}
                    >
                        {toast.type === 'success' ? <CheckCircle size={18} className="flex-shrink-0 mt-0.5 text-emerald-600" /> :
                            toast.type === 'error' ? <XCircle size={18} className="flex-shrink-0 mt-0.5 text-red-600" /> :
                                <Info size={18} className="flex-shrink-0 mt-0.5 text-blue-600" />}
                        <span className="flex-1">{toast.message}</span>
                        <button onClick={() => remove(toast.id)} className="opacity-50 hover:opacity-100">
                            <X size={14} />
                        </button>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast() {
    return useContext(ToastContext);
}
