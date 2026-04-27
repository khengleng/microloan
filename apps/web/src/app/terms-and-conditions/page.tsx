import Link from "next/link";

export default function TermsAndConditionsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold">Terms and Conditions</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: April 27, 2026</p>

        <section className="mt-8 space-y-4 text-sm leading-6">
          <p>
            These Terms and Conditions govern use of the MicroLoan platform provided by DBank Cambodia.
            By accessing or using the service, you agree to these terms.
          </p>
          <h2 className="text-lg font-semibold">1. Service scope</h2>
          <p>
            MicroLoan provides digital loan origination, underwriting workflow, repayment tracking, and
            portfolio reporting tools for authorized organizations and their users.
          </p>
          <h2 className="text-lg font-semibold">2. Eligibility and accounts</h2>
          <p>
            You must provide accurate registration information and keep your credentials secure.
            You are responsible for activity performed under your account.
          </p>
          <h2 className="text-lg font-semibold">3. Acceptable use</h2>
          <p>
            You agree not to misuse the service, attempt unauthorized access, interfere with availability,
            upload malicious content, or process unlawful transactions.
          </p>
          <h2 className="text-lg font-semibold">4. Fees and billing</h2>
          <p>
            Service fees, if applicable, are defined in your commercial agreement or pricing page and may
            be updated with prior notice.
          </p>
          <h2 className="text-lg font-semibold">5. Data protection</h2>
          <p>
            We process personal and financial data according to our Privacy Policy and applicable laws.
          </p>
          <h2 className="text-lg font-semibold">6. Suspension and termination</h2>
          <p>
            We may suspend or terminate access for security risks, non-payment, legal non-compliance, or
            material breach of these terms.
          </p>
          <h2 className="text-lg font-semibold">7. Limitation of liability</h2>
          <p>
            To the extent permitted by law, DBank Cambodia is not liable for indirect or consequential damages.
          </p>
          <h2 className="text-lg font-semibold">8. Contact</h2>
          <p>
            For questions about these terms, contact{" "}
            <a className="text-primary hover:underline" href="mailto:support@dbankcambodia.com">
              support@dbankcambodia.com
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
