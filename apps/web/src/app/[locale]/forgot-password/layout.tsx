import { RouteMessages } from '@/components/RouteMessages';

/** Sends this segment's client components only the messages they use (src/i18n-namespaces.ts). */
export default function Layout({ children }: { children: React.ReactNode }) {
    return <RouteMessages route="forgot-password">{children}</RouteMessages>;
}
