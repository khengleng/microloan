"use client";
export default function DashboardPage() {
    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-4 rounded shadow border border-gray-200">
                    <div className="text-sm text-gray-500 font-medium">Outstanding Principal</div>
                    <div className="text-2xl font-bold mt-2">$24,500.00</div>
                </div>
                <div className="bg-white p-4 rounded shadow border border-gray-200">
                    <div className="text-sm text-gray-500 font-medium">Due Next 7 Days</div>
                    <div className="text-2xl font-bold mt-2">$1,250.00</div>
                </div>
                <div className="bg-white p-4 rounded shadow border border-gray-200">
                    <div className="text-sm text-gray-500 font-medium">PAR 30</div>
                    <div className="text-2xl font-bold mt-2 text-red-600">3.2%</div>
                </div>
            </div>
            <div className="bg-white p-6 rounded shadow border border-gray-200 h-64 flex items-center justify-center text-gray-400">
                MicroLend OS MVP Dashboard Charts
            </div>
        </div>
    );
}
