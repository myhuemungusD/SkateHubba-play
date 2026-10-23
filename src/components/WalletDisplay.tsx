/**
 * Wallet balance display — shows Hubba Bucks with earned/bought breakdown.
 * Plan §2 wallet design: one balance on screen, separate ledger tracking.
 */
import { Coins } from "lucide-react";
import type { WalletBalance } from "../services/closet.wallet";

interface Props {
  balance: WalletBalance;
  showBreakdown?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASSES = {
  sm: { icon: 14, text: "text-xs", subtext: "text-label" },
  md: { icon: 18, text: "text-sm", subtext: "text-xs" },
  lg: { icon: 24, text: "text-lg", subtext: "text-sm" },
};

export function WalletDisplay({ balance, showBreakdown = false, size = "md", className = "" }: Props) {
  const styles = SIZE_CLASSES[size];

  return (
    <div className={`flex items-center gap-2 ${className}`} data-testid="wallet-display">
      <Coins size={styles.icon} className="text-yellow-500" aria-hidden="true" />
      <div>
        <p className={`font-display ${styles.text} text-white leading-tight`} data-testid="wallet-balance">
          {balance.balance.toLocaleString()}
          <span className="text-subtle ml-1">Bucks</span>
        </p>
        {showBreakdown && (balance.earnedBal > 0 || balance.boughtBal > 0) && (
          <p className={`font-body ${styles.subtext} text-subtle`} data-testid="wallet-breakdown">
            {balance.earnedBal > 0 && `${balance.earnedBal.toLocaleString()} earned`}
            {balance.earnedBal > 0 && balance.boughtBal > 0 && " · "}
            {balance.boughtBal > 0 && `${balance.boughtBal.toLocaleString()} bought`}
          </p>
        )}
      </div>
    </div>
  );
}
