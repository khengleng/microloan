"use client";

import { useEffect } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { clarityEvent, claritySetTag, initClarity, isClarityEnabled } from '@/lib/clarity';

export function ClarityProvider() {
  const pathname = usePathname();
  const params = useParams();
  const locale = typeof params?.locale === 'string' ? params.locale : 'en';

  useEffect(() => {
    initClarity();
  }, []);

  useEffect(() => {
    if (!isClarityEnabled()) return;
    claritySetTag('locale', locale);
    claritySetTag('path', pathname || '/');
    clarityEvent('journey_page_view');
  }, [locale, pathname]);

  return null;
}
