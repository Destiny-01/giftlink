/**
 * Landing / Marketing page
 */

import { ArrowRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useAuth } from "@/hooks/useAuth";

const lifecycle = [
  {
    step: "01",
    title: "Fund",
    body: "The issuer sets a fixed allocation per claimant, a funded cap, one declared eligibility source, opening and expiry times, and a recovery destination, then funds the campaign in USDC on Arc.",
  },
  {
    step: "02",
    title: "Qualify",
    body: "The named eligibility verifier checks the authenticated claimant against the declared set. Funding is not proof that a particular person qualifies, and eligibility is not availability: nothing settles before opening.",
  },
  {
    step: "03",
    title: "Settle",
    body: "A qualifying claimant receives one single-use authorization bound to their wallet and this campaign, then settles the fixed USDC amount directly. One entitlement settles once.",
  },
  {
    step: "04",
    title: "Recover",
    body: "After expiry no new settlement is permitted. The issuer reclaims only the unused balance, under the rules fixed when the campaign was funded.",
  },
];

// Keeps call-to-action labels readable instead of clipped at 320px.
const ctaClass = "h-auto min-h-11 whitespace-normal px-6 py-3 sm:px-8";

const claimRecord = [
  { label: "Issuer", value: "Circle DevRel Collective" },
  { label: "Asset", value: "USDC" },
  { label: "Allocation", value: "250.00 USDC" },
  { label: "Eligibility verifier", value: "Declared allowlist" },
  { label: "Available from", value: "24 Sep 2026, 12:00 UTC" },
  { label: "Expires", value: "8 Oct 2026, 12:00 UTC" },
  { label: "Recovery", value: "Unused capital returns to the issuer" },
];

export default function Landing() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();

  // Redirect authenticated users to dashboard
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate("/dashboard", { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main>
        <section className="border-b border-border px-4 pt-28 pb-16 sm:pt-36 sm:pb-24">
          <div className="container mx-auto max-w-5xl">
            <p className="font-mono text-sm uppercase tracking-[0.2em] text-accent-2">
              Nomine
            </p>
            <h1 className="mt-6 font-display text-5xl leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
              Value, addressed.
            </h1>
            <p className="mt-6 max-w-2xl text-xl sm:text-2xl">
              The Claim Layer with an economic inbox.
            </p>
            <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground">
              An issuer funds a Claim before it knows where the value will
              settle. Value can be addressed to a person, group, or condition
              the issuer can already identify, without collecting the final
              wallet first. Nomine Inbox, where eligible people discover and
              settle those Claims, is in development alongside the Claim Core.
            </p>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className={ctaClass}>
                <Link to="/app">
                  Open GiftLink by Nomine
                  <ArrowRight className="h-5 w-5" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className={ctaClass}>
                <a href="#status">What is live today</a>
              </Button>
            </div>

            <p className="mt-8 text-sm text-muted-foreground">
              Current proof scope:{" "}
              <span className="font-mono">fixed-allocation USDC Claims on Arc</span>.
            </p>
          </div>
        </section>

        <section
          id="status"
          className="scroll-mt-20 border-b border-border px-4 py-16 sm:py-24"
        >
          <div className="container mx-auto max-w-5xl">
            <h2 className="font-display text-3xl sm:text-4xl">
              What is live, and what is not
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              The Claim Layer described on this page is being built. We do not
              present it as finished, audited, or funded.
            </p>

            <div className="mt-12 grid gap-10 md:grid-cols-2">
              <div className="border-t border-border pt-6">
                <h3 className="font-display text-xl">Live today</h3>
                <ul className="mt-4 space-y-4 text-base leading-7 text-muted-foreground">
                  <li>
                    <span className="text-foreground">
                      GiftLink by Nomine
                    </span>{" "}
                    is the original gifting MVP and the only product surface
                    that exists. A sender creates a claim link before knowing the
                    recipient&apos;s wallet.
                  </li>
                  <li>
                    The existing gifting routes in this application are
                    unchanged, including claim links that already exist.
                  </li>
                </ul>
              </div>

              <div className="border-t border-border pt-6">
                <h3 className="font-display text-xl">In development</h3>
                <ul className="mt-4 space-y-4 text-base leading-7 text-muted-foreground">
                  <li>
                    <span className="text-foreground">Nomine Claim Core</span>,
                    the custody, authorization, and lifecycle contract that
                    replaces the legacy escrow boundary.
                  </li>
                  <li>
                    <span className="text-foreground">Nomine Inbox</span>, where
                    a claimant discovers and settles funded Claims, and{" "}
                    <span className="text-foreground">Nomine Studio</span>, where
                    an issuer funds and reconciles a campaign.
                  </li>
                  <li>
                    No campaign is funded on Arc yet. Nothing on this page is a
                    live Claim, and the panels below are illustrations.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section
          id="claim-lifecycle"
          className="scroll-mt-20 border-b border-border px-4 py-16 sm:py-24"
        >
          <div className="container mx-auto max-w-5xl">
            <h2 className="font-display text-3xl sm:text-4xl">
              How a Claim is designed to work
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              Eligibility, funding, and availability are three separate facts. A
              Claim is only shown as available when it is funded, and only
              settles for someone the declared verifier has qualified.
            </p>

            <ol className="mt-12 grid gap-10 sm:grid-cols-2">
              {lifecycle.map((item) => (
                <li key={item.step} className="border-t border-border pt-6">
                  <p className="font-mono text-sm text-accent-2">{item.step}</p>
                  <h3 className="mt-2 font-display text-xl">{item.title}</h3>
                  <p className="mt-3 text-base leading-7 text-muted-foreground">
                    {item.body}
                  </p>
                </li>
              ))}
            </ol>

            <figure className="mt-16 border border-border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-6 py-3">
                <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Illustration
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  Asset: USDC · Network: Arc
                </span>
              </div>

              <div className="px-6 py-6">
                <dl className="space-y-3">
                  {claimRecord.map((row) => (
                    <div
                      key={row.label}
                      className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1"
                    >
                      <dt className="text-sm text-muted-foreground">
                        {row.label}
                      </dt>
                      <dd className="font-mono text-sm font-normal tabular-nums">
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              <figcaption className="border-t border-border px-6 py-4 text-sm text-muted-foreground">
                An illustration of the intended Claim record, not a live
                campaign. The issuer, amounts, and dates shown are examples, and
                no settlement action is offered here.
              </figcaption>
            </figure>
          </div>
        </section>

        <section id="giftlink" className="border-b border-border px-4 py-16 sm:py-24">
          <div className="container mx-auto max-w-5xl">
            <h2 className="font-display text-3xl sm:text-4xl">
              GiftLink by Nomine
            </h2>
            <div className="mt-6 max-w-2xl space-y-4 text-base leading-7 text-muted-foreground">
              <p>
                GiftLink is the gifting MVP that started this work: send value
                before you know the wallet. Building it made the wider problem
                visible. Wallet addresses say where money goes right now, but
                they do not express who value belongs to, which is why funded
                value needs a Claim.
              </p>
              <p>
                GiftLink remains a focused gifting application inside Nomine. It
                uses the legacy contract and custody boundary, and it has not
                migrated to the new Claim Core.
              </p>
            </div>
            <div className="mt-8">
              <Button asChild className={ctaClass}>
                <Link to="/app">
                  Open the GiftLink flow
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="px-4 py-16 sm:py-24">
          <div className="container mx-auto max-w-5xl">
            <div className="border border-border px-6 py-12 text-center sm:px-12">
              <h2 className="font-display text-3xl sm:text-4xl">
                Send value before you know the wallet.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-muted-foreground">
                Start with GiftLink today, or follow the Claim lifecycle being
                built for Nomine Inbox and Nomine Studio.
              </p>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <Button asChild size="lg" className={ctaClass}>
                  <Link to="/app">
                    Open GiftLink by Nomine
                    <ArrowRight className="h-5 w-5" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className={ctaClass}>
                  <a href="#claim-lifecycle">Read the Claim lifecycle</a>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
