import Database from 'better-sqlite3';
const db = new Database('data/helm.db');

const models = [
  'auto',
  'gemma-3-1b',
  'gemma-3-4b',
  'gemma-3-12b',
  'gemma-3-27b',
  'gemma-4-26b',
  'gemma-4-31b',
  'gemini-3.1-pro'
];

const config = {
  admin: models,
  user: models,
  anonymous: ['auto', 'gemma-3-1b']
};

db.prepare(`
  INSERT OR IGNORE INTO governance_policies (id, name, type, config, enabled)
  VALUES ('model-access', 'Model Access Control', 'access_control', ?, 1)
`).run(JSON.stringify(config));

db.prepare("UPDATE governance_policies SET config = ?, enabled = 1 WHERE id = 'model-access'")
  .run(JSON.stringify(config));

console.log('Governance models updated successfully.');
db.close();
