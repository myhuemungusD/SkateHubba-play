import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
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

/* ── Fly to user location once (memoized to prevent re-fly on re-render) ── */
function FlyToLocation({ center }: { center: [number, number] }) {
  const map = useMap();
  const hasFlewRef = useRef(false);
  const [lat, lng] = center;

  useEffect(() => {
    if (hasFlewRef.current) return;
    hasFlewRef.current = true;
    map.flyTo([lat, lng], 13, { duration: 1 });
  }, [map, lat, lng]);

  return null;
}

/* ── Capture map clicks for spot placement ── */
function MapClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/* ── Add Spot Form ── */
function AddSpotForm({
  pinLocation,
  profile,
  onCreated,
  onCancel,
}: {
  pinLocation: [number, number] | null;
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
    if (!pinLocation) {
      setError("Tap the map to place a pin first");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const input: CreateSpotInput = {
        name: name.trim(),
        latitude: pinLocation[0],
        longitude: pinLocation[1],
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
      {pinLocation ? (
        <p className="font-body text-xs text-brand-green mt-1">
          Pin placed: {pinLocation[0].toFixed(4)}, {pinLocation[1].toFixed(4)}
        </p>
      ) : (
        <p className="font-body text-xs text-brand-orange mt-1">
          Tap the map to place a pin at the spot&apos;s location
        </p>
      )}
      {error && <p className="font-body text-xs text-brand-red mt-1">{error}</p>}
      <div className="flex gap-2 mt-3">
        <Btn onClick={handleSubmit} disabled={loading || !pinLocation}>
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
  const [error, setError] = useState(false);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [locatingUser, setLocatingUser] = useState(true);
  const [pinLocation, setPinLocation] = useState<[number, number] | null>(null);

  // Subscribe to spots with error handling
  useEffect(() => {
    let didError = false;

    const unsub = subscribeToSpots((updated) => {
      setSpots(updated);
      setLoading(false);
      setError(false);
    });

    // If no update arrives within 15s, show error state
    const timeout = setTimeout(() => {
      if (loading && !didError) {
        didError = true;
        setLoading(false);
        setError(true);
      }
    }, 15000);

    return () => {
      unsub();
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on mount
  }, []);

  // Get user location
  useEffect(() => {
    if (!navigator.geolocation) {
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
    setPinLocation(null);
  }, []);

  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      if (showAddForm) {
        setPinLocation([lat, lng]);
      }
    },
    [showAddForm],
  );

  const handleRetry = useCallback(() => {
    setLoading(true);
    setError(false);
    // Re-mount by toggling a key isn't ideal; just re-subscribe
    const unsub = subscribeToSpots((updated) => {
      setSpots(updated);
      setLoading(false);
      setError(false);
    });
    return () => unsub();
  }, []);

  // Default center: LA (skateboarding mecca) or user location
  const defaultCenter: [number, number] = useMemo(
    () => userLocation ?? [34.0522, -118.2437],
    [userLocation],
  );

  // Memoize pin marker icon
  const pinIcon = useMemo(
    () =>
      new L.Icon({
        iconUrl:
          "data:image/svg+xml," +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40"><path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.268 21.732 0 14 0z" fill="%2300E676"/><circle cx="14" cy="14" r="6" fill="white"/></svg>',
          ),
        iconSize: [28, 40],
        iconAnchor: [14, 40],
      }),
    [],
  );

  return (
    <div className="min-h-dvh bg-[#0A0A0A] flex flex-col relative">
      {/* Dark-themed Leaflet popup overrides */}
      <style>{`
        .leaflet-popup-content-wrapper {
          background: #1a1a1a !important;
          border: 1px solid rgba(255,255,255,0.06) !important;
          border-radius: 16px !important;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5) !important;
          color: white !important;
        }
        .leaflet-popup-tip {
          background: #1a1a1a !important;
          border: 1px solid rgba(255,255,255,0.06) !important;
          box-shadow: none !important;
        }
        .leaflet-popup-close-button {
          color: #666 !important;
          font-size: 18px !important;
        }
        .leaflet-popup-close-button:hover {
          color: #ff6b00 !important;
        }
        .leaflet-popup-content {
          margin: 12px 16px !important;
          font-family: "DM Sans", sans-serif !important;
        }
      `}</style>

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
            onClick={() => {
              setShowAddForm(true);
              setPinLocation(userLocation);
            }}
            disabled={showAddForm}
            className="px-3.5 py-2 rounded-xl bg-brand-orange text-white font-display text-xs tracking-wider hover:bg-[#FF7A1A] transition-all duration-300 disabled:opacity-40 shadow-[0_2px_8px_rgba(255,107,0,0.2)] hover:shadow-[0_4px_16px_rgba(255,107,0,0.3)]"
          >
            + Add Spot
          </button>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        {locatingUser && (
          <div className="absolute inset-0 z-[999] flex items-center justify-center bg-[#0A0A0A]/80">
            <Spinner />
          </div>
        )}

        {/* Error state with retry */}
        {error && !loading && (
          <div className="absolute inset-0 z-[999] flex flex-col items-center justify-center bg-[#0A0A0A]/90 px-6">
            <MapPinIcon size={40} className="text-brand-red mb-4" />
            <p className="font-display text-lg text-white mb-2">Failed to load spots</p>
            <p className="font-body text-xs text-dim mb-4 text-center">Check your connection and try again</p>
            <Btn onClick={handleRetry} className="max-w-[200px]">
              Retry
            </Btn>
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
          {showAddForm && <MapClickHandler onMapClick={handleMapClick} />}

          {/* Spot placement pin (green) */}
          {showAddForm && pinLocation && (
            <Marker position={pinLocation} icon={pinIcon} />
          )}

          {spots.map((spot) => (
            <Marker key={spot.id} position={[spot.latitude, spot.longitude]} icon={spotIcon}>
              <Popup>
                <div className="text-center min-w-[160px]">
                  <p className="font-bold text-sm text-white mb-0.5">{spot.name}</p>
                  <p className="text-xs text-[#888] mb-3">
                    {spot.gameCount} {spot.gameCount === 1 ? "game" : "games"}
                  </p>
                  <button
                    type="button"
                    onClick={() => onViewSpot(spot.id)}
                    className="w-full px-4 py-2 rounded-xl bg-brand-orange text-white text-xs font-bold tracking-wider hover:bg-[#FF7A1A] transition-colors"
                  >
                    View Spot
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {/* Empty state overlay */}
        {!loading && !error && !locatingUser && spots.length === 0 && !showAddForm && (
          <div className="absolute inset-0 z-[998] flex flex-col items-center justify-center pointer-events-none">
            <div className="pointer-events-auto text-center px-6 py-8 rounded-2xl glass-card border border-white/[0.06] max-w-xs">
              <MapPinIcon size={32} className="text-brand-orange mx-auto mb-3" />
              <p className="font-display text-lg text-white mb-1">No spots yet</p>
              <p className="font-body text-xs text-dim mb-4">Be the first to add a skate spot!</p>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(true);
                  setPinLocation(userLocation);
                }}
                className="px-5 py-2.5 rounded-xl bg-brand-orange text-white font-display text-sm tracking-wider hover:bg-[#FF7A1A] transition-colors shadow-[0_2px_12px_rgba(255,107,0,0.25)]"
              >
                + Add First Spot
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add Spot Form */}
      {showAddForm && (
        <AddSpotForm
          pinLocation={pinLocation}
          profile={profile}
          onCreated={handleSpotCreated}
          onCancel={() => {
            setShowAddForm(false);
            setPinLocation(null);
          }}
        />
      )}
    </div>
  );
}
