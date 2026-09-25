/**
 * Dialog component for editing the recipient of a gift
 */

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import type { Gift, RecipientType } from "@/types/gift";
import { Mail, AtSign, Hash } from "lucide-react";

interface EditReceiverDialogProps {
  gift: Gift | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  onEdit: (
    id: string,
    newRecipientIdentifier: string,
    newRecipientType: string
  ) => Promise<boolean>;
}

export function EditReceiverDialog({
  gift,
  open,
  onOpenChange,
  onSuccess,
  onEdit,
}: EditReceiverDialogProps) {
  const [recipientValue, setRecipientValue] = useState("");
  const [recipientType, setRecipientType] = useState<RecipientType>("email");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when dialog opens/closes or gift changes
  useEffect(() => {
    if (open && gift) {
      setRecipientValue(gift.recipientIdentifier || "");
      setRecipientType(gift.recipientType || "email");
    } else if (!open) {
      setRecipientValue("");
      setRecipientType("email");
    }
  }, [open, gift]);

  // Update placeholder and value when type changes
  useEffect(() => {
    // Clear value when type changes to avoid invalid data
    if (open && gift && recipientType !== gift.recipientType) {
      setRecipientValue("");
    }
  }, [recipientType, open, gift]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!gift) return;

    // Validation
    if (!recipientValue.trim()) {
      toast({
        title: "Recipient required",
        description: "Please enter a recipient",
        variant: "destructive",
      });
      return;
    }

    // Validate and normalize based on selected recipient type
    let normalizedValue = recipientValue.trim();

    if (recipientType === "email") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(normalizedValue)) {
        toast({
          title: "Invalid email",
          description: "Please enter a valid email address",
          variant: "destructive",
        });
        return;
      }
    } else if (recipientType === "twitter") {
      // Remove @ if present and validate
      normalizedValue = normalizedValue.replace(/^@/, "");
      const twitterRegex = /^[a-zA-Z0-9_]{1,15}$/;
      if (!twitterRegex.test(normalizedValue)) {
        toast({
          title: "Invalid Twitter handle",
          description:
            "Please enter a valid Twitter handle (1-15 characters, letters, numbers, and underscores only)",
          variant: "destructive",
        });
        return;
      }
    } else if (recipientType === "discord") {
      // The modern username form. A legacy `name#1234` is still stored, but the backend can no
      // longer authorize it: it requires the identity provider to report that exact value, and
      // providers no longer report discriminators. Steering senders away from it avoids
      // creating a gift its recipient cannot claim.
      if (normalizedValue.length < 2) {
        toast({
          title: "Invalid Discord username",
          description: "Please enter a valid Discord username",
          variant: "destructive",
        });
        return;
      }
    } else if (recipientType === "ens") {
      // ENS names should end with .eth
      if (!normalizedValue.toLowerCase().endsWith(".eth")) {
        toast({
          title: "Invalid ENS name",
          description: "ENS names must end with .eth",
          variant: "destructive",
        });
        return;
      }
      normalizedValue = normalizedValue.toLowerCase();
    }

    setIsSubmitting(true);

    try {
      const success = await onEdit(gift.id, normalizedValue, recipientType);

      if (success) {
        toast({
          title: "Recipient updated",
          description: "The recipient has been successfully updated",
        });
        onSuccess();
        onOpenChange(false);
        setRecipientValue("");
      } else {
        toast({
          title: "Failed to update recipient",
          description: "Could not update the recipient. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error: unknown) {
      console.error("Failed to edit receiver");
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Could not update the recipient. Please try again.";
      toast({
        title: "Failed to update recipient",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!gift) return null;

  // Get placeholder and label based on selected recipient type
  const getRecipientConfig = (type: RecipientType) => {
    switch (type) {
      case "email":
        return {
          label: "Email Address",
          placeholder: "recipient@example.com",
          icon: <Mail className="h-4 w-4" />,
        };
      case "twitter":
        return {
          label: "Twitter Handle",
          placeholder: "username",
          icon: <AtSign className="h-4 w-4" />,
        };
      case "discord":
        return {
          label: "Discord Username",
          placeholder: "username",
          icon: <Hash className="h-4 w-4" />,
        };
      case "ens":
        return {
          label: "ENS Name",
          placeholder: "name.eth",
          icon: <AtSign className="h-4 w-4" />,
        };
      default:
        return {
          label: "Recipient",
          placeholder: "Enter recipient",
          icon: null,
        };
    }
  };

  const currentConfig = getRecipientConfig(gift.recipientType || "email");
  const selectedConfig = getRecipientConfig(recipientType);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Receiver</DialogTitle>
          <DialogDescription>
            Update the recipient type and identifier for this gift
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentRecipient">Current Recipient</Label>
            <div className="flex items-center gap-2 rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground">
              {currentConfig.icon}
              <span>
                {gift.recipientType || "unknown"}:{" "}
                {gift.recipientIdentifier || "Not set"}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="recipientType">Recipient Type</Label>
            <Select
              value={recipientType}
              onValueChange={(v) => setRecipientType(v as RecipientType)}
              disabled={isSubmitting}
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
                <SelectItem value="ens">
                  <div className="flex items-center gap-2">
                    <AtSign className="h-4 w-4" />
                    ENS
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="newRecipient">New {selectedConfig.label}</Label>
            <div className="relative">
              {selectedConfig.icon && (
                <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {selectedConfig.icon}
                </div>
              )}
              <Input
                id="newRecipient"
                type="text"
                placeholder={selectedConfig.placeholder}
                value={recipientValue}
                onChange={(e) => setRecipientValue(e.target.value)}
                className={selectedConfig.icon ? "pl-9" : ""}
                disabled={isSubmitting}
                autoFocus
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                setRecipientValue("");
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Updating..." : "Update Recipient"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
