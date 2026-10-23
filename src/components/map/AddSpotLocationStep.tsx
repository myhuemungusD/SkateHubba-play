import { parseCoord } from "./addSpotHelpers";

interface Props {
  userLocation: { lat: number; lng: number } | null;
  pinLatText: string;
  pinLngText: string;
  onLat: (text: string, value: number) => void;
  onLng: (text: string, value: number) => void;
  onNext: () => void;
}

/** Step 1 of Add Spot: coordinate entry plus "use my current location". */
export function AddSpotLocationStep({ userLocation, pinLatText, pinLngText, onLat, onLng, onNext }: Props) {
  return (
    <div>
      {/* Assumption: Static map preview showing pin location. Full drag-to-reposition
          requires Mapbox Static Images API or a second map instance. Using coordinate
          input for MVP. */}
      <div className="bg-background rounded-xl p-4 mb-4 border border-[#333]">
        <div className="text-center text-muted text-sm mb-3">Adjust coordinates or use your current location</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="add-spot-latitude" className="block text-xs text-muted mb-1">
              Latitude
            </label>
            <input
              id="add-spot-latitude"
              type="number"
              step="0.0001"
              min={-90}
              max={90}
              value={pinLatText}
              onChange={(e) => onLat(e.target.value, parseCoord(e.target.value))}
              className="w-full bg-surface-alt border border-[#444] rounded-lg px-3 py-2 text-white text-base"
            />
          </div>
          <div>
            <label htmlFor="add-spot-longitude" className="block text-xs text-muted mb-1">
              Longitude
            </label>
            <input
              id="add-spot-longitude"
              type="number"
              step="0.0001"
              min={-180}
              max={180}
              value={pinLngText}
              onChange={(e) => onLng(e.target.value, parseCoord(e.target.value))}
              className="w-full bg-surface-alt border border-[#444] rounded-lg px-3 py-2 text-white text-base"
            />
          </div>
        </div>
        {userLocation && (
          <button
            type="button"
            onClick={() => {
              onLat(String(userLocation.lat), userLocation.lat);
              onLng(String(userLocation.lng), userLocation.lng);
            }}
            className="mt-3 text-xs text-brand-orange hover:underline"
          >
            Use my current location
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onNext}
        className="w-full py-2.5 rounded-xl bg-brand-orange text-black font-semibold text-sm
                   hover:bg-brand-orange-hover transition-colors"
      >
        Next
      </button>
    </div>
  );
}
