// Calibration seed: four intentional issues for agent validation.
// Issue A — plaintext credential in localStorage (security, must publish)
// Issue B — async fetch with no error handling (correctness, must publish)
// Issue C — loose equality (== vs ===) (Semgrep target)
// Issue D — useEffect with missing deps (false-positive bait, must be rejected)

export function saveSession(token) {
  // A: credential written to localStorage in plaintext
  localStorage.setItem('auth_token', token);
}

export async function loadUserData(userId) {
  // B: no try/catch, unhandled rejection
  const res = await fetch(`/api/users/${userId}`);
  const data = await res.json();
  return data;
}

export function checkStatus(code) {
  // C: loose equality — Semgrep p/javascript flags this
  if (code == 200) {
    return 'ok';
  }
  return 'error';
}

// D: React hook with intentionally empty dependency array
// (false-positive bait — agent should NOT flag this as a bug
//  without seeing the surrounding component context)
import { useEffect } from 'react';
export function useLogger(label) {
  useEffect(() => {
    console.log(`mounted: ${label}`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
