/**
 * Authentication gate - sends signed-in users to their post-login destination.
 */

import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Wallet, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { FullPageLoader } from "@/components/Loader";
import { safeNextPath } from "@/lib/nextPath";

export default function AuthGate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Attacker-controllable via a shared link, so it is only honoured when it is a same-origin
  // relative path; otherwise this is the Inbox.
  const next = safeNextPath(searchParams.get("next"));
  const { isAuthenticated, isLoading, connectWallet, signInWithEmail } =
    useAuth();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate(next, { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate, next]);

  if (isLoading) {
    return <FullPageLoader />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border border-white/[0.04] bg-card p-8">
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl font-bold">Welcome to Nomine</h1>
          <p className="mt-2 text-muted-foreground">
            Sign in with the email your Claim was sent to.
          </p>
        </div>

        <div className="space-y-4">
          <Button
            size="lg"
            className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
            onClick={signInWithEmail}
          >
            <Mail className="mr-2 h-5 w-5" />
            Continue with email
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-white/[0.04]" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or</span>
            </div>
          </div>

          <Button
            variant="outline"
            size="lg"
            className="w-full"
            onClick={connectWallet}
          >
            <Wallet className="mr-2 h-5 w-5" />
            Continue with a wallet
          </Button>
        </div>
      </Card>
    </div>
  );
}
