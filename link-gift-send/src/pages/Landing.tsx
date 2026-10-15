/**
 * Landing / Marketing page
 */

import { ArrowRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { RoadmapColumns } from "@/components/nomine";
import { useAuth } from "@/hooks/useAuth";
import { network } from "@/config/network";
import { shortenAddress } from "@/lib/claimCore";

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

// Plain-language, three steps. No jargon and no process detail.
const howItWorks = [
  "Fund a Claim: capital is escrowed on Arc with its Gate, window and recovery rule fixed up front",
  "Qualify: the claimant proves eligibility. Today that is a verified email, attested by a named Resolver",
  "Settle: one click, onchain, exactly once. Unused value returns to the issuer",
];

// Keeps call-to-action labels readable instead of clipped at 320px.
const ctaClass = "h-auto min-h-11 whitespace-normal px-6 py-3 sm:px-8";

const claimRecord = [
  { label: "Issuer", value: "Example Issuer Collective" },
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

  // Signed-in visitors belong in the Inbox, not on the marketing page.
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate("/inbox", { replace: true });
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
              A Claim is funded value addressed to a person, group, condition
              or machine. The capital is escrowed first, with who qualifies,
              when it opens, how it settles and where unused value returns all
              fixed up front. Whoever qualifies settles it, exactly once. Nomine
              Inbox is where people find and settle everything addressed to them.
            </p>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className={ctaClass}>
                <Link to="/app?next=/inbox">
                  Open Inbox
                  <ArrowRight className="h-5 w-5" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className={ctaClass}>
                <Link to="/studio">Issuer Studio</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Network strip: only the facts the build is configured with. */}
        <section className="border-b border-border px-4 py-8">
          <div className="container mx-auto max-w-5xl">
            <dl className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
              <div className="flex items-baseline gap-2">
                <dt className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Network
                </dt>
                <dd className="text-foreground">{network.name}</dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Claim Core
                </dt>
                <dd>
                  <a
                    href={`${network.explorerUrl}/address/${network.claimCoreAddress}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-accent hover:underline"
                  >
                    {shortenAddress(network.claimCoreAddress)}
                  </a>
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Asset
                </dt>
                <dd className="font-mono text-foreground">USDC</dd>
              </div>
            </dl>
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
                An illustration of the intended Claim record, not an actual
                campaign. The issuer, amounts, and dates shown are examples, and
                no settlement action is offered here.
              </figcaption>
            </figure>
          </div>
        </section>

        <section
          id="how-it-works"
          className="scroll-mt-20 border-b border-border px-4 py-16 sm:py-20"
        >
          <div className="container mx-auto max-w-5xl">
            <h2 className="font-display text-3xl sm:text-4xl">How it works</h2>
            <ol className="mt-10 grid gap-8 sm:grid-cols-3">
              {howItWorks.map((step, index) => (
                <li key={step} className="border-t border-border pt-6">
                  <p className="font-mono text-sm text-accent-2">
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <p className="mt-2 text-base leading-7">{step}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          id="roadmap"
          className="scroll-mt-20 border-b border-border px-4 py-16 sm:py-24"
        >
          <div className="container mx-auto max-w-5xl">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="font-display text-3xl sm:text-4xl">Roadmap</h2>
                <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
                  What is live today, and what is coming next. Live items are
                  shipped; everything else is clearly marked.
                </p>
              </div>
              <Link to="/roadmap" className="text-sm text-accent hover:underline">
                See the full roadmap
              </Link>
            </div>

            <div className="mt-12">
              <RoadmapColumns />
            </div>
          </div>
        </section>

        <section className="px-4 py-16 sm:py-24">
          <div className="container mx-auto max-w-5xl">
            <div className="border border-border px-6 py-12 text-center sm:px-12">
              <h2 className="font-display text-3xl sm:text-4xl">
                Make value addressable.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-muted-foreground">
                Check your Inbox for funded Claims, or fund a Claim program from
                Studio.
              </p>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <Button asChild size="lg" className={ctaClass}>
                  <Link to="/app?next=/inbox">
                    Open Inbox
                    <ArrowRight className="h-5 w-5" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className={ctaClass}>
                  <Link to="/studio">Issuer Studio</Link>
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
