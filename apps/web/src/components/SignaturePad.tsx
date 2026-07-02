"use client";

import { useRef, useState, useEffect } from 'react';
import { Eraser } from 'lucide-react';

/** Minimal dependency-free canvas signature pad. Calls onChange with a PNG data
 *  URI while drawing, or '' when cleared. */
export function SignaturePad({ onChange, label }: { onChange: (dataUrl: string) => void; label: string }) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const drawing = useRef(false);
    const [hasInk, setHasInk] = useState(false);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#111';
    }, []);

    const pos = (e: React.PointerEvent) => {
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        return { x: (e.clientX - rect.left) * (canvas.width / rect.width), y: (e.clientY - rect.top) * (canvas.height / rect.height) };
    };

    const start = (e: React.PointerEvent) => {
        drawing.current = true;
        const ctx = canvasRef.current!.getContext('2d')!;
        const p = pos(e);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        (e.target as Element).setPointerCapture(e.pointerId);
    };
    const move = (e: React.PointerEvent) => {
        if (!drawing.current) return;
        const ctx = canvasRef.current!.getContext('2d')!;
        const p = pos(e);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        if (!hasInk) setHasInk(true);
    };
    const end = () => {
        if (!drawing.current) return;
        drawing.current = false;
        if (hasInk) onChange(canvasRef.current!.toDataURL('image/png'));
    };
    const clear = () => {
        const canvas = canvasRef.current!;
        canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
        setHasInk(false);
        onChange('');
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-foreground">{label}</span>
                <button type="button" onClick={clear} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <Eraser size={12} /> Clear
                </button>
            </div>
            <canvas
                ref={canvasRef}
                width={480}
                height={160}
                onPointerDown={start}
                onPointerMove={move}
                onPointerUp={end}
                onPointerLeave={end}
                className="w-full h-40 border border-border rounded bg-white touch-none cursor-crosshair"
            />
        </div>
    );
}
