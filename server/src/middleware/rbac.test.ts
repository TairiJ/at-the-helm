import { describe, it, expect, vi } from 'vitest';
import { requireRole, canAccessDocument, ragAccessFilter } from './rbac.js';
import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';

describe('RBAC Middleware', () => {
  describe('requireRole', () => {
    it('should allow access if user has the exact required role', () => {
      const req = { user: { role: 'admin' } } as AuthRequest;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
      const next = vi.fn() as NextFunction;

      const middleware = requireRole('admin');
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should allow access if user has a higher role in the hierarchy', () => {
      const req = { user: { role: 'admin' } } as AuthRequest;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
      const next = vi.fn() as NextFunction;

      const middleware = requireRole('user');
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should forbid access if user has a lower role', () => {
      const req = { user: { role: 'user' } } as AuthRequest;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
      const next = vi.fn() as NextFunction;

      const middleware = requireRole('admin');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should default to anonymous if no user is present', () => {
      const req = {} as AuthRequest;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
      const next = vi.fn() as NextFunction;

      const middleware = requireRole('user');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('canAccessDocument', () => {
    it('should allow admin to access anything', () => {
      expect(canAccessDocument('admin', 'u1', 'u2', false)).toBe(true);
    });

    it('should allow access if document is public', () => {
      expect(canAccessDocument('user', 'u1', 'u2', true)).toBe(true);
    });

    it('should allow access if user is the owner', () => {
      expect(canAccessDocument('user', 'u1', 'u1', false)).toBe(true);
    });

    it('should forbid access if user is not the owner and doc is private', () => {
      expect(canAccessDocument('user', 'u1', 'u2', false)).toBe(false);
    });
  });

  describe('ragAccessFilter', () => {
    it('should return 1=1 for admin', () => {
      const result = ragAccessFilter('admin', 'u1');
      expect(result.clause).toBe('1=1');
      expect(result.params).toEqual([]);
    });

    it('should return ownership check for user', () => {
      const result = ragAccessFilter('user', 'u1');
      expect(result.clause).toContain('is_public = 1 OR d.user_id = ?');
      expect(result.params).toEqual(['u1']);
    });

    it('should return only public for anonymous', () => {
      const result = ragAccessFilter('anonymous', 'u1');
      expect(result.clause).toBe('d.is_public = 1');
      expect(result.params).toEqual([]);
    });
  });
});
