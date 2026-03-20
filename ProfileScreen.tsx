/**
 * ProfileScreen — player card for SkateHubba™
 * Routes: /profile (self) and /profile/:username (opponent)
 *
 * Two modes:
 *  - Self: real-time listener on own profile, inline edit toggle
 *  - Opponent: single read of opponent profile, read-only
 *
 * This is supporting infrastructure for the S.K.A.T.E. game,
 * not a social media page. Keep it tight.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '../../hooks/useAuth'; // your existing auth hook
import { storage } from '../../lib/firebase'; // your existing firebase exports
import {
  subscribeToProfile,
  getProfileByUsername,
  updateProfile,
  validateUsername,
  isUsernameTaken,
  createProfile,
} from '../../lib/profile-operations';
import { ProfileStats } from '../../components/profile/ProfileStats';
import { ProfileGameHistory } from '../../components/profile/ProfileGameHistory';
import type { UserProfile, ProfileEditPayload } from '../../types/profile';

export function ProfileScreen() {
  const { username: routeUsername } = useParams<{ username: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Determine if this is the current user's own profile
  const isSelf = !routeUsername;

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!user && isSelf) {
      navigate('/login', { replace: true });
      return;
    }

    setLoading(true);
    setError(null);

    if (isSelf && user) {
      // Real-time listener for own profile
      const unsub = subscribeToProfile(
        user.uid,
        (data) => {
          setProfile(data);
          setLoading(false);
        },
        (err) => {
          console.error('[ProfileScreen] self profile error:', err);
          setError('Failed to load profile');
          setLoading(false);
        }
      );
      return unsub;
    }

    if (routeUsername) {
      // One-time read for opponent profile
      getProfileByUsername(routeUsername)
        .then((data) => {
          if (!data) {
            setError('Player not found');
          }
          setProfile(data);
          setLoading(false);
        })
        .catch((err) => {
          console.error('[ProfileScreen] opponent profile error:', err);
          setError('Failed to load profile');
          setLoading(false);
        });
    }
  }, [user, isSelf, routeUsername, navigate]);

  // -------------------------------------------------------------------------
  // Edit handlers
  // -------------------------------------------------------------------------

  const handleSave = useCallback(
    async (payload: ProfileEditPayload) => {
      if (!user || !profile) return;

      try {
        if (!profile.username) {
          // First-time profile setup
          await createProfile(user.uid, payload);
        } else {
          await updateProfile(user.uid, profile.username, payload);
        }
        setIsEditing(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save';
        throw new Error(message); // re-throw so the edit form can display it
      }
    },
    [user, profile]
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-700 border-t-orange-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-950 px-4">
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={() => navigate(-1)}
          className="rounded-lg bg-neutral-800 px-4 py-2 text-sm text-white active:bg-neutral-700"
        >
          Go back
        </button>
      </div>
    );
  }

  // No profile yet — first-time setup
  if (isSelf && !profile) {
    return (
      <div className="min-h-screen bg-neutral-950 px-4 pt-12">
        <h1 className="mb-6 text-center text-xl font-bold text-white">
          Set up your profile
        </h1>
        <ProfileEditForm
          initialData={{
            displayName: user?.displayName ?? '',
            username: '',
            bio: '',
            photoURL: user?.photoURL ?? null,
          }}
          uid={user?.uid ?? ''}
          onSave={handleSave}
          onCancel={null}
          isNewProfile
        />
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="min-h-screen bg-neutral-950 px-4 pb-24 pt-12">
      <div className="mx-auto max-w-md space-y-6">
        {/* Header: avatar + name + edit toggle */}
        {isEditing ? (
          <ProfileEditForm
            initialData={{
              displayName: profile.displayName,
              username: profile.username,
              bio: profile.bio,
              photoURL: profile.photoURL,
            }}
            uid={profile.uid}
            onSave={handleSave}
            onCancel={() => setIsEditing(false)}
            isNewProfile={false}
          />
        ) : (
          <>
            <ProfileHeader
              profile={profile}
              isSelf={isSelf}
              onEdit={() => setIsEditing(true)}
            />

            {/* Stats */}
            <ProfileStats stats={profile.stats} />

            {/* Game history */}
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
                Recent Games
              </h2>
              <ProfileGameHistory uid={profile.uid} />
            </div>

            {/* Challenge button (opponent profiles only) */}
            {!isSelf && (
              <button
                onClick={() => navigate(`/challenge/${profile.uid}`)}
                className="w-full rounded-xl bg-orange-500 py-3.5 text-center text-sm font-bold uppercase tracking-wider text-black active:bg-orange-600"
              >
                Challenge @{profile.username}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProfileHeader (read-only)
// ---------------------------------------------------------------------------

function ProfileHeader({
  profile,
  isSelf,
  onEdit,
}: {
  profile: UserProfile;
  isSelf: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-start gap-4">
      {/* Avatar */}
      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-neutral-800">
        {profile.photoURL ? (
          <img
            src={profile.photoURL}
            alt={profile.displayName}
            className="h-20 w-20 rounded-full object-cover"
          />
        ) : (
          <span className="text-2xl font-bold text-neutral-500">
            {profile.displayName.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      {/* Name + bio */}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-bold text-white">
          {profile.displayName}
        </h1>
        <p className="text-sm text-neutral-500">@{profile.username}</p>
        {profile.bio && (
          <p className="mt-1 text-sm leading-relaxed text-neutral-400">
            {profile.bio}
          </p>
        )}
      </div>

      {/* Edit button (self only) */}
      {isSelf && (
        <button
          onClick={onEdit}
          className="shrink-0 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-400 active:bg-neutral-800"
        >
          Edit
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProfileEditForm (inline edit mode)
// ---------------------------------------------------------------------------

function ProfileEditForm({
  initialData,
  uid,
  onSave,
  onCancel,
  isNewProfile,
}: {
  initialData: ProfileEditPayload;
  uid: string;
  onSave: (payload: ProfileEditPayload) => Promise<void>;
  onCancel: (() => void) | null;
  isNewProfile: boolean;
}) {
  const [displayName, setDisplayName] = useState(initialData.displayName);
  const [username, setUsername] = useState(initialData.username);
  const [bio, setBio] = useState(initialData.bio);
  const [photoURL, setPhotoURL] = useState(initialData.photoURL);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUsernameChange = (value: string) => {
    const clean = value.toLowerCase().replace(/\s/g, '');
    setUsername(clean);
    const validation = validateUsername(clean);
    setUsernameError(validation.error);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type and size
    if (!file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) {
      setSaveError('Image must be under 5MB');
      return;
    }

    setUploading(true);
    try {
      const storageRef = ref(storage, `avatars/${uid}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      setPhotoURL(url);
    } catch {
      setSaveError('Failed to upload image');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    // Validate
    const validation = validateUsername(username);
    if (!validation.valid) {
      setUsernameError(validation.error);
      return;
    }
    if (!displayName.trim()) {
      setSaveError('Display name is required');
      return;
    }

    // Check username availability if changed
    if (username !== initialData.username) {
      const taken = await isUsernameTaken(username);
      if (taken) {
        setUsernameError('Username is already taken');
        return;
      }
    }

    setSaving(true);
    setSaveError(null);

    try {
      await onSave({ displayName, username, bio, photoURL });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Avatar upload */}
      <div className="flex justify-center">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="relative flex h-20 w-20 items-center justify-center rounded-full bg-neutral-800 active:bg-neutral-700"
        >
          {photoURL ? (
            <img
              src={photoURL}
              alt="Avatar"
              className="h-20 w-20 rounded-full object-cover"
            />
          ) : (
            <span className="text-xs text-neutral-500">
              {uploading ? '...' : 'Photo'}
            </span>
          )}
          <div className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full bg-orange-500">
            <span className="text-xs text-black">+</span>
          </div>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleAvatarUpload}
          className="hidden"
        />
      </div>

      {/* Display name */}
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-500">
          Display Name
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={30}
          className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-sm text-white placeholder-neutral-600 outline-none focus:border-orange-500"
          placeholder="Your name"
        />
      </div>

      {/* Username */}
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-500">
          Username
        </label>
        <div className="flex items-center rounded-lg border border-neutral-800 bg-neutral-900 focus-within:border-orange-500">
          <span className="pl-3 text-sm text-neutral-600">@</span>
          <input
            type="text"
            value={username}
            onChange={(e) => handleUsernameChange(e.target.value)}
            maxLength={20}
            className="w-full bg-transparent px-1 py-2.5 text-sm text-white placeholder-neutral-600 outline-none"
            placeholder="username"
          />
        </div>
        {usernameError && (
          <p className="mt-1 text-xs text-red-400">{usernameError}</p>
        )}
      </div>

      {/* Bio */}
      <div>
        <label className="mb-1 flex items-center justify-between text-xs font-medium uppercase tracking-wider text-neutral-500">
          <span>Bio</span>
          <span className="normal-case tracking-normal">{bio.length}/150</span>
        </label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, 150))}
          rows={3}
          className="w-full resize-none rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-sm text-white placeholder-neutral-600 outline-none focus:border-orange-500"
          placeholder="Keep it short"
        />
      </div>

      {/* Error */}
      {saveError && (
        <p className="rounded-lg bg-red-950/30 px-3 py-2 text-xs text-red-400">
          {saveError}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 rounded-lg border border-neutral-700 py-3 text-sm font-medium text-neutral-400 active:bg-neutral-800"
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleSubmit}
          disabled={saving || uploading || !!usernameError}
          className="flex-1 rounded-xl bg-orange-500 py-3 text-sm font-bold text-black disabled:opacity-50 active:bg-orange-600"
        >
          {saving ? 'Saving...' : isNewProfile ? 'Create Profile' : 'Save'}
        </button>
      </div>
    </div>
  );
}
