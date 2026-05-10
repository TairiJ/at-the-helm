import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';

type Role = 'anonymous' | 'user' | 'admin';

const ROLE_HIERARCHY: Record<Role, number> = {
  anonymous: 0,
  user: 1,
  admin: 2,
};

/**
 * RBAC middleware factory — restricts route to minimum role level.
 */
export function requireRole(...allowedRoles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const userRole = req.user?.role || 'anonymous';

    if (allowedRoles.includes(userRole as Role)) {
      next();
      return;
    }

    // Check hierarchy — admin can access everything
    const userLevel = ROLE_HIERARCHY[userRole as Role] ?? 0;
    const minRequired = Math.min(...allowedRoles.map(r => ROLE_HIERARCHY[r]));

    if (userLevel >= minRequired) {
      next();
      return;
    }

    res.status(403).json({
      error: 'Forbidden',
      message: `This action requires one of: ${allowedRoles.join(', ')}`,
    });
  };
}

/**
 * Helper to check if user can access a resource based on ownership and public flag.
 */
export function canAccessDocument(
  userRole: Role,
  userId: string,
  docUserId: string,
  isPublic: boolean
): boolean {
  if (userRole === 'admin') return true;
  if (isPublic) return true;
  if (userRole === 'user' && userId === docUserId) return true;
  return false;
}

/**
 * Returns SQL WHERE clause fragment for RAG queries based on role.
 */
export function ragAccessFilter(role: Role, userId: string): { clause: string; params: any[] } {
  switch (role) {
    case 'admin':
      return { clause: '1=1', params: [] };
    case 'user':
      return { clause: '(d.is_public = 1 OR d.user_id = ?)', params: [userId] };
    case 'anonymous':
    default:
      return { clause: 'd.is_public = 1', params: [] };
  }
}
