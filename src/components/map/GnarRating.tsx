import { Flame } from "lucide-react";
import { RatingMeter, type RatingProps } from "./RatingMeter";

export function GnarRating(props: RatingProps) {
  return <RatingMeter {...props} Icon={Flame} color="#ff6b00" label="Gnar rating" unit="flame" />;
}
