import Database from 'better-sqlite3';
const db = new Database('data/helm.db');

const policy = db.prepare("SELECT id, config, enabled FROM governance_policies WHERE id = 'model-access'").get();
console.log('POLICY:', JSON.stringify(policy, null, 2));

const user = db.prepare("SELECT username, role FROM users LIMIT 1").get();
console.log('USER:', JSON.stringify(user, null, 2));

db.close();
