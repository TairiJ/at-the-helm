import { useState } from 'react';
import { login, register } from '../services/api';
import type { User } from '../types';

interface Props {
  onLogin: (user: User) => void;
  onClose: () => void;
}

export function AuthModal({ onLogin, onClose }: Props) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let data;
      if (isRegister) {
        data = await register(username, password, displayName || undefined);
      } else {
        data = await login(username, password);
      }
      onLogin(data.user);
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    }
    setLoading(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          {isRegister ? '⚓ Create Account' : '⚓ Sign In to the Helm'}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Username</label>
            <input
              className="form-input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              autoFocus
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              className="form-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              required
            />
          </div>

          {isRegister && (
            <div className="form-group">
              <label className="form-label">Display Name (optional)</label>
              <input
                className="form-input"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How should we call you?"
              />
            </div>
          )}

          {error && <div className="form-error">{error}</div>}

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? '...' : isRegister ? 'Create Account' : 'Sign In'}
            </button>
          </div>
        </form>

        <div className="form-toggle">
          {isRegister ? (
            <>Already have an account? <button onClick={() => setIsRegister(false)}>Sign In</button></>
          ) : (
            <>Need an account? <button onClick={() => setIsRegister(true)}>Register</button></>
          )}
        </div>
      </div>
    </div>
  );
}
