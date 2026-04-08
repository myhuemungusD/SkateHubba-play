import { useState, useEffect, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { subscribeToSpots, createSpot, type Spot, type CreateSpotInput } from "../services/spots";
import type { UserProfile } from "../services/users";
import { Btn } from "../components/ui/Btn";
import { Field } from "../components/ui/Field";
import { MapPinIcon, ChevronLeftIcon } from "../components/icons";
import { Spinner } from "../components/ui/Spinner";

/* ── Custom marker icon (brand-orange pin) ── */
const spotIcon = new L.Icon({
  iconUrl:
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40"><path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.268 21.732 0 14 0z" fill="%23FF6B00"/><circle cx="14" cy="14" r="6" fill="white"/></svg>',
    ),
  iconSize: [28, 40],
  iconAnchor: [14, 40],
  popupAnchor: [0, -40],
});

/* ── Map center updater when user location changes ── */
function FlyToLocation({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, 13, { duration: 1 });
  }, [map, center]);
  return null;
}

/* ── Add Spot Form ── */
function AddSpotForm({
  userLocation,
  profile,
  onCreated,
  onCancel,
}: {
  userLocation: [number, number] | null;
  profile: UserProfile;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Enter a spot name");
      return;
    }
    if (!userLocation) {
      setError("Location not available");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const input: CreateSpotInput = {
        name: name.trim(),
        latitude: userLocation[0],
        longitude: userLocation[1],
        createdByUid: profile.uid,
        createdByUsername: profile.username,
      };
      await createSpot(input);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create spot");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 z-[1000] p-4 glass rounded-t-2xl border-t border-white/[0.06]">
      <h3 className="font-display text-base text-white mb-3">Add New Spot</h3>
      <Field
        label="Spot Name"
        value={name}
        onChange={setName}
        placeholder="e.g. Hollywood High 16"
        maxLength={100}
        autoFocus
      />
      {!userLocation && (
        <p className="font-body text-xs text-brand-red mt-1">Enable location access to add a spot at your position</p>
      )}
      {error && <p className="font-body text-xs text-brand-red mt-1">{error}</p>}
      <div className="flex gap-2 mt-3">
        <Btn onClick={handleSubmit} disabled={loading || !userLocation}>
          {loading ? "Adding..." : "Add Spot"}
        </Btn>
        <Btn onClick={onCancel} variant="ghost">
          Cancel
        </Btn>
      </div>
    </div>
  );
}

export function MapScreen({
  profile,
  onBack,
  onViewSpot,
}: {
  profile: UserProfile;
  onBack: () => void;
  onViewSpot: (spotId: string) => void;
}) {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [loading, setLoading] = useState(true);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [locatingUser, setLocatingUser] = useState(true);

  // Subscribe to spots
  useEffect(() => {
    const unsub = subscribeToSpots((updated) => {
      setSpots(updated);
      setLoading(false);
    });
    return unsub;
  }, []);

  // Get user location
  useEffect(() => {
    if (!navigator.geolocation) {
      // Geolocation not available — resolve via microtask to avoid synchronous setState in effect
      void Promise.resolve().then(() => setLocatingUser(false));
      return;
    }
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
  }, []);

  const handleSpotCreated = useCallback(() => {
    setShowAddForm(false);
  }, []);

  // Default center: LA (skateboarding mecca) or user location
  const defaultCenter: [number, number] = userLocation ?? [34.0522, -118.2437];

  return (
    <div className="min-h-dvh bg-[#0A0A0A] flex flex-col relative">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 flex items-center gap-3 border-b border-white/[0.04] glass z-[1001] relative">
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 rounded-xl hover:bg-white/[0.05] transition-colors"
          aria-label="Back to lobby"
        >
          <ChevronLeftIcon size={20} className="text-brand-orange" />
        </button>
        <div className="flex items-center gap-2">
          <MapPinIcon size={18} className="text-brand-orange" />
          <h1 className="font-display text-lg text-white tracking-wide">Spot Map</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="font-body text-xs text-dim tabular-nums">{spots.length} spots</span>
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            disabled={showAddForm}
            className="px-3 py-1.5 rounded-xl bg-brand-orange text-white font-display text-xs tracking-wider hover:bg-[#FF7A1A] transition-colors disabled:opacity-40"
          >
            + Add Spot
          </button>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        {(loading || locatingUser) && (
          <div className="absolute inset-0 z-[999] flex items-center justify-center bg-[#0A0A0A]/80">
            <Spinner />
          </div>
        )}
        <MapContainer
          center={defaultCenter}
          zoom={userLocation ? 13 : 4}
          className="h-full w-full"
          style={{ minHeight: "calc(100dvh - 65px)" }}
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          {userLocation && <FlyToLocation center={userLocation} />}
          {spots.map((spot) => (
            <Marker key={spot.id} position={[spot.latitude, spot.longitude]} icon={spotIcon}>
              <Popup>
                <div className="text-center min-w-[140px]">
                  <p className="font-bold text-sm mb-1">{spot.name}</p>
                  <p className="text-xs text-gray-600 mb-2">
                    {spot.gameCount} {spot.gameCount === 1 ? "game" : "games"}
                  </p>
                  <button
                    type="button"
                    onClick={() => onViewSpot(spot.id)}
                    className="px-3 py-1 rounded bg-[#FF6B00] text-white text-xs font-bold hover:bg-[#FF7A1A] transition-colors"
                  >
                    View Spot
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {/* Add Spot Form */}
      {showAddForm && (
        <AddSpotForm
          userLocation={userLocation}
          profile={profile}
          onCreated={handleSpotCreated}
          onCancel={() => setShowAddForm(false)}
        />
      )}
    </div>
  );
}
