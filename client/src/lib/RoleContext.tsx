// Back-compat shim: role/permission info now comes from the authenticated
// session (see AuthContext). Existing pages can keep importing `useRole`.
import { useAuth } from './AuthContext';

export function useRole(): { canEdit: boolean; canApprove: boolean } {
  const { canEdit, canApprove } = useAuth();
  return { canEdit, canApprove };
}
