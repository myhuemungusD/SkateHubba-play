import { useState, useEffect } from "react";
import { getAllSpots, createSpot, tagGameWithSpot, type Spot, type CreateSpotInput } from "../services/spots";
import type { UserProfile } from "../services/users";
import { Field } from "./ui/Field";
import { Btn } from "./ui/Btn";
import { MapPinIcon, XCircleIcon } from "./icons";

export function SpotTagModal({
  gameId,
  profile,
  onClose,
  onTagged,
}: {
  gameId: string;
  profile: UserProfile;
  onClose: () => void;
  onTagged: (spotName: string) => void;
}) {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newSpotName, setNewSpotName] = useState("");
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [tagging, setTagging] = useState(false);
  const [error, setError] = useState("");
  const [locatingUser, setLocatingUser] = useState(false);

  // Load existing spots
  useEffect(() => {
    getAllSpots()
      .then(setSpots)
      .catch(() => setSpots([]))
      .finally(() => setLoading(false));
  }, []);

  // Request location when creating a new spot
  useEffect(() => {
    if (!showCreate || userLocation) return;
    if (!navigator.geolocation) return;

    setLocatingUser(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation([pos.coords.latitude, pos.coords.longitude]);
        setLocatingUser(false);
      },
      () => {
        setLocatingUser(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [showCreate, userLocation]);

  const filtered = spots.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()));

  const handleSelectSpot = async (spot: Spot) => {
    setTagging(true);
    setError("");
    try {
      await tagGameWithSpot(gameId, spot.id, profile.uid);
      onTagged(spot.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to tag spot");
    } finally {
      setTagging(false);
    }
  };

  const handleCreateAndTag = async () => {
    if (!newSpotName.trim()) {
      setError("Enter a spot name");
      return;
    }
    if (!userLocation) {
      setError("Location not available — enable location access");
      return;
    }

    setTagging(true);
    setError("");
    try {
      const input: CreateSpotInput = {
        name: newSpotName.trim(),
        latitude: userLocation[0],
        longitude: userLocation[1],
        createdByUid: profile.uid,
        createdByUsername: profile.username,
      };
      const spotId = await createSpot(input);
      await tagGameWithSpot(gameId, spotId, profile.uid);
      onTagged(newSpotName.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create spot");
    } finally {
      setTagging(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

      {/* Modal */}
      <div className="relative w-full max-w-md rounded-2xl glass-card border border-white/[0.06] p-5 max-h-[80vh] flex flex-col animate-scale-in">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg hover:bg-white/[0.05] transition-colors"
          aria-label="Close"
        >
          <XCircleIcon size={20} className="text-dim" />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <MapPinIcon size={20} className="text-brand-orange" />
          <h2 className="font-display text-lg text-white">Tag This Spot</h2>
        </div>

        {!showCreate ? (
          <>
            <Field
              label="Search spots"
              value={search}
              onChange={setSearch}
              placeholder="Search by name..."
            />

            <div className="flex-1 overflow-y-auto mt-3 space-y-1.5 min-h-0 max-h-[40vh]">
              {loading ? (
                <p className="font-body text-xs text-dim text-center py-4">Loading spots...</p>
              ) : filtered.length === 0 ? (
                <div className="text-center py-6">
                  <p className="font-body text-xs text-faint mb-2">
                    {search ? "No spots match your search" : "No spots yet"}
                  </p>
                </div>
              ) : (
                filtered.map((spot) => (
                  <button
                    type="button"
                    key={spot.id}
                    onClick={() => handleSelectSpot(spot)}
                    disabled={tagging}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/[0.04] transition-colors text-left disabled:opacity-40"
                  >
                    <div className="w-8 h-8 rounded-lg bg-brand-orange/10 border border-brand-orange/20 flex items-center justify-center shrink-0">
                      <MapPinIcon size={14} className="text-brand-orange" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="font-display text-sm text-white block truncate">{spot.name}</span>
                      <span className="font-body text-[11px] text-dim">
                        {spot.gameCount} {spot.gameCount === 1 ? "game" : "games"}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>

            {error && <p className="font-body text-xs text-brand-red mt-2">{error}</p>}

            <div className="mt-3 pt-3 border-t border-white/[0.06]">
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="w-full font-display text-sm text-brand-orange hover:text-[#FF7A1A] transition-colors py-2"
              >
                + Create New Spot
              </button>
            </div>
          </>
        ) : (
          <>
            <Field
              label="Spot Name"
              value={newSpotName}
              onChange={setNewSpotName}
              placeholder="e.g. Hollywood High 16"
              maxLength={100}
              autoFocus
            />

            {locatingUser && (
              <p className="font-body text-xs text-brand-orange mt-2">Getting your location...</p>
            )}
            {!locatingUser && !userLocation && (
              <p className="font-body text-xs text-brand-red mt-2">
                Could not get your location. Enable location access and try again.
              </p>
            )}
            {userLocation && (
              <p className="font-body text-xs text-brand-green mt-2">
                Location: {userLocation[0].toFixed(4)}, {userLocation[1].toFixed(4)}
              </p>
            )}

            {error && <p className="font-body text-xs text-brand-red mt-2">{error}</p>}

            <div className="flex gap-2 mt-4">
              <Btn onClick={handleCreateAndTag} disabled={tagging || !userLocation}>
                {tagging ? "Tagging..." : "Create & Tag"}
              </Btn>
              <Btn onClick={() => { setShowCreate(false); setError(""); }} variant="ghost">
                Back
              </Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
