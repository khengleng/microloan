import { useTranslations } from 'next-intl';
import { Btn } from './ui';

/** Simple pager for endpoints that return `{ data, total }` with a fixed page size. */
export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
    const t = useTranslations('LendingUi');
    const pages = Math.max(1, Math.ceil(total / pageSize));
    if (total <= pageSize && page === 1) return <p className="text-[12px] text-[#697386]">{t('records', { count: total })}</p>;
    return (
        <div className="flex items-center justify-between gap-3 text-[12px] text-[#697386]">
            <span>{t('recordsPage', { count: total, page, pages })}</span>
            <div className="flex gap-1.5">
                <Btn size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>← {t('prev')}</Btn>
                <Btn size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t('next')} →</Btn>
            </div>
        </div>
    );
}
