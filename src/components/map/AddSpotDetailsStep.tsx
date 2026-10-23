import type { Dispatch, SetStateAction } from "react";
import type { ObstacleType } from "../../types/spot";
import { GnarRating } from "./GnarRating";
import { BustRisk } from "./BustRisk";
import { ALL_OBSTACLES } from "./addSpotHelpers";

type Rating = 1 | 2 | 3 | 4 | 5;

interface AddSpotDetailsStepProps {
  name: string;
  setName: (v: string) => void;
  nameError: string | null;
  setNameError: (v: string | null) => void;
  description: string;
  setDescription: (v: string) => void;
  obstacles: ObstacleType[];
  toggleObstacle: (o: ObstacleType) => void;
  gnarRating: Rating;
  setGnarRating: Dispatch<SetStateAction<Rating>>;
  bustRisk: Rating;
  setBustRisk: Dispatch<SetStateAction<Rating>>;
  canProceedStep2: boolean;
  onNext: () => void;
}

/** Step 2 of AddSpotSheet: name, description, obstacles and ratings. */
export function AddSpotDetailsStep({
  name,
  setName,
  nameError,
  setNameError,
  description,
  setDescription,
  obstacles,
  toggleObstacle,
  gnarRating,
  setGnarRating,
  bustRisk,
  setBustRisk,
  canProceedStep2,
  onNext,
}: AddSpotDetailsStepProps) {
  return (
    <div className="space-y-4">
      {/* Name */}
      <div>
        <label className="block text-xs text-muted mb-1">
          Name <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          maxLength={80}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(e.target.value.trim().length === 0 ? "Name is required" : null);
          }}
          placeholder="e.g. Hollywood High 16"
          className="w-full bg-background border border-[#444] rounded-lg px-3 py-2 text-white text-base
                     placeholder:text-subtle focus:outline-none focus:border-brand-orange"
        />
        {nameError && <p className="text-red-400 text-xs mt-1">{nameError}</p>}
        <p className="text-subtle text-xs mt-1">{name.length}/80</p>
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs text-muted mb-1">Description</label>
        <textarea
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What makes this spot special?"
          rows={3}
          className="w-full bg-background border border-[#444] rounded-lg px-3 py-2 text-white text-base
                     placeholder:text-subtle focus:outline-none focus:border-brand-orange resize-none"
        />
        <p className="text-subtle text-xs mt-1">{description.length}/500</p>
      </div>

      {/* Obstacles */}
      <div>
        <label className="block text-xs text-muted mb-2">Obstacles</label>
        <div className="flex flex-wrap gap-2">
          {ALL_OBSTACLES.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => toggleObstacle(o)}
              className={`touch-target inline-flex items-center justify-center px-3 py-1 text-xs rounded-full border transition-colors ${
                obstacles.includes(o)
                  ? "bg-brand-orange border-brand-orange text-black"
                  : "bg-transparent border-[#444] text-muted hover:border-[#666]"
              }`}
            >
              {o.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      {/* Gnar Rating */}
      <div>
        <label className="block text-xs text-muted mb-1">
          Gnar Rating <span className="text-red-400">*</span>
        </label>
        <GnarRating value={gnarRating} readonly={false} onChange={setGnarRating} />
      </div>

      {/* Bust Risk */}
      <div>
        <label className="block text-xs text-muted mb-1">
          Bust Risk <span className="text-red-400">*</span>
        </label>
        <BustRisk value={bustRisk} readonly={false} onChange={setBustRisk} />
      </div>

      <button
        type="button"
        disabled={!canProceedStep2}
        onClick={onNext}
        className="w-full py-2.5 rounded-xl bg-brand-orange text-black font-semibold text-sm
                   hover:bg-brand-orange-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Next
      </button>
    </div>
  );
}
