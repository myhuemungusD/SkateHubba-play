interface Props {
  trickName: string;
  setTrickName: (value: string) => void;
  videoRecorded: boolean;
  showRecorder: boolean;
  trimmedTrickName: string;
}

export function SetterTrickInput({ trickName, setTrickName, videoRecorded, showRecorder, trimmedTrickName }: Props) {
  return (
    <div className="text-center mb-5 rounded-2xl border bg-brand-orange/[0.06] backdrop-blur-sm border-brand-orange/30 shadow-[0_0_20px_rgba(255,107,0,0.06)]">
      <label
        htmlFor="trickNameInput"
        className="font-display text-[11px] tracking-[0.2em] text-brand-orange block pt-3"
      >
        TRICK NAME
      </label>
      <input
        id="trickNameInput"
        type="text"
        value={trickName}
        onChange={(e) => setTrickName(e.target.value)}
        placeholder="Name your trick"
        maxLength={60}
        disabled={videoRecorded}
        autoCapitalize="words"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="w-full bg-transparent text-center font-display text-base tracking-wider text-brand-orange py-1 px-4 outline-none placeholder:text-brand-orange/60 disabled:opacity-40 disabled:cursor-not-allowed"
      />
      {trimmedTrickName && <p className="font-body text-xs text-brand-orange/80 pb-1">Set your {trimmedTrickName}</p>}
      {!showRecorder && !trimmedTrickName && (
        <span className="text-xs text-faint pb-2 block">Name your trick to start recording</span>
      )}
    </div>
  );
}
