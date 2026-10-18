/** Inline error / success line under a pro tool form. */
export function Status({ error, ok }: { error: string; ok: string }) {
  if (error)
    return (
      <p role="alert" className="mt-2 font-body text-xs text-red-300">
        {error}
      </p>
    );
  return ok ? <p className="mt-2 font-body text-xs text-emerald-300">{ok}</p> : null;
}
