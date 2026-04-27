import Link from "next/link";

export default function RefundPolicyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold">Refund Policy</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: April 27, 2026</p>

        <section className="mt-8 space-y-4 text-sm leading-6">
          <p>
            This Refund Policy describes when refunds are issued for paid subscriptions or services for
            the MicroLoan platform.
          </p>
          <h2 className="text-lg font-semibold">1. Monthly subscriptions</h2>
          <p>
            Subscription fees are billed in advance and are generally non-refundable after the billing cycle
            starts, unless required by law or agreed in writing.
          </p>
          <h2 className="text-lg font-semibold">2. Billing errors</h2>
          <p>
            If you are charged incorrectly, contact us within 14 days of the charge date. Verified billing
            errors are eligible for full or partial refund.
          </p>
          <h2 className="text-lg font-semibold">3. Service unavailability</h2>
          <p>
            For major service disruptions caused by our platform, we may provide service credits or refunds
            according to contract terms and incident impact.
          </p>
          <h2 className="text-lg font-semibold">4. Cancellation</h2>
          <p>
            Cancellations stop future billing periods. Already paid periods remain active until the cycle ends,
            unless otherwise required by law.
          </p>
          <h2 className="text-lg font-semibold">5. Contact</h2>
          <p>
            Refund requests can be sent to{" "}
            <a className="text-primary hover:underline" href="mailto:billing@dbankcambodia.com">
              billing@dbankcambodia.com
            </a>{" "}
            with your account identifier and invoice reference.
          </p>
        </section>

        <div className="mt-10">
          <Link href="/en/login" className="text-sm text-primary hover:underline">
            Return to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
