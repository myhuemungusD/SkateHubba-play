import { useCallback, useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";

interface UseUserGeolocationParams {
  map: React.MutableRefObject<mapboxgl.Map | null>;
}

interface UseUserGeolocationResult {
  userLocation: { lat: number; lng: number } | null;
  isTrackingUser: boolean;
  setIsTrackingUser: React.Dispatch<React.SetStateAction<boolean>>;
  gpsError: string | null;
  gpsBannerDismissed: boolean;
  setGpsBannerDismissed: React.Dispatch<React.SetStateAction<boolean>>;
  handleRecenter: (onWaiting: () => void) => void;
}

function getGpsErrorMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case 1:
      return "Location permission denied. Enable in browser settings.";
    case 2:
      return "Location unavailable. Check your location services.";
    case 3:
      return "Location request timed out. Try again.";
    default:
      return "Unable to get location";
  }
}

/**
 * Owns the GPS watcher, user-marker creation/update, follow-tracking, and
 * recenter logic. Reads the latest userLocation through a ref so the
 * recenter callback never goes stale.
 */
export function useUserGeolocation({ map }: UseUserGeolocationParams): UseUserGeolocationResult {
  const userMarker = useRef<mapboxgl.Marker | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const hasLockedRef = useRef(false);
  const userLocationRef = useRef<{ lat: number; lng: number } | null>(null);

  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isTrackingUser, setIsTrackingUser] = useState(true);
  const [gpsError, setGpsError] = useState<string | null>(() =>
    "geolocation" in navigator ? null : "Geolocation not supported by your browser",
  );
  const [gpsBannerDismissed, setGpsBannerDismissed] = useState(false);

  // Keep ref in sync
  useEffect(() => {
    userLocationRef.current = userLocation;
  }, [userLocation]);

  // GPS tracking
  useEffect(() => {
    if (!("geolocation" in navigator)) return;

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        setGpsError(null);
        setGpsBannerDismissed(false);

        // Fly to user on first GPS lock, then user can pan freely
        if (!hasLockedRef.current && map.current) {
          map.current.flyTo({ center: [loc.lng, loc.lat], zoom: 15 });
          hasLockedRef.current = true;
        }
      },
      (err) => {
        setGpsError(getGpsErrorMessage(err));
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    );

    watchIdRef.current = id;

    return () => {
      navigator.geolocation.clearWatch(id);
      watchIdRef.current = null;
    };
  }, [map, setUserLocation]);

  // Update user marker
  useEffect(() => {
    if (!map.current || !userLocation) return;

    if (!userMarker.current) {
      const el = document.createElement("div");
      el.style.position = "relative";
      el.style.width = "12px";
      el.style.height = "12px";

      const accuracy = document.createElement("div");
      accuracy.className = "spot-user-accuracy";
      el.appendChild(accuracy);

      const dot = document.createElement("div");
      dot.className = "spot-user-dot";
      el.appendChild(dot);

      userMarker.current = new mapboxgl.Marker({ element: el })
        .setLngLat([userLocation.lng, userLocation.lat])
        .addTo(map.current);
    } else {
      userMarker.current.setLngLat([userLocation.lng, userLocation.lat]);
    }

    // Follow user if tracking is on
    if (isTrackingUser && map.current) {
      map.current.easeTo({ center: [userLocation.lng, userLocation.lat], duration: 500 });
    }
  }, [map, userLocation, isTrackingUser]);

  const handleRecenter = useCallback(
    (onWaiting: () => void) => {
      const loc = userLocationRef.current;
      if (!loc) {
        onWaiting();
        return;
      }
      if (!map.current) return;
      setIsTrackingUser(true);
      map.current.flyTo({ center: [loc.lng, loc.lat], zoom: 15 });
    },
    [setIsTrackingUser],
  );

  return {
    userLocation,
    isTrackingUser,
    setIsTrackingUser,
    gpsError,
    gpsBannerDismissed,
    setGpsBannerDismissed,
    handleRecenter,
  };
}
