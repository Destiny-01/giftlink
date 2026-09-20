/**
 * Quick create gift card
 */

import { Gift, Users } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

export function CreateGiftCard() {
  const navigate = useNavigate();

  return (
    <Card className="border border-white/[0.04] bg-gradient-to-br from-accent/5 to-accent-2/5 p-6">
      <h3 className="font-display text-xl font-semibold">Create New Gift</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        Send USDC with a secure claim link
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Button
          onClick={() => navigate('/create?type=targeted')}
          variant="outline"
          className="h-auto flex-col gap-2 border-accent/20 py-4 hover:bg-accent/10"
        >
          <Gift className="h-6 w-6 text-accent" />
          <div className="text-center">
            <div className="font-semibold">Targeted</div>
            <div className="text-xs text-muted-foreground">Specific recipient</div>
          </div>
        </Button>

        <Button
          onClick={() => navigate('/create?type=open')}
          variant="outline"
          className="h-auto flex-col gap-2 border-accent/20 py-4 hover:bg-accent/10"
        >
          <Users className="h-6 w-6 text-accent" />
          <div className="text-center">
            <div className="font-semibold">Open</div>
            <div className="text-xs text-muted-foreground">First to claim</div>
          </div>
        </Button>
      </div>
    </Card>
  );
}
