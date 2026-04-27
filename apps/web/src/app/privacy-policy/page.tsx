import Link from "next/link";

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold">Privacy Policy</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: April 27, 2026</p>

        <section className="mt-8 space-y-4 text-sm leading-6">
          <p>
            This Privacy Policy explains how DBank Cambodia collects, uses, stores, and protects personal
            and financial information processed through the MicroLoan platform.
          </p>
          <h2 className="text-lg font-semibold">1. Information we collect</h2>
          <p>
            We collect account information, borrower identity information, loan and repayment records,
            device and log data, and support communications.
          </p>
          <h2 className="text-lg font-semibold">2. How we use data</h2>
          <p>
            Data is used to provide lending operations, enforce fraud and security controls, generate reports,
            support compliance obligations, and improve platform reliability.
          </p>
          <h2 className="text-lg font-semibold">3. Data sharing</h2>
          <p>
            We do not sell personal data. Data may be shared with authorized service providers,
            regulators, and legal authorities when required by law.
          </p>
          <h2 className="text-lg font-semibold">4. Security</h2>
          <p>
            We apply administrative, technical, and organizational safeguards including access controls,
            encryption in transit, logging, and tenant-based isolation controls.
          </p>
          <h2 className="text-lg font-semibold">5. Data retention</h2>
          <p>
            We retain data for as long as needed for service delivery, legal compliance, dispute resolution,
            and legitimate business purposes.
          </p>
          <h2 className="text-lg font-semibold">6. Your rights</h2>
          <p>
            Subject to applicable law, you may request access, correction, or deletion of personal data.
            Some data may be retained to satisfy legal obligations.
          </p>
          <h2 className="text-lg font-semibold">7. Contact</h2>
          <p>
            Privacy inquiries can be sent to{" "}
            <a className="text-primary hover:underline" href="mailto:privacy@dbankcambodia.com">
              privacy@dbankcambodia.com
            </a>.
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
