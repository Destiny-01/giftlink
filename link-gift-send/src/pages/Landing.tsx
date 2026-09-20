/**
 * Landing / Marketing page
 */

import {
  ArrowRight,
  Shield,
  Zap,
  Lock,
  PlusCircle,
  Link2,
  Mail,
  Wallet,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useAuth } from "@/hooks/useAuth";

export default function Landing() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();
  const [showClaimDemo, setShowClaimDemo] = useState(false);

  // Redirect authenticated users to dashboard
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate("/dashboard", { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-32 pb-20">
        {/* Background effects */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(0,255,209,0.15),transparent_50%)]" />
        <div className="absolute right-0 top-0 h-[500px] w-[500px] rounded-full bg-accent/5 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-[300px] w-[300px] rounded-full bg-accent-2/5 blur-3xl" />

        <div className="container relative mx-auto px-4">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="animate-fade-in font-display text-5xl font-bold leading-tight sm:text-6xl lg:text-7xl">
              Send money like a link.{" "}
              <span className="bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-transparent">
                No wallet needed.
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl animate-slide-up text-lg text-muted-foreground sm:text-xl">
              Create a secure claim link, attach a message, and send USDC — the
              receiver claims instantly using email, social, or a wallet. Gas
              paid in USDC on Arc.
            </p>

            <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:justify-center">
              <Button
                size="lg"
                className="animate-fade-in bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={() => navigate("/app")}
              >
                Create GiftLink
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="animate-fade-in border-accent/20"
                onClick={() => setShowClaimDemo(true)}
              >
                How It Works
              </Button>
            </div>
          </div>

          {/* Mock device/card */}
          <div className="mx-auto mt-16 max-w-2xl animate-float">
            <Card className="border border-accent/20 bg-gradient-to-br from-card to-surface p-6 shadow-[0_20px_70px_rgba(0,255,209,0.2)]">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-accent/20" />
                    <div>
                      <p className="font-semibold">alice.eth</p>
                      <p className="text-sm text-muted-foreground">
                        sent you a gift
                      </p>
                    </div>
                  </div>
                  <div className="rounded-full bg-gold/20 px-3 py-1 text-sm font-medium text-gold">
                    Pending
                  </div>
                </div>

                <div className="rounded-lg border border-white/[0.04] bg-surface/50 p-4">
                  <p className="text-sm text-muted-foreground">Message</p>
                  <p className="mt-1">Happy Birthday! 🎉</p>
                </div>

                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-4xl font-bold">
                      10.00
                    </span>
                    <span className="text-xl text-muted-foreground">USDC</span>
                  </div>
                </div>

                <Button
                  className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                  onClick={() => setShowClaimDemo(true)}
                >
                  Claim Gift
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="font-display text-4xl font-bold sm:text-5xl">
              How It Works
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
              Send money in three simple steps. No complexity, no barriers.
            </p>
          </div>

          <div className="mx-auto mt-16 max-w-5xl">
            <div className="grid gap-8 md:grid-cols-3">
              {/* Step 1 */}
              <div className="relative">
                <div className="flex flex-col items-center text-center">
                  <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-accent/20">
                    <PlusCircle className="h-8 w-8 text-accent" />
                  </div>
                  <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent">
                    Step 1
                  </div>
                  <h3 className="mb-3 font-display text-2xl font-semibold">
                    Create Your Gift
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">
                    Connect your wallet and choose the amount of USDC to send.
                    Add a personal message, set the recipient (or make it
                    public), and create your secure gift link.
                  </p>
                </div>
                <div className="absolute right-0 top-8 hidden h-0.5 w-full translate-x-1/2 bg-gradient-to-r from-accent/20 via-accent/40 to-transparent md:block" />
              </div>

              {/* Step 2 */}
              <div className="relative">
                <div className="flex flex-col items-center text-center">
                  <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-accent/20">
                    <Link2 className="h-8 w-8 text-accent" />
                  </div>
                  <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent">
                    Step 2
                  </div>
                  <h3 className="mb-3 font-display text-2xl font-semibold">
                    Share the Link
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">
                    Copy your unique claim link and send it via email, text,
                    social media, or any messaging platform. The link is secure
                    and can only be used once.
                  </p>
                </div>
                <div className="absolute right-0 top-8 hidden h-0.5 w-full translate-x-1/2 bg-gradient-to-r from-accent/20 via-accent/40 to-transparent md:block" />
              </div>

              {/* Step 3 */}
              <div className="relative">
                <div className="flex flex-col items-center text-center">
                  <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-accent/20">
                    <CheckCircle2 className="h-8 w-8 text-accent" />
                  </div>
                  <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent">
                    Step 3
                  </div>
                  <h3 className="mb-3 font-display text-2xl font-semibold">
                    Instant Claim
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">
                    Recipients claim instantly using email, X (Twitter),
                    Discord, or by connecting a wallet. No wallet needed—we
                    create one automatically. Gas fees are paid in USDC.
                  </p>
                </div>
              </div>
            </div>

            {/* Additional Details */}
            <div className="mt-16 grid gap-6 md:grid-cols-2">
              <Card className="border border-white/[0.04] bg-card p-6">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/20">
                    <Mail className="h-5 w-5 text-accent" />
                  </div>
                  <h4 className="font-display text-lg font-semibold">
                    Walletless Onboarding
                  </h4>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Recipients don't need a crypto wallet to claim. They can sign
                  in with email or social accounts, and we'll create a wallet
                  for them automatically. If they already have a wallet, they
                  can connect it instead.
                </p>
              </Card>

              <Card className="border border-white/[0.04] bg-card p-6">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/20">
                    <Wallet className="h-5 w-5 text-accent" />
                  </div>
                  <h4 className="font-display text-lg font-semibold">
                    Gas Paid in USDC
                  </h4>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Built on Arc Network, all transaction fees are paid in USDC
                  instead of native tokens. No need to hold multiple assets or
                  worry about gas token management. Simple and straightforward.
                </p>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20">
        <div className="container mx-auto px-4">
          <div className="grid gap-8 md:grid-cols-3">
            <Card className="border border-white/[0.04] bg-card p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-accent/20">
                <Zap className="h-6 w-6 text-accent" />
              </div>
              <h3 className="mb-2 font-display text-xl font-semibold">
                Stablecoin Gas
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Pay transaction fees in USDC instead of native tokens. No need
                to hold multiple assets or worry about gas tokens.
              </p>
            </Card>

            <Card className="border border-white/[0.04] bg-card p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-accent/20">
                <Shield className="h-6 w-6 text-accent" />
              </div>
              <h3 className="mb-2 font-display text-xl font-semibold">
                Walletless Onboarding
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Recipients can claim gifts using just email or social login.
                Create a wallet automatically or connect their existing one.
              </p>
            </Card>

            <Card className="border border-white/[0.04] bg-card p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-accent/20">
                <Lock className="h-6 w-6 text-accent" />
              </div>
              <h3 className="mb-2 font-display text-xl font-semibold">
                Privacy & Compliance
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Choose between private (targeted) or public (first-claim) gifts.
                Built-in compliance features for peace of mind.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <Card className="border border-accent/20 bg-gradient-to-br from-accent/5 to-accent-2/5 p-12 text-center">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">
              Ready to send your first gift?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Join thousands using GiftLink to send money securely and
              effortlessly.
            </p>
            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:justify-center">
              <Button
                size="lg"
                className="bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={() => navigate("/app")}
              >
                Get Started
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a
                  href="https://docs.arc.network"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Build on Arc
                </a>
              </Button>
            </div>
          </Card>
        </div>
      </section>

      <Footer />

      {/* Claim Demo Dialog */}
      <Dialog open={showClaimDemo} onOpenChange={setShowClaimDemo}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0">
          <div className="px-6 pt-6 pb-4 flex-shrink-0">
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">
                How It Works
              </DialogTitle>
              <DialogDescription className="text-base">
                Here's how the walletless claiming process works for recipients
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="custom-scrollbar flex-1 overflow-y-auto px-6">
            <div className="space-y-6 pr-4 pb-4">
              {/* Step 1: Authentication Options */}
              <div className="space-y-3">
                <h3 className="font-semibold text-lg">
                  1. Choose how to sign in
                </h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Card className="border border-white/[0.04] bg-card p-4 text-center">
                    <div className="mb-2 flex justify-center">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/20">
                        <Mail className="h-5 w-5 text-accent" />
                      </div>
                    </div>
                    <p className="text-sm font-medium">Email</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Sign in with email
                    </p>
                  </Card>
                  <Card className="border border-white/[0.04] bg-card p-4 text-center">
                    <div className="mb-2 flex justify-center">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/20">
                        <svg
                          className="h-5 w-5 text-accent"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                        >
                          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                        </svg>
                      </div>
                    </div>
                    <p className="text-sm font-medium">X (Twitter)</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Connect with X
                    </p>
                  </Card>
                  <Card className="border border-white/[0.04] bg-card p-4 text-center">
                    <div className="mb-2 flex justify-center">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/20">
                        <Wallet className="h-5 w-5 text-accent" />
                      </div>
                    </div>
                    <p className="text-sm font-medium">Wallet</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Connect existing wallet
                    </p>
                  </Card>
                </div>
              </div>

              {/* Step 2: Auto Wallet Creation */}
              <div className="space-y-3">
                <h3 className="font-semibold text-lg">
                  2. Wallet created automatically
                </h3>
                <Card className="border border-accent/20 bg-accent/5 p-4">
                  <div className="flex items-start gap-3">
                    <Sparkles className="mt-0.5 h-5 w-5 text-accent" />
                    <div>
                      <p className="text-sm font-medium">
                        No wallet? No problem!
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        If they sign in with email or social, we automatically
                        create a secure wallet for them. They can connect their
                        own wallet later if they prefer.
                      </p>
                    </div>
                  </div>
                </Card>
              </div>

              {/* Step 3: Instant Claim */}
              <div className="space-y-3">
                <h3 className="font-semibold text-lg">
                  3. Gift claimed instantly
                </h3>
                <Card className="border border-white/[0.04] bg-card p-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <div>
                      <p className="text-sm font-medium">
                        USDC transferred to their wallet
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        The gift amount is instantly available. Gas fees are
                        paid in USDC, so no need for native tokens.
                      </p>
                    </div>
                  </div>
                </Card>
              </div>

              {/* Key Benefits */}
              <div className="rounded-lg border border-accent/20 bg-gradient-to-br from-accent/5 to-accent-2/5 p-4">
                <p className="text-sm font-semibold mb-2">Key Benefits:</p>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <span className="text-accent">•</span>
                    <span>No crypto knowledge required</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-accent">•</span>
                    <span>Works with any email or social account</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-accent">•</span>
                    <span>Gas fees paid in USDC (no native tokens needed)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-accent">•</span>
                    <span>Secure and instant transfers</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 p-6 border-t flex-shrink-0">
            <Button variant="outline" onClick={() => setShowClaimDemo(false)}>
              Got it
            </Button>
            <Button
              className="bg-accent text-accent-foreground hover:bg-accent/90"
              onClick={() => {
                setShowClaimDemo(false);
                navigate("/app");
              }}
            >
              Create Your First Gift
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
