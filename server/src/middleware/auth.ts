import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../db/database.js';

export interface AuthUser {
  id: string;
  username: string;
  role: 'anonymous' | 'user' | 'admin';
  displayName: string;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

const JWT_SECRET = process.env.JWT_SECRET || 'at-the-helm-dev-secret';

export function generateToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

export function verifyToken(token: string): AuthUser | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthUser;
  } catch {
    return null;
  }
}

/**
 * Auth middleware — attaches user to request.
 * If no valid token, assigns anonymous role.
 */
export function authMiddleware(req: AuthRequest, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const decoded = verifyToken(token);

    if (decoded) {
      // Fetch fresh user data from DB
      const db = getDb();
      const dbUser = db.prepare('SELECT id, username, role, display_name FROM users WHERE id = ?').get(decoded.id) as any;

      if (dbUser) {
        console.log(`⚓ Auth Success: ${dbUser.username} (${dbUser.id})`);
        req.user = {
          id: dbUser.id,
          username: dbUser.username,
          role: dbUser.role,
          displayName: dbUser.display_name || dbUser.username,
        };
        next();
        return;
      } else {
        console.warn(`⚓ Auth Failure: ID ${decoded.id} in token not found in DB`);
      }
    }
  }

  // No valid auth — assign anonymous
  req.user = {
    id: 'anonymous-user',
    username: 'anonymous',
    role: 'anonymous',
    displayName: 'Anonymous',
  };
  next();
}
