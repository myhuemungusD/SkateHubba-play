import { useState, useCallback, useRef } from "react";
import { X, ChevronLeft } from "lucide-react";
import type { Spot, ObstacleType, CreateSpotRequest } from "../../types/spot";
import { createSpot } from "../../services/spots";
import { useAuthContext } from "../../context/AuthContext";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { logger } from "../../services/logger";
import { captureException } from "../../lib/sentry";
import { hashUid } from "../../utils/pii";
import { GnarRating } from "./GnarRating";
import { BustRisk } from "./BustRisk";

/** Only allow https URLs for photo submissions */
function isValidPhotoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Parse a coordinate input string into a number, or NaN when the parse
 * fails (empty, "-", etc.). NaN is intentional — callers keep it in
 * state so the submit guard's Number.isFinite check rejects empty input
 * rather than silently zeroing the pin into the Atlantic.
 */
function parseCoord(raw: string): number {
  const next = Number.parseFloat(raw);
  return Number.isFinite(next) ? next : NaN;
}

interface AddSpotSheetProps {
  userLocation: { lat: number; lng: number } | null;
  onClose: () => void;
  onSuccess: (spot: Spot) => void;
}

const ALL_OBSTACLES: ObstacleType[] = [
  "ledge",
  "rail",
  "stairs",
  "gap",
  "bank",
  "bowl",
  "manual_pad",
  "quarter_pipe",
  "euro_gap",
  "slappy_curb",
  "hip",
  "hubba",
  "flatground",
  "other",
];

type Step = 1 | 2 | 3;

export function AddSpotSheet({ userLocation, onClose, onSuccess }: AddSpotSheetProps) {
  const { user } = useAuthContext();
  const sheetRef = useRef<HTMLDivElement>(null);
  useFocusTrap(sheetRef);
  const [step, setStep] = useState<Step>(1);

  // Step 1: Location.
  // Text state is the source of truth for the inputs so users can clear
  // or partially type ("-", "12."). pinLat/pinLng are derived numbers,
  // intentionally NaN while the text is invalid — the submit guard
  // (Number.isFinite) catches NaN and surfaces "Invalid coordinates".
  const initialLat = userLocation?.lat ?? 34.0522;
  const initialLng = userLocation?.lng ?? -118.2437;
  const [pinLatText, setPinLatText] = useState(String(initialLat));
  const [pinLngText, setPinLngText] = useState(String(initialLng));
  const [pinLat, setPinLat] = useState<number>(initialLat);
  const [pinLng, setPinLng] = useState<number>(initialLng);

  // Step 2: Details
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [obstacles, setObstacles] = useState<ObstacleType[]>([]);
  const [gnarRating, setGnarRating] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [bustRisk, setBustRisk] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Step 3: Photos
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [photoInput, setPhotoInput] = useState("");

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Validation
  const [nameError, setNameError] = useState<string | null>(null);

  const toggleObstacle = useCallback((o: ObstacleType) => {
    setObstacles((prev) => (prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o]));
  }, []);

  const canProceedStep2 = name.trim().length > 0;

  const handleSubmit = useCallback(async () => {
    setError(null);

    if (!user) {
      setError("You must be signed in to add a spot");
      return;
    }

    // Client-side coord validation. Firestore rules are the authoritative
    // gate, but rejecting locally avoids a needless write + error round trip
    // when the user has typed a coordinate outside Earth's lat/lng range
    // (or left an input partially edited like "-").
    if (
      !Number.isFinite(pinLat) ||
      !Number.isFinite(pinLng) ||
      pinLat < -90 ||
      pinLat > 90 ||
      pinLng < -180 ||
      pinLng > 180
    ) {
      // Bounce back to step 1 so the user lands on the offending input
      // instead of seeing a generic banner two steps away from it.
      setStep(1);
      setError("Invalid coordinates");
      return;
    }

    setSubmitting(true);

    const req: CreateSpotRequest = {
      name: name.trim(),
      description: description.trim() || undefined,
      latitude: pinLat,
      longitude: pinLng,
      gnarRating,
      bustRisk,
      obstacles,
      photoUrls,
    };

    try {
      const spot: Spot = await createSpot(req, user.uid);
      onSuccess(spot);
    } catch (err) {
      // Mirror ProfileSetup's catch: surface the Firestore error code in the
      // inline banner so operators can distinguish App Check / permission /
      // rate-limit failures at a glance, and forward to Sentry with a hashed
      // uid so PII never leaves the client.
      const code = (err as { code?: string })?.code ?? "";
      const msg = err instanceof Error ? err.message : "Failed to create spot";
      captureException(err, {
        extra: { context: "AddSpotSheet.createSpot", uid: hashUid(user.uid), code },
      });
      logger.warn("add_spot_failed", { uid: user.uid, code, message: msg });
      setError(code ? `${msg} [${code}]` : msg);
    } finally {
      setSubmitting(false);
    }
  }, [user, name, description, pinLat, pinLng, gnarRating, bustRisk, obstacles, photoUrls, onSuccess]);

  const [photoError, setPhotoError] = useState<string | null>(null);

  const addPhotoUrl = useCallback(() => {
    const url = photoInput.trim();
    if (!url || photoUrls.length >= 5) return;
    if (!isValidPhotoUrl(url)) {
      setPhotoError("URL must start with https://");
      return;
    }
    setPhotoError(null);
    setPhotoUrls((prev) => [...prev, url]);
    setPhotoInput("");
  }, [photoInput, photoUrls.length]);

  const removePhoto = useCallback((index: number) => {
    setPhotoUrls((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} aria-hidden="true" />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="fixed bottom-0 left-0 right-0 z-50 bg-surface-alt rounded-t-2xl
                   max-h-[85dvh] overflow-y-auto shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Add a spot"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-surface-alt px-4 pt-4 pb-2 flex items-center justify-between border-b border-[#333]">
          <div className="flex items-center gap-2">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((step - 1) as Step)}
                className="text-muted hover:text-white"
                aria-label="Back"
              >
                <ChevronLeft size={20} />
              </button>
            )}
            <h2 className="text-white font-semibold">
              {step === 1 && "Pin Location"}
              {step === 2 && "Spot Details"}
              {step === 3 && "Photos"}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-white" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="p-4">
          {/* Submission error — rendered above the step content so it stays
              visible after a guard like "Invalid coordinates" bounces the
              user back to step 1, and after a Firestore rejection on step 3. */}
          {error && (
            <div
              role="alert"
              className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm"
            >
              {error}
            </div>
          )}

          {/* Step 1: Pin location */}
          {step === 1 && (
            <div>
              {/* Assumption: Static map preview showing pin location. Full drag-to-reposition
                  requires Mapbox Static Images API or a second map instance. Using coordinate
                  input for MVP. */}
              <div className="bg-background rounded-xl p-4 mb-4 border border-[#333]">
                <div className="text-center text-muted text-sm mb-3">
                  Adjust coordinates or use your current location
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-muted mb-1">Latitude</label>
                    <input
                      type="number"
                      step="0.0001"
                      min={-90}
                      max={90}
                      value={pinLatText}
                      onChange={(e) => {
                        setPinLatText(e.target.value);
                        setPinLat(parseCoord(e.target.value));
                      }}
                      className="w-full bg-surface-alt border border-[#444] rounded-lg px-3 py-2 text-white text-base"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted mb-1">Longitude</label>
                    <input
                      type="number"
                      step="0.0001"
                      min={-180}
                      max={180}
                      value={pinLngText}
                      onChange={(e) => {
                        setPinLngText(e.target.value);
                        setPinLng(parseCoord(e.target.value));
                      }}
                      className="w-full bg-surface-alt border border-[#444] rounded-lg px-3 py-2 text-white text-base"
                    />
                  </div>
                </div>
                {userLocation && (
                  <button
                    type="button"
                    onClick={() => {
                      setPinLat(userLocation.lat);
                      setPinLng(userLocation.lng);
                      setPinLatText(String(userLocation.lat));
                      setPinLngText(String(userLocation.lng));
                    }}
                    className="mt-3 text-xs text-[#F97316] hover:underline"
                  >
                    Use my current location
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setStep(2)}
                className="w-full py-2.5 rounded-xl bg-[#F97316] text-white font-semibold text-sm
                           hover:bg-[#EA580C] transition-colors"
              >
                Next
              </button>
            </div>
          )}

          {/* Step 2: Spot details */}
          {step === 2 && (
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
                             placeholder:text-subtle focus:outline-none focus:border-[#F97316]"
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
                             placeholder:text-subtle focus:outline-none focus:border-[#F97316] resize-none"
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
                          ? "bg-[#F97316] border-[#F97316] text-white"
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
                onClick={() => setStep(3)}
                className="w-full py-2.5 rounded-xl bg-[#F97316] text-white font-semibold text-sm
                           hover:bg-[#EA580C] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}

          {/* Step 3: Photos */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-muted">Add up to 5 photo URLs (optional)</p>

              {/* Photo previews */}
              {photoUrls.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {photoUrls.map((url, i) => (
                    <div key={i} className="relative flex-shrink-0">
                      <img src={url} alt={`Spot photo ${i + 1}`} className="w-20 h-20 object-cover rounded-lg" />
                      <button
                        type="button"
                        onClick={() => removePhoto(i)}
                        className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full
                                   flex items-center justify-center text-white text-xs"
                        aria-label={`Remove photo ${i + 1}`}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add photo URL input */}
              {photoUrls.length < 5 && (
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={photoInput}
                    onChange={(e) => setPhotoInput(e.target.value)}
                    placeholder="https://..."
                    className="flex-1 bg-background border border-[#444] rounded-lg px-3 py-2 text-white text-base
                               placeholder:text-subtle focus:outline-none focus:border-[#F97316]"
                  />
                  <button
                    type="button"
                    onClick={addPhotoUrl}
                    disabled={!photoInput.trim()}
                    className="px-4 py-2 bg-[#333] text-white text-sm rounded-lg
                               hover:bg-[#444] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Add
                  </button>
                </div>
              )}

              {/* Photo URL validation error */}
              {photoError && <p className="text-red-400 text-xs">{photoError}</p>}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full py-2.5 rounded-xl bg-[#F97316] text-white font-semibold text-sm
                           hover:bg-[#EA580C] transition-colors disabled:opacity-60"
              >
                {submitting ? "Submitting\u2026" : "Submit Spot"}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
