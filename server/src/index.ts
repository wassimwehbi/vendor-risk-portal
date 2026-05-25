import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import './db'; // initializes the database (initDb runs on import)
import vendorsRouter from './routes/vendors';
import assessmentsRouter from './routes/assessments';
import uploadRouter from './routes/upload';
import analysisRouter from './routes/analysis';
import reviewRouter from './routes/review';
import reportsRouter from './routes/reports';
import auditRouter from './routes/audit';
import demoRouter from './routes/demo';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    data: { status: 'ok', aiEngineAvailable: Boolean(process.env.ANTHROPIC_API_KEY) },
  });
});

// All feature routers mount under /api and declare their full sub-paths.
app.use('/api', vendorsRouter);
app.use('/api', assessmentsRouter);
app.use('/api', uploadRouter);
app.use('/api', analysisRouter);
app.use('/api', reviewRouter);
app.use('/api', reportsRouter);
app.use('/api', auditRouter);
app.use('/api', demoRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

const PORT = Number(process.env.PORT) || 4100;
app.listen(PORT, () => {
  console.log(`[vendor-risk-portal] server listening on http://localhost:${PORT}`);
  console.log(`[vendor-risk-portal] AI engine: ${process.env.ANTHROPIC_API_KEY ? 'Claude (key detected)' : 'rule-based fallback'}`);
});
