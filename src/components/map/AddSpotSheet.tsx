import { useState, useCallback, useRef } from "react";
import { useSwipeDownToClose } from "../useSwipeDownToClose";
import { X, ChevronLeft } from "lucide-react";
import type { Spot, ObstacleType, CreateSpotRequest } from "../../types/spot";
import { createSpot } from "../../services/spots";
import { useAuthContext } from "../../context/AuthContext";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { logger } from "../../services/logger";
import { captureException } from "../../lib/sentry";
import { hashUid } from "../../utils/pii";
import { isValidLatLng, isValidPhotoUrl } from "./addSpotHelpers";
import { AddSpotLocationStep } from "./AddSpotLocationStep";
import { AddSpotDetailsStep } from "./AddSpotDetailsStep";
import { AddSpotPhotosStep } from "./AddSpotPhotosStep";
import { SpotVisibilityPicker } from "./SpotVisibilityPicker";
import { isMapCheckinsEnabled } from "../../lib/featureFlags";
import { useTipZone } from "../../lib/tipSignals";
import { createPrivateSpot, resolveCrew, type SpotVisibility } from "../../services/mapCheckins";

export { safePhotoPreviewSrc } from "./addSpotHelpers";

interface AddSpotSheetProps {
  userLocation: { lat: number; lng: number } | null;
  onClose: () => void;
  onSuccess: (spot: Spot) => void;
}

type Step = 1 | 2 | 3;

export function AddSpotSheet({ userLocation, onClose, onSuccess }: AddSpotSheetProps) {
  useTipZone("addspot");
  const { user } = useAuthContext();
  const sheetRef = useRef<HTMLDivElement>(null);
  useFocusTrap(sheetRef);
  useSwipeDownToClose(sheetRef, onClose);
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

  // Map Phase 1: who can see the spot.
  const [visibility, setVisibility] = useState<SpotVisibility>("public");
  const [crewText, setCrewText] = useState("");

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
    if (!isValidLatLng(pinLat, pinLng)) {
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
      let spot: Spot;
      if (visibility === "public") {
        spot = await createSpot(req, user.uid);
      } else {
        const crew = visibility === "crew" ? await resolveCrew(crewText.split(",")) : { uids: [], unknown: [] };
        if (crew.unknown.length > 0) {
          setError(`No skater named ${crew.unknown.join(", ")}`);
          return;
        }
        spot = await createPrivateSpot(req, user.uid, visibility, crew.uids);
      }
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
  }, [
    user,
    name,
    description,
    pinLat,
    pinLng,
    gnarRating,
    bustRisk,
    obstacles,
    photoUrls,
    onSuccess,
    visibility,
    crewText,
  ]);

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

          {step === 1 && (
            <AddSpotLocationStep
              userLocation={userLocation}
              pinLatText={pinLatText}
              pinLngText={pinLngText}
              onLat={(text, value) => {
                setPinLatText(text);
                setPinLat(value);
              }}
              onLng={(text, value) => {
                setPinLngText(text);
                setPinLng(value);
              }}
              onNext={() => setStep(2)}
            />
          )}

          {/* Step 2: Spot details */}
          {step === 2 && (
            <AddSpotDetailsStep
              name={name}
              setName={setName}
              nameError={nameError}
              setNameError={setNameError}
              description={description}
              setDescription={setDescription}
              obstacles={obstacles}
              toggleObstacle={toggleObstacle}
              gnarRating={gnarRating}
              setGnarRating={setGnarRating}
              bustRisk={bustRisk}
              setBustRisk={setBustRisk}
              canProceedStep2={canProceedStep2}
              onNext={() => setStep(3)}
            />
          )}

          {/* Step 3: Photos */}
          {step === 3 && isMapCheckinsEnabled() && (
            <SpotVisibilityPicker
              visibility={visibility}
              onChange={setVisibility}
              crewText={crewText}
              onCrewText={setCrewText}
            />
          )}
          {step === 3 && (
            <AddSpotPhotosStep
              photoUrls={photoUrls}
              photoInput={photoInput}
              setPhotoInput={setPhotoInput}
              addPhotoUrl={addPhotoUrl}
              removePhoto={removePhoto}
              photoError={photoError}
              submitting={submitting}
              onSubmit={handleSubmit}
            />
          )}
        </div>
      </div>
    </>
  );
}
