import { Btn } from "../components/ui/Btn";

/** Email form submit button with an inline spinner while the request runs. */
export function AuthSubmitButton({
  isSignup,
  loading,
  disabled,
}: {
  isSignup: boolean;
  loading: boolean;
  disabled: boolean;
}) {
  return (
    <Btn type="submit" disabled={disabled}>
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          {isSignup ? "Creating Account…" : "Signing In…"}
        </span>
      ) : isSignup ? (
        "Create Account"
      ) : (
        "Sign In"
      )}
    </Btn>
  );
}
