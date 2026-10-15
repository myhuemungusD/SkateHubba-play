import { useState } from "react";
import { Field } from "../components/ui/Field";
import { PasswordToggle } from "../components/ui/PasswordToggle";
import { PasswordStrengthMeter } from "../components/PasswordStrengthMeter";
import type { SignupPasswordPolicy } from "../utils/passwordPolicy";

interface AuthPasswordFieldsProps {
  isSignup: boolean;
  /** DOB inputs follow the confirm field, so its Enter key moves on. */
  showDob: boolean;
  password: string;
  setPassword: (v: string) => void;
  confirm: string;
  setConfirm: (v: string) => void;
  policy: SignupPasswordPolicy;
}

/** Password (+ strength meter and confirm on signup) with show/hide toggles. */
export function AuthPasswordFields({
  isSignup,
  showDob,
  password,
  setPassword,
  confirm,
  setConfirm,
  policy,
}: AuthPasswordFieldsProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  return (
    <>
      <Field
        label="Password"
        name="password"
        value={password}
        onChange={setPassword}
        placeholder="••••••••"
        icon="🔒"
        type={showPassword ? "text" : "password"}
        rightSlot={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
        autoComplete={isSignup ? "new-password" : "current-password"}
        enterKeyHint={isSignup ? "next" : "go"}
      />
      {isSignup && <PasswordStrengthMeter password={password} policy={policy} />}
      {isSignup && (
        <Field
          label="Confirm"
          name="confirm-password"
          value={confirm}
          onChange={setConfirm}
          placeholder="••••••••"
          icon="🔒"
          type={showConfirm ? "text" : "password"}
          rightSlot={
            <PasswordToggle visible={showConfirm} onToggle={() => setShowConfirm((v) => !v)} label="confirm password" />
          }
          autoComplete="new-password"
          enterKeyHint={showDob ? "next" : "go"}
        />
      )}
    </>
  );
}
