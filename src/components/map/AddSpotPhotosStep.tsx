import { X } from "lucide-react";
import { safePhotoPreviewSrc } from "./addSpotHelpers";

interface AddSpotPhotosStepProps {
  photoUrls: string[];
  photoInput: string;
  setPhotoInput: (v: string) => void;
  addPhotoUrl: () => void;
  removePhoto: (index: number) => void;
  photoError: string | null;
  submitting: boolean;
  onSubmit: () => void;
}

/** Step 3 of AddSpotSheet: optional https photo URLs, then submit. */
export function AddSpotPhotosStep({
  photoUrls,
  photoInput,
  setPhotoInput,
  addPhotoUrl,
  removePhoto,
  photoError,
  submitting,
  onSubmit,
}: AddSpotPhotosStepProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Add up to 5 photo URLs (optional)</p>

      {/* Photo previews */}
      {photoUrls.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {photoUrls.map((url, i) => (
            <div key={i} className="relative flex-shrink-0">
              <img
                src={safePhotoPreviewSrc(url)}
                alt={`Spot photo ${i + 1}`}
                className="w-20 h-20 object-cover rounded-lg"
              />
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
        onClick={onSubmit}
        disabled={submitting}
        className="w-full py-2.5 rounded-xl bg-[#F97316] text-white font-semibold text-sm
                   hover:bg-[#EA580C] transition-colors disabled:opacity-60"
      >
        {submitting ? "Submitting\u2026" : "Submit Spot"}
      </button>
    </div>
  );
}
