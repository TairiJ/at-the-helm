import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env BEFORE anything else
const __dirnameTmp = path.dirname(fileURLToPath(import.meta.url));
const envResult = dotenv.config({ path: path.resolve(__dirnameTmp, '../../.env') });
if (envResult.error) {
  // Try alternative path (when running from project root)
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

// Now dynamically import everything that needs env vars
const { default: express } = await import('express');
const { default: cors } = await import('cors');
const { getDb, closeDb } = await import('./db/database.js');
const { seedDatabase } = await import('./db/seed.js');
import { authMiddleware } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import ragRoutes from './routes/rag.js';
import governanceRoutes from './routes/governance.js';
import backupRoutes from './routes/backup.js';
import { startGuardian, stopGuardian } from './services/guardian.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV !== 'production';

console.log('⚓ ENV check — GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? '✓ loaded' : '✗ missing');
console.log('⚓ ENV check — ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? '✓ loaded' : '✗ missing');
console.log('⚓ ENV check — OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✓ loaded' : '✗ missing');

async function main() {
  // Initialize database
  console.log('⚓ Initializing database...');
  getDb();
  await seedDatabase();

  const app = express();

  // Debug: Request Logger (TOP LEVEL)
  app.use((req, _res, next) => {
    console.log(`⚓ Incoming: ${req.method} ${req.url}`);
    next();
  });

  // Middleware
  app.use(cors({
    origin: isDev ? true : false,
    credentials: true,
  }));
  app.use(express.json({ limit: '10mb' }));
  app.use(authMiddleware);

  // API Routes
  console.log('⚓ Auth Routes Status:', { type: typeof authRoutes, isRouter: !!(authRoutes as any)?.stack });
  app.use('/api/auth', authRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/rag', ragRoutes);
  app.use('/api/governance', governanceRoutes);
  app.use('/api/backup', backupRoutes);

  // Debug: Log all routes
  const router = (app as any)._router;
  if (router && router.stack) {
    const routes = router.stack
      .filter((r: any) => r.route || r.name === 'router')
      .map((r: any) => {
        if (r.route) return `${Object.keys(r.route.methods).join(',').toUpperCase()} ${r.route.path}`;
        if (r.name === 'router') return `ROUTER ${r.regexp}`;
        return r.name;
      });
    console.log('⚓ Registered Routes:', routes);
  }

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', name: 'At The Helm', version: '1.0.0' });
  });

  // Serve frontend in production
  if (!isDev) {
    const clientDist = path.resolve(__dirname, '../../client/dist');
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.listen(PORT as number, '0.0.0.0', () => {
    console.log(`
  ⚓ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ⚓  AT THE HELM — AI Operator Cockpit
  ⚓  Server running on http://0.0.0.0:${PORT}
  ⚓  Environment: ${isDev ? 'development' : 'production'}
  ⚓ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
    // Start the Rust guardian daemon after the server is up
    startGuardian();
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n⚓ Shutting down...');
    stopGuardian();
    closeDb();
    process.exit(0);
  });
}

main().catch(console.error);
