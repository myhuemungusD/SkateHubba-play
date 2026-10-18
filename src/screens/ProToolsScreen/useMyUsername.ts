import { useEffect, useState } from "react";
import { getUserProfile } from "../../services/users";

/** The signed-in pro's username for stamping pro-community writes; "" until loaded or when uid is null. */
export function useMyUsername(uid: string | null): string {
  const [username, setUsername] = useState("");
  useEffect(() => {
    if (!uid) return;
    let live = true;
    getUserProfile(uid).then(
      (p) => live && setUsername(p?.username ?? ""),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [uid]);
  return uid ? username : "";
}
