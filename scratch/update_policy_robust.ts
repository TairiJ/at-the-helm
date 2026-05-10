import Database from 'better-sqlite3';
import path from 'path';

// Try both paths just in case
const paths = [
  'data/helm.db',
  'server/data/helm.db',
  'server/at-the-helm.db'
];

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
  anonymous: ['auto']
};

for (const p of paths) {
  try {
    const db = new Database(p);
    db.prepare("UPDATE governance_policies SET config = ?, enabled = 1 WHERE id = 'model-access'")
      .run(JSON.stringify(config));
    console.log(`Updated ${p}`);
    db.close();
  } catch (e: any) {
    console.log(`Skipped ${p}: ${e.message}`);
  }
}
