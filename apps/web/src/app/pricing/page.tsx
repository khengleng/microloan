import Link from "next/link";

const plans = [
  {
    name: "Starter",
    price: "$49 / month",
    description: "For small lending teams launching digital operations.",
    features: ["Up to 5 users", "Borrower and loan management", "Basic reporting"],
  },
  {
    name: "Growth",
    price: "$149 / month",
    description: "For growing institutions with branch-level operations.",
    features: ["Up to 25 users", "Collections and repayment workflows", "Advanced reporting and exports"],
  },
  {
    name: "Enterprise",
    price: "Custom",
    description: "For regulated lenders needing advanced controls and integrations.",
    features: ["Unlimited users", "Custom integrations", "Priority support and onboarding"],
  },
];

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="text-3xl font-bold">Pricing</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Transparent plans for digital lending operations.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          {plans.map((plan) => (
            <article key={plan.name} className="rounded-lg border border-border bg-card p-5">
              <h2 className="text-xl font-semibold">{plan.name}</h2>
              <p className="mt-1 text-primary font-bold">{plan.price}</p>
              <p className="mt-2 text-sm text-muted-foreground">{plan.description}</p>
              <ul className="mt-4 space-y-2 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature}>- {feature}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <p className="mt-8 text-sm text-muted-foreground">
          For sales and billing inquiries:{" "}
          <a className="text-primary hover:underline" href="mailto:sales@dbankcambodia.com">
            sales@dbankcambodia.com
          </a>
        </p>

        <div className="mt-8">
          <Link href="/en/login" className="text-sm text-primary hover:underline">
            Return to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
