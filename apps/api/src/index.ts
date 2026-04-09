import express from 'express';
import spotsRouter from './routes/spots';

const app = express();

app.use(express.json({ limit: '10kb' }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Spot routes
app.use('/api/spots', spotsRouter);

// Vercel serverless export
export default app;

// Local dev server
if (process.env.NODE_ENV !== 'production') {
  const port = process.env.PORT ?? 3001;
  app.listen(port, () => {
    console.warn(`API server listening on port ${port}`);
  });
}
