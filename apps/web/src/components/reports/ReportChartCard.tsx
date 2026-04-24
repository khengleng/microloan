"use client";

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ResponsiveContainer,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

const COLORS = ['#2563eb', '#0ea5e9', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6', '#14b8a6'];

export function ReportChartCard({
  title,
  data,
  type = 'bar',
  xKey = 'name',
  yKey = 'value',
}: {
  title: string;
  data: Record<string, unknown>[];
  type?: 'bar' | 'line' | 'pie';
  xKey?: string;
  yKey?: string;
}) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-0">
        <CardTitle className="text-sm font-bold text-slate-800">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="h-64">
          {!data?.length ? (
            <div className="h-full border border-dashed rounded-md flex items-center justify-center text-sm text-slate-400">
              No chart data for selected filters
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              {type === 'line' ? (
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey={yKey} stroke="#2563eb" strokeWidth={2} dot={false} />
                </LineChart>
              ) : type === 'pie' ? (
                <PieChart>
                  <Pie data={data} dataKey={yKey} nameKey={xKey} outerRadius={90} label>
                    {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              ) : (
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey={yKey} fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

