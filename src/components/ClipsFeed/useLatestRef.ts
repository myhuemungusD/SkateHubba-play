import { useEffect, useRef, type MutableRefObject } from "react";

/**
 * Mirror a value into a ref after each commit, so stable callbacks can read
 * the latest value without listing it as a dependency.
 */
export function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef<T>(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
