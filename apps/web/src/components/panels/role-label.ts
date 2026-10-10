/** The role chip text; a plain member gets none. */
export function roleLabel(role: 'owner' | 'admin' | 'member'): string | undefined {
  return role === 'member' ? undefined : role;
}
