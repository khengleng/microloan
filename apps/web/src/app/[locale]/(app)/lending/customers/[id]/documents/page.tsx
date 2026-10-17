"use client";

import { useParams } from 'next/navigation';
import { CustomerDocumentsView } from '@/components/lending/documents/CustomerDocumentsView';

export default function CustomerDocumentsPage() {
    const { id } = useParams<{ id: string }>();
    return <CustomerDocumentsView borrowerId={String(id)} />;
}
