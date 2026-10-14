/**
 * Create gift page
 */

import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Gift, Users, Mail, Hash, AtSign, Info } from "lucide-react";
import { MainLayout } from "@/components/MainLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { useCreateDrop, useCreateDropPrivy } from "@/hooks/useCreateDrop";
import * as api from "@/services/api";
import { useClipboard } from "@/hooks/useClipboard";
import { useAuth } from "@/hooks/useAuth";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { WalletSelector } from "@/components/WalletSelector";
import { useAccount, useSwitchChain } from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import { ensureArcNetwork } from "@/lib/chainUtils";
import { network } from "@/config/network";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/Loader";
import type { RecipientType } from "@/types/gift";
import { formatUnits } from "viem";

const ARC_CHAIN_ID = network.chainId;

export default function Create() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialType = searchParams.get("type") === "open" ? "open" : "targeted";

  const { user, wallets: authWallets } = useAuth();
  const createDropExternal = useCreateDrop();
  const createDropPrivy = useCreateDropPrivy();
  const { copyToClipboard } = useClipboard();
  const {
    wallets: walletBalances,
    isLoading: isBalanceLoading,
    refresh: refreshBalance,
  } = useWalletBalances();
  const { address: activeAddress, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { wallets } = useWallets();

  const [giftType, setGiftType] = useState<"targeted" | "open">(initialType);
  const [recipientType, setRecipientType] = useState<RecipientType>("email");
  const [recipientValue, setRecipientValue] = useState("");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [expiryDays, setExpiryDays] = useState("7");
  const [selectedWallet, setSelectedWallet] = useState<string | undefined>();

  const [showSuccess, setShowSuccess] = useState(false);
  const [claimLink, setClaimLink] = useState("");
  const [gasTankAmount, setGasTankAmount] = useState<string | null>(null);
  const [isLoadingGasTank, setIsLoadingGasTank] = useState(false);

  // Get balance for selected wallet, or first enabled wallet
  const selectedWalletBalance = walletBalances.find(
    (w) => w.address === selectedWallet
  );
  const balance = selectedWalletBalance?.balance || "0.00";

  // Calculate total cost (amount + gasTankAmount)
  const totalCost =
    gasTankAmount && amount
      ? (parseFloat(amount) + parseFloat(gasTankAmount)).toFixed(2)
      : null;

  // Auto-select first enabled wallet if none selected
  useEffect(() => {
    if (!selectedWallet && walletBalances.length > 0) {
      const firstEnabled = walletBalances.find((w) => w.isEnabled);
      if (firstEnabled) {
        setSelectedWallet(firstEnabled.address);
      }
    }
  }, [walletBalances, selectedWallet]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!amount || parseFloat(amount) < 1) {
      toast({
        title: "Invalid amount",
        description: "Minimum amount is 1 USDC",
        variant: "destructive",
      });
      return;
    }

    // Check if we have gasTankAmount loaded
    if (!gasTankAmount) {
      toast({
        title: "Loading...",
        description: "Please wait while we calculate the gas reserve",
        variant: "default",
      });
      return;
    }

    // Check total cost (amount + gasTankAmount) against balance
    const totalCostValue = parseFloat(amount) + parseFloat(gasTankAmount);
    if (totalCostValue > parseFloat(balance)) {
      toast({
        title: "Insufficient balance",
        description: `Total cost (${totalCostValue.toFixed(
          2
        )} USDC) exceeds available balance`,
        variant: "destructive",
      });
      return;
    }

    if (giftType === "targeted" && !recipientValue) {
      toast({
        title: "Recipient required",
        description: "Please specify a recipient",
        variant: "destructive",
      });
      return;
    }

    if (!selectedWallet) {
      toast({
        title: "Wallet required",
        description: "Please select a wallet to use for this transaction",
        variant: "destructive",
      });
      return;
    }

    const selectedWalletDataCheck = walletBalances.find(
      (w) => w.address === selectedWallet
    );
    if (!selectedWalletDataCheck || !selectedWalletDataCheck.isEnabled) {
      toast({
        title: "Invalid wallet",
        description: "Selected wallet has insufficient balance",
        variant: "destructive",
      });
      return;
    }

    // Check if wallet is external (not Privy embedded)
    const isExternalWallet = selectedWalletDataCheck.walletType === "external";

    // Ensure user is on Arc Network (only for external wallets)
    if (isExternalWallet && switchChain) {
      const isOnArc = await ensureArcNetwork(
        () =>
          switchChain(
            { chainId: ARC_CHAIN_ID },
            {
              onError: (error) =>
                console.error("Failed to switch chain:", error instanceof Error ? error.message : "Unknown error"),
            }
          ),
        () => chainId, // Function to get current chain ID
        isExternalWallet
      );

      if (!isOnArc) {
        // User needs to switch network - abort the transaction
        return;
      }
    }

    const selectedWalletData = walletBalances.find(
      (w) => w.address === selectedWallet
    );

    // Determine which hook to use based on wallet type
    const isPrivyWallet = selectedWalletData.walletType === "privy";
    const createDropHook = isPrivyWallet ? createDropPrivy : createDropExternal;

    // Calculate expiry timestamp
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + parseInt(expiryDays));
    const expiry = Math.floor(expiryDate.getTime() / 1000);

    // USDC contract details
    // NOTE: USDC ERC-20 interface uses 6 decimals per Arc Network docs
    // https://docs.arc.network/arc/references/contract-addresses
    const USDC_CONTRACT_ADDRESS = network.usdcAddress;
    const USDC_DECIMALS = 6;
    const USDC_SYMBOL = "USDC";

    // Map recipient type from old format to new format
    const recipientTypeMap: Record<
      string,
      "public" | "email" | "discord" | "twitter"
    > = {
      public: "public",
      email: "email",
      discord: "discord",
      twitter: "twitter",
      x: "twitter", // Map "x" to "twitter"
    };

    const newRecipientType =
      giftType === "targeted"
        ? recipientTypeMap[recipientType] || "email"
        : "public";

    const payload = {
      recipientType: newRecipientType,
      recipientIdentifier: giftType === "targeted" ? recipientValue : "public",
      amount,
      tokenAddress: USDC_CONTRACT_ADDRESS,
      tokenSymbol: USDC_SYMBOL,
      tokenDecimals: USDC_DECIMALS,
      expiry,
      message: message || undefined,
      fundingSource: selectedWallet as string,
      senderAddress: selectedWallet as string,
      walletType: selectedWalletData?.walletType || "external",
    };

    try {
      const result = await createDropHook.createDrop(
        payload,
        selectedWallet as `0x${string}`
      );

      if (result) {
        // Generate claim link
        const claimLink = `${window.location.origin}/claim/${result.dropId}`;
        setClaimLink(claimLink);
        setShowSuccess(true);
        toast({
          title: "Gift created!",
          description: "Your gift link is ready to share",
        });
        // Refresh balance after creating gift (funds deducted)
        refreshBalance();
      }
    } catch (error: unknown) {
      console.error("Failed to create drop:", error instanceof Error ? error.message : "Unknown error");
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Could not create the gift. Please try again.";
      toast({
        title: "Failed to create gift",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleCopyLink = () => {
    copyToClipboard(claimLink, "Claim link copied!");
  };

  const handleReset = () => {
    setShowSuccess(false);
    setRecipientValue("");
    setAmount("");
    setMessage("");
    setGasTankAmount(null);
    navigate("/dashboard");
  };

  // Fetch gasTankAmount from backend when amount changes
  const fetchGasTankAmount = async (amountValue: string) => {
    if (!amountValue || parseFloat(amountValue) <= 0) {
      setGasTankAmount(null);
      return;
    }

    // For targeted gifts, require recipient identifier
    if (giftType === "targeted" && !recipientValue) {
      toast({
        title: "Recipient required",
        description:
          "Please enter a recipient identifier before calculating gas reserve",
        variant: "destructive",
      });
      setGasTankAmount(null);
      return;
    }

    if (!selectedWallet) return;

    setIsLoadingGasTank(true);
    try {
      // Calculate expiry timestamp
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + parseInt(expiryDays));
      const expiry = Math.floor(expiryDate.getTime() / 1000);

      // USDC contract details
      const USDC_CONTRACT_ADDRESS = network.usdcAddress;
      const USDC_DECIMALS = 6;
      const USDC_SYMBOL = "USDC";

      // Map recipient type
      const recipientTypeMap: Record<
        string,
        "public" | "email" | "discord" | "twitter"
      > = {
        public: "public",
        email: "email",
        discord: "discord",
        twitter: "twitter",
        x: "twitter",
      };

      const newRecipientType =
        giftType === "targeted"
          ? recipientTypeMap[recipientType] || "email"
          : "public";

      const selectedWalletData = walletBalances.find(
        (w) => w.address === selectedWallet
      );
      const walletType = selectedWalletData?.walletType || "external";

      const payload = {
        recipientType: newRecipientType,
        recipientIdentifier:
          giftType === "targeted" ? recipientValue : "public",
        amount: amountValue,
        tokenAddress: USDC_CONTRACT_ADDRESS,
        tokenSymbol: USDC_SYMBOL,
        tokenDecimals: USDC_DECIMALS,
        expiry,
        message: message || undefined,
        fundingSource: selectedWallet,
        senderAddress: selectedWallet,
        walletType,
      };

      const prepareResult = await api.prepareDrop(payload);
      // Backend returns gasTankAmount in wei format (6 decimals for USDC ERC-20)
      setGasTankAmount(
        formatUnits(
          BigInt(prepareResult.gasTankAmount as `0x${string}`),
          USDC_DECIMALS
        )
      );
    } catch (error) {
      console.error("Failed to fetch gas tank amount:", error instanceof Error ? error.message : "Unknown error");
      // Don't show error to user, just keep gasTankAmount as null
    } finally {
      setIsLoadingGasTank(false);
    }
  };

  return (
    <MainLayout>
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <Button
          variant="ghost"
          className="mb-6"
          onClick={() => navigate("/dashboard")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Dashboard
        </Button>

        <div className="mb-6">
          <h1 className="font-display text-3xl font-bold">Create GiftLink</h1>
          <p className="mt-2 text-muted-foreground">
            Send USDC with a secure claim link
          </p>
        </div>

        <Card className="border border-white/[0.04] bg-card p-6 sm:p-8">
          <Tabs
            value={giftType}
            onValueChange={(v) => setGiftType(v as "targeted" | "open")}
          >
            <TabsList className="mb-8 grid w-full grid-cols-2">
              <TabsTrigger value="targeted" className="gap-2">
                <Gift className="h-4 w-4" />
                Targeted
              </TabsTrigger>
              <TabsTrigger value="open" className="gap-2">
                <Users className="h-4 w-4" />
                Open
              </TabsTrigger>
            </TabsList>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Recipient (Targeted only) */}
              <TabsContent value="targeted" className="mt-0 space-y-6">
                <div className="space-y-2">
                  <Label>Recipient Type</Label>
                  <Select
                    value={recipientType}
                    onValueChange={(v) => setRecipientType(v as RecipientType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">
                        <div className="flex items-center gap-2">
                          <Mail className="h-4 w-4" />
                          Email
                        </div>
                      </SelectItem>
                      <SelectItem value="twitter">
                        <div className="flex items-center gap-2">
                          <AtSign className="h-4 w-4" />X (Twitter)
                        </div>
                      </SelectItem>
                      <SelectItem value="discord">
                        <div className="flex items-center gap-2">
                          <Hash className="h-4 w-4" />
                          Discord
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Recipient Identifier</Label>
                  <Input
                    type="text"
                    placeholder={
                      recipientType === "email"
                        ? "recipient@example.com"
                        : recipientType === "discord"
                        ? "username"
                        : "@username"
                    }
                    value={recipientValue}
                    onChange={(e) => setRecipientValue(e.target.value)}
                    onBlur={() => {
                      // When recipient identifier is entered, fetch gasTankAmount if amount is set
                      if (
                        giftType === "targeted" &&
                        recipientValue &&
                        amount &&
                        parseFloat(amount) > 0
                      ) {
                        fetchGasTankAmount(amount);
                      } else if (giftType === "targeted" && !recipientValue) {
                        // Clear gasTankAmount if recipient identifier is removed
                        setGasTankAmount(null);
                      }
                    }}
                    required={giftType === "targeted"}
                  />
                </div>
              </TabsContent>

              <TabsContent value="open" className="mt-0">
                <div className="rounded-lg border border-accent/20 bg-accent/5 p-4">
                  <p className="text-sm">
                    <strong>Open Gift:</strong> Anyone with the claim link can
                    redeem this gift. First come, first served.
                  </p>
                </div>
              </TabsContent>

              {/* Wallet Selection */}
              <WalletSelector
                wallets={walletBalances}
                selectedWallet={selectedWallet}
                onSelectWallet={setSelectedWallet}
                isLoading={isBalanceLoading}
              />

              {/* Amount */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Amount</Label>
                  <span className="text-xs text-muted-foreground">
                    {isBalanceLoading
                      ? "Loading balance..."
                      : `Balance: ${parseFloat(balance).toFixed(2)} USDC`}
                  </span>
                </div>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.01"
                    min="1"
                    placeholder="1.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onBlur={() => {
                      // For targeted gifts, only fetch if recipient identifier is set
                      if (amount && parseFloat(amount) > 0) {
                        if (giftType === "targeted" && !recipientValue) {
                          // Don't fetch for targeted gifts without recipient identifier
                          // User will trigger fetch when they enter recipient identifier
                          return;
                        }
                        fetchGasTankAmount(amount);
                      } else {
                        setGasTankAmount(null);
                      }
                    }}
                    className="pr-20"
                    required
                  />
                  <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-accent hover:text-accent"
                      onClick={() => {
                        setAmount(balance);
                        // For targeted gifts, only fetch if recipient identifier is set
                        if (balance && parseFloat(balance) > 0) {
                          if (giftType === "targeted" && !recipientValue) {
                            // Don't fetch for targeted gifts without recipient identifier
                            // User will trigger fetch when they enter recipient identifier
                            return;
                          }
                          fetchGasTankAmount(balance);
                        }
                      }}
                      disabled={isBalanceLoading}
                    >
                      MAX
                    </Button>
                    <span className="text-sm text-muted-foreground">USDC</span>
                  </div>
                </div>

                {/* Loading state while fetching gasTankAmount */}
                {isLoadingGasTank && amount && parseFloat(amount) > 0 && (
                  <div className="rounded-lg border border-white/[0.04] bg-surface/50 p-4">
                    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                      <Spinner className="h-4 w-4" />
                      <span>Calculating gas reserve...</span>
                    </div>
                  </div>
                )}

                {/* Gas Reserve and Total Cost Display */}
                {!isLoadingGasTank &&
                  gasTankAmount &&
                  amount &&
                  parseFloat(amount) > 0 && (
                    <div className="rounded-lg border border-white/[0.04] bg-surface/50 p-4 space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          Recipient gets:
                        </span>
                        <span className="font-medium">
                          {parseFloat(amount).toFixed(2)} USDC
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          Gas reserve:
                        </span>
                        <span className="font-medium">
                          {gasTankAmount} USDC
                        </span>
                      </div>
                      <div className="border-t border-white/[0.04] pt-2 flex items-center justify-between text-sm font-semibold">
                        <span>Total cost:</span>
                        <span>{totalCost} USDC</span>
                      </div>
                    </div>
                  )}
              </div>

              {/* Message */}
              <div className="space-y-2">
                <Label>
                  Message{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  placeholder="Add a short note (happy birthday, congrats, etc.)"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={280}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground text-right">
                  {message.length}/280
                </p>
              </div>

              {/* Expiry */}
              <div className="space-y-2">
                <Label>Expires In</Label>
                <Select value={expiryDays} onValueChange={setExpiryDays}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 day</SelectItem>
                    <SelectItem value="3">3 days</SelectItem>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Submit */}
              <Button
                type="submit"
                size="lg"
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                disabled={
                  createDropExternal.isLoading || createDropPrivy.isLoading
                }
              >
                {createDropExternal.isLoading || createDropPrivy.isLoading ? (
                  <>
                    <Spinner className="mr-2 h-4 w-4" />
                    Creating...
                  </>
                ) : (
                  "Generate GiftLink"
                )}
              </Button>
            </form>
          </Tabs>
        </Card>
      </div>

      {/* Success Modal */}
      <Dialog open={showSuccess} onOpenChange={setShowSuccess}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-2xl">🎉 Gift Created!</DialogTitle>
            <DialogDescription>
              Your gift link is ready to share
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border border-white/[0.04] bg-surface p-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Claim Link
              </p>
              <p className="break-all text-sm font-mono">{claimLink}</p>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleCopyLink} className="flex-1">
                Copy Link
              </Button>
              <Button
                onClick={handleReset}
                variant="outline"
                className="flex-1"
              >
                View Dashboard
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
