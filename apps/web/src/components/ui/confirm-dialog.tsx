"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { AlertTriangle, Trash2, Ban, X } from 'lucide-react';
import { Button } from './button';

interface ConfirmOptions {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'warning' | 'default';
}

interface ConfirmContextType {
    confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<(ConfirmOptions & {
        resolve: (v: boolean) => void;
    }) | null>(null);

    const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
        return new Promise((resolve) => {
            setState({ ...opts, resolve });
        });
    }, []);

    const handleConfirm = () => { state?.resolve(true); setState(null); };
    const handleCancel = () => { state?.resolve(false); setState(null); };

    const variantStyles = {
        danger: { icon: Trash2, iconBg: 'bg-red-100', iconColor: 'text-red-600', btn: 'bg-red-600 hover:bg-red-700 text-white' },
        warning: { icon: AlertTriangle, iconBg: 'bg-amber-100', iconColor: 'text-amber-600', btn: 'bg-amber-600 hover:bg-amber-700 text-white' },
        default: { icon: AlertTriangle, iconBg: 'bg-blue-100', iconColor: 'text-blue-600', btn: 'bg-slate-900 hover:bg-slate-700 text-white' },
    };

    const v = variantStyles[state?.variant || 'default'];
    const Icon = v.icon;

    return (
        <ConfirmContext.Provider value={{ confirm }}>
            {children}
            {state && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ background: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(2px)' }}
                    onClick={handleCancel}
                >
                    <div
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in fade-in zoom-in-95 duration-150"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-start gap-4">
                            <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${v.iconBg}`}>
                                <Icon size={20} className={v.iconColor} />
                            </div>
                            <div className="flex-1 min-w-0">
                                {state.title && (
                                    <h3 className="text-base font-bold text-slate-900 mb-1">{state.title}</h3>
                                )}
                                <p className="text-sm text-slate-500 leading-relaxed">{state.message}</p>
                            </div>
                            <button onClick={handleCancel} className="text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="flex gap-2.5 mt-6 justify-end">
                            <Button
                                variant="outline"
                                onClick={handleCancel}
                                className="text-slate-600"
                            >
                                {state.cancelLabel || 'Cancel'}
                            </Button>
                            <Button
                                onClick={handleConfirm}
                                className={v.btn}
                            >
                                {state.confirmLabel || 'Confirm'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </ConfirmContext.Provider>
    );
}

export function useConfirm() {
    const ctx = useContext(ConfirmContext);
    if (!ctx) throw new Error('useConfirm must be used inside ConfirmProvider');
    return ctx.confirm;
}
