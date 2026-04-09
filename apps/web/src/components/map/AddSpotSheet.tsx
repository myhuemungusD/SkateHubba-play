import { useState, useCallback, useEffect, useRef } from 'react';
import { X, ChevronLeft } from 'lucide-react';
import type { Spot, ObstacleType, CreateSpotRequest } from '@shared/types';
import { GnarRating } from './GnarRating';
import { BustRisk } from './BustRisk';

/** Only allow https URLs for photo submissions */
function isValidPhotoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

interface AddSpotSheetProps {
  userLocation: { lat: number; lng: number } | null;
  onClose: () => void;
  onSuccess: (spot: Spot) => void;
}

const ALL_OBSTACLES: ObstacleType[] = [
  'ledge', 'rail', 'stairs', 'gap', 'bank', 'bowl',
  'manual_pad', 'quarter_pipe', 'euro_gap', 'slappy_curb',
  'hip', 'hubba', 'flatground', 'other',
];

type Step = 1 | 2 | 3;

export function AddSpotSheet({ userLocation, onClose, onSuccess }: AddSpotSheetProps) {
  const [step, setStep] = useState<Step>(1);

  // Step 1: Location
  const [pinLat, setPinLat] = useState(userLocation?.lat ?? 34.0522);
  const [pinLng, setPinLng] = useState(userLocation?.lng ?? -118.2437);

  // Step 2: Details
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [obstacles, setObstacles] = useState<ObstacleType[]>([]);
  const [gnarRating, setGnarRating] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [bustRisk, setBustRisk] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Step 3: Photos
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [photoInput, setPhotoInput] = useState('');

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Validation
  const [nameError, setNameError] = useState<string | null>(null);

  const toggleObstacle = useCallback((o: ObstacleType) => {
    setObstacles((prev) =>
      prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o],
    );
  }, []);

  const canProceedStep2 = name.trim().length > 0;

  const handleSubmit = useCallback(async () => {
    setError(null);

    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSubmitting(true);

    const body: CreateSpotRequest = {
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
      const res = await fetch('/api/spots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' })) as { error: string };
        setError(data.error || `HTTP ${res.status}`);
        return;
      }

      const spot = await res.json() as Spot;
      onSuccess(spot);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }, [name, description, pinLat, pinLng, gnarRating, bustRisk, obstacles, photoUrls, onSuccess]);

  const [photoError, setPhotoError] = useState<string | null>(null);

  const addPhotoUrl = useCallback(() => {
    const url = photoInput.trim();
    if (!url || photoUrls.length >= 5) return;
    if (!isValidPhotoUrl(url)) {
      setPhotoError('URL must start with https://');
      return;
    }
    setPhotoError(null);
    setPhotoUrls((prev) => [...prev, url]);
    setPhotoInput('');
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
        className="fixed bottom-0 left-0 right-0 z-50 bg-[#1A1A1A] rounded-t-2xl
                   max-h-[85dvh] overflow-y-auto shadow-2xl"
        role="dialog"
        aria-label="Add a spot"
      >
        {/* Header */}
        <div className="sticky top-0 bg-[#1A1A1A] px-4 pt-4 pb-2 flex items-center justify-between border-b border-[#333]">
          <div className="flex items-center gap-2">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((step - 1) as Step)}
                className="text-[#888] hover:text-white"
                aria-label="Back"
              >
                <ChevronLeft size={20} />
              </button>
            )}
            <h2 className="text-white font-semibold">
              {step === 1 && 'Pin Location'}
              {step === 2 && 'Spot Details'}
              {step === 3 && 'Photos'}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="text-[#888] hover:text-white" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="p-4">
          {/* Step 1: Pin location */}
          {step === 1 && (
            <div>
              {/* Assumption: Static map preview showing pin location. Full drag-to-reposition
                  requires Mapbox Static Images API or a second map instance. Using coordinate
                  input for MVP. */}
              <div className="bg-[#0A0A0A] rounded-xl p-4 mb-4 border border-[#333]">
                <div className="text-center text-[#888] text-sm mb-3">
                  Adjust coordinates or use your current location
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[#888] mb-1">Latitude</label>
                    <input
                      type="number"
                      step="0.0001"
                      min={-90}
                      max={90}
                      value={pinLat}
                      onChange={(e) => setPinLat(parseFloat(e.target.value) || 0)}
                      className="w-full bg-[#1A1A1A] border border-[#444] rounded-lg px-3 py-2 text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#888] mb-1">Longitude</label>
                    <input
                      type="number"
                      step="0.0001"
                      min={-180}
                      max={180}
                      value={pinLng}
                      onChange={(e) => setPinLng(parseFloat(e.target.value) || 0)}
                      className="w-full bg-[#1A1A1A] border border-[#444] rounded-lg px-3 py-2 text-white text-sm"
                    />
                  </div>
                </div>
                {userLocation && (
                  <button
                    type="button"
                    onClick={() => { setPinLat(userLocation.lat); setPinLng(userLocation.lng); }}
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
                <label className="block text-xs text-[#888] mb-1">
                  Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  maxLength={80}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameError(e.target.value.trim().length === 0 ? 'Name is required' : null);
                  }}
                  placeholder="e.g. Hollywood High 16"
                  className="w-full bg-[#0A0A0A] border border-[#444] rounded-lg px-3 py-2 text-white text-sm
                             placeholder:text-[#555] focus:outline-none focus:border-[#F97316]"
                />
                {nameError && <p className="text-red-400 text-xs mt-1">{nameError}</p>}
                <p className="text-[#555] text-xs mt-1">{name.length}/80</p>
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs text-[#888] mb-1">Description</label>
                <textarea
                  maxLength={500}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What makes this spot special?"
                  rows={3}
                  className="w-full bg-[#0A0A0A] border border-[#444] rounded-lg px-3 py-2 text-white text-sm
                             placeholder:text-[#555] focus:outline-none focus:border-[#F97316] resize-none"
                />
                <p className="text-[#555] text-xs mt-1">{description.length}/500</p>
              </div>

              {/* Obstacles */}
              <div>
                <label className="block text-xs text-[#888] mb-2">Obstacles</label>
                <div className="flex flex-wrap gap-2">
                  {ALL_OBSTACLES.map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => toggleObstacle(o)}
                      className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                        obstacles.includes(o)
                          ? 'bg-[#F97316] border-[#F97316] text-white'
                          : 'bg-transparent border-[#444] text-[#888] hover:border-[#666]'
                      }`}
                    >
                      {o.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Gnar Rating */}
              <div>
                <label className="block text-xs text-[#888] mb-1">
                  Gnar Rating <span className="text-red-400">*</span>
                </label>
                <GnarRating value={gnarRating} readonly={false} onChange={setGnarRating} />
              </div>

              {/* Bust Risk */}
              <div>
                <label className="block text-xs text-[#888] mb-1">
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
              <p className="text-sm text-[#888]">
                Add up to 5 photo URLs (optional)
              </p>

              {/* Photo previews */}
              {photoUrls.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {photoUrls.map((url, i) => (
                    <div key={i} className="relative flex-shrink-0">
                      <img
                        src={url}
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
                    className="flex-1 bg-[#0A0A0A] border border-[#444] rounded-lg px-3 py-2 text-white text-sm
                               placeholder:text-[#555] focus:outline-none focus:border-[#F97316]"
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
              {photoError && (
                <p className="text-red-400 text-xs">{photoError}</p>
              )}

              {/* Submission error */}
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full py-2.5 rounded-xl bg-[#F97316] text-white font-semibold text-sm
                           hover:bg-[#EA580C] transition-colors disabled:opacity-60"
              >
                {submitting ? 'Submitting\u2026' : 'Submit Spot'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
