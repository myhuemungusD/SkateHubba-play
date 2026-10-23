import { useCallback, useState } from "react";

export const TERMS_REQUIRED_ERROR = "Agree to the Terms and Privacy Policy to continue";

/**
 * Required Terms agreement (App Review 1.2) plus its a11y wiring. After an
 * unchecked submit the checkbox is aria-invalid and described by the error
 * banner whose message span carries `errorId`; ticking the box clears it.
 */
export function useTermsGate(localError: string, setLocalError: (msg: string) => void, errorId: string) {
  const [agreed, setAgreed] = useState(false);
  const invalid = !agreed && localError === TERMS_REQUIRED_ERROR;
  const onChange = useCallback(
    (next: boolean) => {
      setAgreed(next);
      if (next && invalid) setLocalError("");
    },
    [invalid, setLocalError],
  );
  return { agreed, checkboxProps: { checked: agreed, onChange, invalid, errorId } };
}
