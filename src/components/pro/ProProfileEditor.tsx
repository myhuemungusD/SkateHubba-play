import { useState } from "react";
import {
  PRO_BIO_MAX,
  PRO_HOMETOWN_MAX,
  PRO_SPONSOR_MAX,
  PRO_SPONSORS_MAX,
  PRO_TAGLINE_MAX,
  PRO_TRICKS_MAX,
  TRICK_CATALOG,
} from "../../constants/trickCatalog";
import { saveProProfile, type ProProfileEdit } from "../../services/proProfile";
import { getUserMessage } from "../../utils/helpers";

interface Props {
  uid: string;
  initial: ProProfileEdit;
  onSaved: (saved: ProProfileEdit) => void;
  onCancel: () => void;
}

const LABEL = "mb-1 block font-display text-[11px] tracking-[0.2em] text-brand-orange";
const INPUT =
  "mb-3 min-h-[44px] w-full rounded-xl border border-white/[0.08] bg-surface-alt px-3 font-body text-sm text-white";
const CHIP = "min-h-[36px] rounded-lg border px-2.5 font-body text-xs transition-colors";

/** A verified pro writes their own tagline, hometown, sponsors and bio, and picks up to three signature tricks. */
export function ProProfileEditor({ uid, initial, onSaved, onCancel }: Props) {
  const [bio, setBio] = useState(initial.bio);
  const [tricks, setTricks] = useState<string[]>(initial.signatureTricks);
  const [tagline, setTagline] = useState(initial.tagline);
  const [hometown, setHometown] = useState(initial.hometown);
  const [sponsors, setSponsors] = useState<string[]>(() =>
    Array.from({ length: PRO_SPONSORS_MAX }, (_, i) => initial.sponsors[i] ?? ""),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const toggle = (t: string) =>
    setTricks((cur) =>
      cur.includes(t) ? cur.filter((x) => x !== t) : cur.length < PRO_TRICKS_MAX ? [...cur, t] : cur,
    );

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      onSaved(await saveProProfile(uid, { bio, signatureTricks: tricks, tagline, hometown, sponsors }));
    } catch (err) {
      setError(getUserMessage(err, "Couldn't save. Try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-label="Edit pro profile"
      data-testid="pro-profile-editor"
      className="mb-4 rounded-2xl border border-amber-300/20 bg-surface p-4"
    >
      <label htmlFor="pro-tagline" className={LABEL}>
        TAGLINE
      </label>
      <input
        id="pro-tagline"
        value={tagline}
        maxLength={PRO_TAGLINE_MAX}
        onChange={(e) => setTagline(e.target.value)}
        className={INPUT}
      />
      <label htmlFor="pro-hometown" className={LABEL}>
        HOMETOWN
      </label>
      <input
        id="pro-hometown"
        value={hometown}
        maxLength={PRO_HOMETOWN_MAX}
        autoComplete="address-level2"
        onChange={(e) => setHometown(e.target.value)}
        className={INPUT}
      />
      <fieldset className="mb-1">
        <legend className={LABEL}>SPONSORS</legend>
        {sponsors.map((s, i) => (
          <input
            key={i}
            aria-label={`Sponsor ${i + 1}`}
            value={s}
            maxLength={PRO_SPONSOR_MAX}
            onChange={(e) => setSponsors((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
            className={INPUT}
          />
        ))}
      </fieldset>
      <label htmlFor="pro-bio" className={LABEL}>
        BIO
      </label>
      <textarea
        id="pro-bio"
        value={bio}
        maxLength={PRO_BIO_MAX}
        rows={4}
        onChange={(e) => setBio(e.target.value)}
        placeholder="In your own words: where you skate, what you're into."
        className="w-full rounded-xl border border-white/[0.08] bg-surface-alt p-3 font-body text-sm text-white"
      />
      <p className="mb-3 text-right font-body text-[11px] text-white/50 tabular-nums">
        {bio.length}/{PRO_BIO_MAX}
      </p>
      <fieldset>
        <legend className="mb-2 font-display text-[11px] tracking-[0.2em] text-brand-orange">
          SIGNATURE TRICKS ({tricks.length}/{PRO_TRICKS_MAX})
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {TRICK_CATALOG.map((t) => {
            const on = tricks.includes(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(t)}
                disabled={!on && tricks.length >= PRO_TRICKS_MAX}
                className={`${CHIP} ${on ? "border-amber-300 bg-amber-300/15 text-amber-100" : "border-white/[0.08] bg-surface-alt text-white/80 disabled:opacity-40"}`}
              >
                {t}
              </button>
            );
          })}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="mt-3 font-body text-xs text-red-300">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] flex-1 rounded-xl border border-white/[0.08] font-display text-xs tracking-wider text-white/80"
        >
          CANCEL
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="min-h-[44px] flex-1 rounded-xl bg-gradient-to-r from-amber-400 to-brand-orange font-display text-xs tracking-wider text-black disabled:opacity-60"
        >
          {saving ? "SAVING…" : "SAVE"}
        </button>
      </div>
    </section>
  );
}
