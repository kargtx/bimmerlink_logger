const path = require('path');
const express = require('express');
const multer = require('multer');
const helmet = require('helmet');
const { sliceAndDownsample } = require('./downsample');

function createApp({ store, root }) {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage() });

  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'upgrade-insecure-requests': null
        }
      },
      // сервис часто открывают по http в локальной сети
      strictTransportSecurity: false,
      crossOriginOpenerPolicy: false,
      originAgentCluster: false
    })
  );
  app.use(express.json({ limit: '1mb' }));

  const api = express.Router();
  const idParam = (req) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('Некорректный id.'), { status: 400 });
    return id;
  };

  api.get('/health', (_req, res) => res.json({ ok: true }));

  api.get('/logs', (_req, res) => res.json({ logs: store.listLogs() }));

  api.post('/logs', upload.single('logfile'), (req, res) => {
    if (!req.file) throw Object.assign(new Error('Файл не был загружен.'), { status: 400 });
    const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const log = store.createLog({ buffer: req.file.buffer, filename, name: req.body.name });
    res.status(201).json(log);
  });

  api.get('/logs/:id', (req, res) => res.json(store.getLog(idParam(req))));

  api.patch('/logs/:id', (req, res) => {
    const { name, notes } = req.body || {};
    res.json(store.updateLog(idParam(req), { name, notes }));
  });

  api.delete('/logs/:id', (req, res) => {
    const id = idParam(req);
    store.deleteLog(id);
    res.json({ success: true, deletedId: id });
  });

  api.get('/logs/:id/data', (req, res) => {
    const id = idParam(req);
    const log = store.getLog(id);
    const data = store.getData(id);
    const wanted = String(req.query.ch || '')
      .split(',')
      .filter((s) => s !== '')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0 && n < log.channels.length);
    const channels = wanted.length ? [...new Set(wanted)] : log.channels.map((c) => c.idx);
    const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
    const result = sliceAndDownsample(
      data.time,
      channels.map((c) => data.series[c]),
      { from: num(req.query.from), to: num(req.query.to), points: num(req.query.points) || 2000 }
    );
    res.json({ channels, time: result.time, series: result.series, downsampled: result.downsampled });
  });

  api.get('/logs/:id/raw', (req, res) => {
    const id = idParam(req);
    const log = store.getLog(id);
    res.download(store.rawPath(id), log.filename);
  });

  api.get('/presets', (_req, res) => res.json({ presets: store.presets.list() }));
  api.post('/presets', (req, res) => res.status(201).json(store.presets.create(req.body || {})));
  api.put('/presets/:id', (req, res) => res.json(store.presets.update(idParam(req), req.body || {})));
  api.delete('/presets/:id', (req, res) => {
    store.presets.remove(idParam(req));
    res.json({ success: true });
  });

  api.use((_req, res) => res.status(404).json({ error: 'Метод API не найден.' }));

  app.use('/api', api);
  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  const vendor = (url, dir) =>
    app.use(url, express.static(path.join(root, 'node_modules', ...dir), { maxAge: '7d' }));
  vendor('/vendor/uplot', ['uplot', 'dist']);
  vendor('/vendor/fonts/golos-text', ['@fontsource', 'golos-text']);
  vendor('/vendor/fonts/fira-sans-condensed', ['@fontsource', 'fira-sans-condensed']);
  app.use(express.static(path.join(root, 'public'), { index: 'index.html' }));
  app.get('*', (_req, res) => res.sendFile(path.join(root, 'public', 'index.html')));

  app.use((err, _req, res, _next) => {
    const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Внутренняя ошибка сервера.' : err.message });
  });

  return app;
}

module.exports = { createApp };
