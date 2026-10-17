/**
 * Permissions the recorder needs. Neither is in the DOM lib's `PermissionName`
 * union (it only covers the names every engine implements), hence the cast at
 * the query site.
 */
type MediaPermissionName = "camera" | "microphone";

/**
 * Current grant state, or "unknown" when we cannot tell. Safari and Firefox
 * throw for names they don't support and older engines have no
 * `navigator.permissions` at all; every failure resolves to "unknown" so we
 * never assume access we don't have.
 */
async function queryMediaPermission(name: MediaPermissionName): Promise<PermissionState | "unknown"> {
  try {
    const status = await navigator.permissions.query({ name: name as PermissionName });
    return status.state;
  } catch {
    return "unknown";
  }
}

/** True only when camera AND mic are already granted, i.e. no prompt will show. */
export async function hasGrantedCameraAndMic(): Promise<boolean> {
  const [camera, microphone] = await Promise.all([queryMediaPermission("camera"), queryMediaPermission("microphone")]);
  return camera === "granted" && microphone === "granted";
}
