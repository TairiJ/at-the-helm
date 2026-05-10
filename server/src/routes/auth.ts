import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/database.js';
import { AuthRequest, generateToken } from '../middleware/auth.js';
import { logAudit } from '../middleware/governance.js';

const router = Router();
console.log('⚓ Auth Router Initialized');

// POST /api/auth/register
router.post('/register', async (req: AuthRequest, res: Response): Promise<void> => {
  const { username, password, displayName } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  if (username.length < 3 || password.length < 6) {
    res.status(400).json({ error: 'Username must be 3+ chars, password 6+ chars' });
    return;
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);

  if (existing) {
    res.status(409).json({ error: 'Username already taken' });
    return;
  }

  const id = uuid();
  const hash = await bcrypt.hash(password, 12);

  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, display_name)
    VALUES (?, ?, ?, 'user', ?)
  `).run(id, username, hash, displayName || username);

  const user = { id, username, role: 'user' as const, displayName: displayName || username };
  const token = generateToken(user);

  logAudit({ userId: id, action: 'register', status: 'success' });

  res.status(201).json({ user, token });
});

// POST /api/auth/login
router.post('/login', async (req: AuthRequest, res: Response): Promise<void> => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  const db = getDb();
  const dbUser = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;

  if (!dbUser) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password, dbUser.password_hash);
  if (!valid) {
    logAudit({ userId: dbUser.id, action: 'login_failed', status: 'error' });
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  // Update last login
  db.prepare('UPDATE users SET last_login = datetime(\'now\') WHERE id = ?').run(dbUser.id);

  const user = {
    id: dbUser.id,
    username: dbUser.username,
    role: dbUser.role,
    displayName: dbUser.display_name || dbUser.username,
  };
  const token = generateToken(user);

  logAudit({ userId: dbUser.id, action: 'login', status: 'success' });

  res.json({ user, token });
});

// GET /api/auth/me
router.get('/me', (req: AuthRequest, res: Response): void => {
  res.json({ user: req.user });
});

// GET /api/auth/preferences
router.get('/preferences', (req: AuthRequest, res: Response): void => {
  if (!req.user || req.user.role === 'anonymous') {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const db = getDb();
  let prefs = db.prepare(`
    SELECT 
      p.user_id,
      p.is_vault_enabled,
      p.theme,
      p.notifications_enabled,
      p.updated_at,
      u.resonance_key as resonance_key_hash
    FROM user_preferences p
    JOIN users u ON p.user_id = u.id
    WHERE p.user_id = ?
  `).get(req.user.id) as any;

  if (!prefs) {
    // Create default preferences row if missing
    db.prepare('INSERT OR IGNORE INTO user_preferences (user_id) VALUES (?)').run(req.user.id);
    prefs = db.prepare(`
      SELECT 
        p.user_id,
        p.is_vault_enabled,
        p.theme,
        p.notifications_enabled,
        p.updated_at,
        u.resonance_key as resonance_key_hash
      FROM user_preferences p
      JOIN users u ON p.user_id = u.id
      WHERE p.user_id = ?
    `).get(req.user.id);
  }

  res.json(prefs);
});

// POST /api/auth/preferences
router.post('/preferences', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || req.user.role === 'anonymous') {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const { resonance_key, is_vault_enabled, theme, notifications_enabled } = req.body;
    const db = getDb();
    
    console.log(`⚓ Sync Attempt: User=${req.user.id}, KeyProvided=${resonance_key !== undefined}`);

    // Verify user still exists in primary identity store
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as any;
    const allUsers = db.prepare('SELECT id FROM users').all() as any[];
    const userExists = db.prepare('SELECT id FROM users WHERE id = ?').get(req.user.id);
    
    console.log(`⚓ Sync Diagnostic: ID=${req.user.id}, Total=${userCount.count}, Found=${!!userExists}`);
    if (!userExists) {
      console.log(`⚓ DB Users: ${JSON.stringify(allUsers.map(u => u.id))}`);
    }

    if (!userExists) {
      const msg = `Pilot identity (${req.user.id}) not found. DB has ${userCount.count} users: ${allUsers.map(u => u.id.substring(0,8)).join(', ')}`;
      console.error(`⚓ Sync Error: ${msg}`);
      res.status(404).json({ error: msg });
      return;
    }

    const existing = db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(req.user.id) as any;

    // Handle Resonance Key separately for NULL/Empty logic
    // We prioritize the new key from body, then the existing preference key, then null
    let finalKey = resonance_key === '' ? null : (resonance_key !== undefined ? resonance_key : (existing?.resonance_key_hash || null));
    
    console.log(`⚓ Resolved Key: ${finalKey}`);

    // 1. Update Identity Store (Users table)
    if (resonance_key !== undefined) {
      db.prepare('UPDATE users SET resonance_key = ? WHERE id = ?').run(finalKey, req.user.id);
    }
    
    // 2. Ensure Preference Row Exists
    if (!existing) {
      db.prepare('INSERT INTO user_preferences (user_id) VALUES (?)').run(req.user.id);
    }

    // 3. Update Customization Store (user_preferences table)
    const customizations: string[] = [];
    const custParams: any[] = [];

    if (is_vault_enabled !== undefined) {
      customizations.push('is_vault_enabled = ?');
      custParams.push(is_vault_enabled ? 1 : 0);
    }
    if (theme !== undefined) {
      customizations.push('theme = ?');
      custParams.push(theme);
    }
    if (notifications_enabled !== undefined) {
      customizations.push('notifications_enabled = ?');
      custParams.push(notifications_enabled ? 1 : 0);
    }

    if (customizations.length > 0) {
      customizations.push('updated_at = datetime(\'now\')');
      custParams.push(req.user.id);
      db.prepare(`UPDATE user_preferences SET ${customizations.join(', ')} WHERE user_id = ?`).run(...custParams);
    }

    // 4. Return Unified Profile
    const updatedPrefs = db.prepare(`
      SELECT 
        p.user_id,
        p.is_vault_enabled,
        p.theme,
        p.notifications_enabled,
        p.updated_at,
        u.resonance_key as resonance_key_hash
      FROM user_preferences p
      JOIN users u ON p.user_id = u.id
      WHERE p.user_id = ?
    `).get(req.user.id);
    
    res.json(updatedPrefs);
  } catch (err: any) {
    console.error('⚓ Preference Sync Failure:', err);
    res.status(500).json({ error: err.message || 'Cockpit synchronization failed' });
  }
});

export default router;
