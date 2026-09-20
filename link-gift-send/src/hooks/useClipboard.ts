/**
 * Clipboard hook for copying text
 */

import { useState } from 'react';
import { toast } from '@/hooks/use-toast';

export function useClipboard() {
  const [isCopied, setIsCopied] = useState(false);

  const copyToClipboard = async (text: string, successMessage = 'Copied to clipboard!') => {
    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      toast({
        title: 'Success',
        description: successMessage,
      });
      
      // Reset after 2 seconds
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to copy to clipboard',
        variant: 'destructive',
      });
    }
  };

  return { copyToClipboard, isCopied };
}
