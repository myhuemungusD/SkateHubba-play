import { ShieldAlert } from "lucide-react";
import { RatingMeter, type RatingProps } from "./RatingMeter";

export function BustRisk(props: RatingProps) {
  return <RatingMeter {...props} Icon={ShieldAlert} color="#EF4444" label="Bust risk" unit="shield" />;
}
