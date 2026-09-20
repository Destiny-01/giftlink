/**
 * Settings page
 */

import { useState, useMemo } from "react";
import { MainLayout } from "@/components/MainLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { usePrivy } from "@privy-io/react-auth";
import { usePublicClient } from "wagmi";
import {
  Link2,
  Wallet,
  Mail,
  Loader2,
  AlertCircle,
  ArrowRight,
  Copy,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useClipboard } from "@/hooks/useClipboard";
import { parseUnits, encodeFunctionData } from "viem";
import { ERC20BalanceABI } from "@/lib/abi";

const USDC_CONTRACT_ADDRESS = (import.meta.env.VITE_USDC_CONTRACT_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

const USDC_DECIMALS = 6;

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export default function Settings() {
  const { privyUser, wallets, linkAccount, isAuthenticated } = useAuth();
  const { sendTransaction } = usePrivy();
  const publicClient = usePublicClient();
  const { wallets: walletBalances, refresh: refreshBalances } =
    useWalletBalances();
  const { toast } = useToast();
  const { copyToClipboard } = useClipboard();
  const [linkingAccount, setLinkingAccount] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [selectedWithdrawWallet, setSelectedWithdrawWallet] =
    useState<string>("");
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const hasTwitter = !!privyUser?.twitter;
  const hasDiscord = !!privyUser?.discord;
  const hasEmail = !!privyUser?.email;
  const linkedWallets = wallets || [];

  const privyWallet = useMemo(() => {
    return wallets.find((w) => w.walletClientType === "privy");
  }, [wallets]);

  const privyWalletBalance = useMemo(() => {
    if (!privyWallet?.address) return null;
    return walletBalances.find((w) => w.address === privyWallet.address);
  }, [privyWallet, walletBalances]);

  const externalWallets = useMemo(() => {
    return wallets.filter((w) => w.walletClientType !== "privy");
  }, [wallets]);

  const handleLinkAccount = async (
    type: "wallet" | "oauth",
    provider?: "x" | "discord" | "email"
  ) => {
    if (!isAuthenticated) {
      toast({
        title: "Authentication required",
        description: "Please log in to link accounts",
        variant: "destructive",
      });
      return;
    }

    const accountKey = type === "wallet" ? "wallet" : provider || "";
    setLinkingAccount(accountKey);
    setError(null);

    try {
      await linkAccount(type, provider);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to link account";
      setError(errorMessage);
      toast({
        title: "Failed to link account",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLinkingAccount(null);
    }
  };

  const handleWithdraw = async () => {
    if (!privyWallet?.address || !sendTransaction) {
      toast({
        title: "Error",
        description: "Privy embedded wallet not available",
        variant: "destructive",
      });
      return;
    }

    if (!selectedWithdrawWallet) {
      toast({
        title: "Error",
        description: "Please select a wallet to withdraw to",
        variant: "destructive",
      });
      return;
    }

    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid amount greater than 0",
        variant: "destructive",
      });
      return;
    }

    if (
      !privyWalletBalance ||
      parseFloat(privyWalletBalance.balance) < amount
    ) {
      toast({
        title: "Insufficient balance",
        description: `Available balance: ${
          privyWalletBalance?.balance || "0.00"
        } USDC`,
        variant: "destructive",
      });
      return;
    }

    setIsWithdrawing(true);
    setError(null);

    try {
      if (!publicClient) {
        throw new Error("Public client not available");
      }

      if (!privyWallet.address) {
        throw new Error("Privy wallet address not available");
      }

      const amountWei = parseUnits(withdrawAmount, USDC_DECIMALS);

      const transferData = encodeFunctionData({
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [selectedWithdrawWallet as `0x${string}`, amountWei],
      });

      const estimatedGas = await publicClient.estimateGas({
        account: privyWallet.address as `0x${string}`,
        to: USDC_CONTRACT_ADDRESS,
        data: transferData,
      });

      const gasLimit = (estimatedGas * 120n) / 100n;

      const tx = await sendTransaction({
        to: USDC_CONTRACT_ADDRESS,
        data: transferData,
        gasLimit: gasLimit,
      } as Parameters<typeof sendTransaction>[0] & { gasLimit: string });

      toast({
        title: "Withdrawal Successful",
        description: `Transaction successful: ${tx.hash.substring(
          0,
          6
        )}...${tx.hash.substring(tx.hash.length - 6)}`,
      });

      setWithdrawAmount("");
      setSelectedWithdrawWallet("");

      setTimeout(() => {
        refreshBalances();
      }, 2000);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to withdraw";
      setError(errorMessage);
      toast({
        title: "Withdrawal failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsWithdrawing(false);
    }
  };

  return (
    <MainLayout>
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold">Settings</h1>
          <p className="mt-2 text-muted-foreground">
            Manage your account and preferences
          </p>
        </div>

        <div className="space-y-6">
          {/* Linked Accounts */}
          <Card className="border border-white/[0.04] bg-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <Link2 className="h-5 w-5 text-accent" />
              <h2 className="font-display text-xl font-semibold">
                Linked Accounts
              </h2>
            </div>

            <div className="space-y-4">
              {/* Linked Wallets */}
              {linkedWallets.length > 0 ? (
                linkedWallets.map((wallet, index) => (
                  <div
                    key={wallet.address || index}
                    className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-surface/50 p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/20">
                        <Wallet className="h-5 w-5 text-accent" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">
                          {wallet.walletClientType === "privy"
                            ? "Embedded Wallet"
                            : "External Wallet"}
                        </p>
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-muted-foreground">
                            {wallet.address
                              ? `${wallet.address.slice(
                                  0,
                                  10
                                )}...${wallet.address.slice(-8)}`
                              : "Unknown address"}
                          </p>
                          {wallet.address && (
                            <button
                              onClick={() =>
                                copyToClipboard(
                                  wallet.address!,
                                  "Wallet address copied!"
                                )
                              }
                              className="flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-surface hover:text-foreground transition-colors"
                              title="Copy full address"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className="border-success/30 bg-success/20 text-success"
                    >
                      Connected
                    </Badge>
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-surface/50 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/20">
                      <Wallet className="h-5 w-5 text-accent" />
                    </div>
                    <div>
                      <p className="font-medium">Wallet</p>
                      <p className="text-sm text-muted-foreground">
                        Not connected
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleLinkAccount("wallet")}
                    disabled={linkingAccount === "wallet"}
                  >
                    {linkingAccount === "wallet" ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Linking...
                      </>
                    ) : (
                      "Link Wallet"
                    )}
                  </Button>
                </div>
              )}

              {/* Link Additional Wallet */}
              {linkedWallets.length > 0 && (
                <div className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-surface/50 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                      <Wallet className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium">Link Additional Wallet</p>
                      <p className="text-sm text-muted-foreground">
                        Connect another wallet
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleLinkAccount("wallet")}
                    disabled={linkingAccount === "wallet"}
                  >
                    {linkingAccount === "wallet" ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Linking...
                      </>
                    ) : (
                      "Link Wallet"
                    )}
                  </Button>
                </div>
              )}

              {/* Error message */}
              {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  <span>{error}</span>
                </div>
              )}

              {/* X (Twitter) Account */}
              <div className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-surface/50 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <Mail className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium">X (Twitter)</p>
                    {hasTwitter ? (
                      <p className="text-sm text-muted-foreground">
                        {privyUser?.twitter?.username || "Connected"}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Not connected
                      </p>
                    )}
                  </div>
                </div>
                {hasTwitter ? (
                  <Badge
                    variant="outline"
                    className="border-success/30 bg-success/20 text-success"
                  >
                    Connected
                  </Badge>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleLinkAccount("oauth", "x")}
                    disabled={linkingAccount === "x"}
                  >
                    {linkingAccount === "x" ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Linking...
                      </>
                    ) : (
                      "Connect"
                    )}
                  </Button>
                )}
              </div>

              {/* Discord Account */}
              <div className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-surface/50 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <Mail className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium">Discord</p>
                    {hasDiscord ? (
                      <p className="text-sm text-muted-foreground">
                        {privyUser?.discord?.username || "Connected"}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Not connected
                      </p>
                    )}
                  </div>
                </div>
                {hasDiscord ? (
                  <Badge
                    variant="outline"
                    className="border-success/30 bg-success/20 text-success"
                  >
                    Connected
                  </Badge>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleLinkAccount("oauth", "discord")}
                    disabled={linkingAccount === "discord"}
                  >
                    {linkingAccount === "discord" ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Linking...
                      </>
                    ) : (
                      "Connect"
                    )}
                  </Button>
                )}
              </div>

              {/* Email Account */}
              <div className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-surface/50 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <Mail className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium">Email</p>
                    {hasEmail ? (
                      <p className="text-sm text-muted-foreground">
                        {privyUser?.email?.address || "Connected"}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Not connected
                      </p>
                    )}
                  </div>
                </div>
                {hasEmail ? (
                  <Badge
                    variant="outline"
                    className="border-success/30 bg-success/20 text-success"
                  >
                    Connected
                  </Badge>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleLinkAccount("oauth", "email")}
                    disabled={linkingAccount === "email"}
                  >
                    {linkingAccount === "email" ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Linking...
                      </>
                    ) : (
                      "Connect"
                    )}
                  </Button>
                )}
              </div>
            </div>
          </Card>

          {/* Withdraw from Embedded Wallet */}
          {privyWallet && (
            <Card className="border border-white/[0.04] bg-card p-6">
              <div className="mb-4 flex items-center gap-2">
                <ArrowRight className="h-5 w-5 text-accent" />
                <h2 className="font-display text-xl font-semibold">
                  Withdraw from Embedded Wallet
                </h2>
              </div>

              <div className="space-y-4">
                {/* Balance display */}
                <div className="rounded-lg border border-white/[0.04] bg-surface/50 p-4">
                  <Label className="text-sm text-muted-foreground">
                    Available Balance
                  </Label>
                  <p className="mt-1 font-display text-2xl font-bold">
                    {privyWalletBalance?.balance || "0.00"} USDC
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">
                      {privyWallet.address.slice(0, 10)}...
                      {privyWallet.address.slice(-8)}
                    </p>
                    <button
                      onClick={() =>
                        copyToClipboard(
                          privyWallet.address,
                          "Wallet address copied!"
                        )
                      }
                      className="flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-surface hover:text-foreground transition-colors"
                      title="Copy full address"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {/* Withdrawal form */}
                {externalWallets.length > 0 ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="withdraw-amount">Amount (USDC)</Label>
                      <Input
                        id="withdraw-amount"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(e.target.value)}
                        disabled={
                          isWithdrawing ||
                          !privyWalletBalance ||
                          parseFloat(privyWalletBalance.balance) === 0
                        }
                      />
                      {privyWalletBalance &&
                        parseFloat(privyWalletBalance.balance) > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() =>
                              setWithdrawAmount(privyWalletBalance.balance)
                            }
                            disabled={isWithdrawing}
                          >
                            Max: {privyWalletBalance.balance} USDC
                          </Button>
                        )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="withdraw-wallet">
                        Withdraw to Wallet
                      </Label>
                      <Select
                        value={selectedWithdrawWallet}
                        onValueChange={setSelectedWithdrawWallet}
                        disabled={
                          isWithdrawing ||
                          !privyWalletBalance ||
                          parseFloat(privyWalletBalance.balance) === 0
                        }
                      >
                        <SelectTrigger id="withdraw-wallet">
                          <SelectValue placeholder="Select a wallet" />
                        </SelectTrigger>
                        <SelectContent>
                          {externalWallets.map((wallet) => (
                            <SelectItem
                              key={wallet.address}
                              value={wallet.address || ""}
                            >
                              <div className="flex items-center gap-2">
                                <Wallet className="h-4 w-4" />
                                <span>
                                  {wallet.address
                                    ? `${wallet.address.slice(
                                        0,
                                        6
                                      )}...${wallet.address.slice(-4)}`
                                    : "Unknown"}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {error && (
                      <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                        <AlertCircle className="h-4 w-4" />
                        <span>{error}</span>
                      </div>
                    )}

                    <Button
                      onClick={handleWithdraw}
                      disabled={
                        isWithdrawing ||
                        !privyWalletBalance ||
                        parseFloat(privyWalletBalance.balance) === 0 ||
                        !withdrawAmount ||
                        !selectedWithdrawWallet ||
                        parseFloat(withdrawAmount) <= 0
                      }
                      className="w-full"
                    >
                      {isWithdrawing ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Withdrawing...
                        </>
                      ) : (
                        <>
                          <ArrowRight className="mr-2 h-4 w-4" />
                          Withdraw
                        </>
                      )}
                    </Button>

                    {privyWalletBalance &&
                      parseFloat(privyWalletBalance.balance) === 0 && (
                        <p className="text-center text-xs text-muted-foreground">
                          No balance available to withdraw
                        </p>
                      )}
                  </>
                ) : (
                  <div className="rounded-lg border border-white/[0.04] bg-surface/50 p-4 text-center">
                    <p className="text-sm text-muted-foreground">
                      Link an external wallet to withdraw funds
                    </p>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
