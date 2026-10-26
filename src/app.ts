import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import archiver from 'archiver';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { promises as fs, createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runPython } from './python.js';

export const root = path.resolve(import.meta.dirname, import.meta.dirname.endsWith(path.join('dist', 'server')) ? '../..' : '..');
type RecordData = Record<string, any>;
const idSchema = z.string().uuid();
const field = z.string().max(160).optional();
const planSchema = z.object({
  datasetId: idSchema,
  chart: z.enum(['box', 'violin', 'scatter', 'histogram', 'bar', 'heatmap']),
  layout: z.enum(['long', 'wide']),
  x: field, y: field, group: field,
  valueColumns: z.array(z.string().min(1).max(160)).max(100).optional(),
  missing: z.enum(['error', 'drop']),
  title: z.string().max(160).optional(),
  xLabel: z.string().max(120).optional(), yLabel: z.string().max(120).optional(),
}).strict();
const artifacts = ['chart.png', 'chart.svg', 'chart.pdf', 'processed.csv', 'analysis.py', 'manifest.json', 'requirements.txt', 'bundle.zip'];
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function createApp(options: { dataDir?: string; clientDir?: string; port?: number; token?: string; harnessFailed?: () => boolean } = {}) {
  const dataDir = options.dataDir ?? path.join(root, '.local');
  const port = options.port ?? 4318;
  const token = options.token ?? randomBytes(32).toString('hex');
  for (const sub of ['datasets', 'plans', 'runs', 'uploads']) await fs.mkdir(path.join(dataDir, sub), { recursive: true, mode: 0o700 });
  const read = async (folder: string, id: string): Promise<RecordData> => {
    if (!idSchema.safeParse(id).success) throw new ApiError(400, '无效的记录编号。');
    try { return JSON.parse(await fs.readFile(path.join(dataDir, folder, `${id}.json`), 'utf8')); }
    catch (err: any) { if (err.code === 'ENOENT') throw new ApiError(404, '找不到这条记录。'); throw err; }
  };
  const write = async (folder: string, data: RecordData) => {
    const dest = path.join(dataDir, folder, `${data.id}.json`);
    const temp = `${dest}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fs.rename(temp, dest);
  };
  const list = async (folder: string) => {
    const files = (await fs.readdir(path.join(dataDir, folder))).filter(n => n.endsWith('.json'));
    const records = await Promise.all(files.map(n => read(folder, n.slice(0, -5))));
    return records.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  };
  const publicDataset = ({ inputPath: _, ...dataset }: RecordData) => dataset;
  const inputFile = (dataset: RecordData) => path.join(dataDir, 'uploads', dataset.inputPath);
  let workers = 0;
  const worker = async <T>(args: string[], config?: unknown): Promise<T> => {
    if (workers >= 2) throw new ApiError(429, '已有两个任务在运行，请稍后再试。');
    workers++;
    try { return await runPython<T>(root, args, config); }
    catch (err: any) { throw new ApiError(422, err.message); }
    finally { workers--; }
  };
  const importFile = async (buffer: Buffer, name: string) => {
    const ext = path.extname(name).toLowerCase();
    if (!['.csv', '.tsv', '.xlsx'].includes(ext)) throw new ApiError(400, '请选择 CSV、TSV 或 XLSX 文件。');
    if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) throw new ApiError(400, '请选择非空且不超过 10 MB 的文件。');
    const id = randomUUID();
    const inputPath = `${id}${ext}`;
    const dest = path.join(dataDir, 'uploads', inputPath);
    await fs.writeFile(dest, buffer, { mode: 0o600 });
    try {
      const profile = await worker<RecordData>(['inspect', dest]);
      const dataset = { ...profile, id, name: path.basename(name).replace(/[\x00-\x1f]/g, ''), inputPath, createdAt: new Date().toISOString() };
      await write('datasets', dataset);
      return publicDataset(dataset);
    } catch (err) { await fs.rm(dest, { force: true }); throw err; }
  };

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname)) return next(new ApiError(403, '工作台仅接受本机请求。'));
    const supplied = req.get('X-Bioinfo-Token');
    if (supplied) {
      if (supplied.length !== token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return next(new ApiError(401, 'Agent 连接令牌已失效，请重启 npm run agent。'));
      res.locals.agent = true;
    } else {
      const origin = req.get('Origin');
      const allowed = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://127.0.0.1:5173', 'http://localhost:5173'];
      if ((origin && !allowed.includes(origin)) || req.get('Sec-Fetch-Site') === 'cross-site') return next(new ApiError(403, '拒绝来自其他网站的请求。'));
    }
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2 } });
  app.get('/api/status', async (_req, res) => {
    let pythonReady = false;
    try { await worker(['doctor']); pythonReady = true; } catch {}
    res.json({ version: '0.1.0', pythonReady, harness: { url: '/api/harness/open', status: 'not_checked' }, mode: 'local', maxUploadMB: 10 });
  });
  const openHarness = async (_req: Request, res: Response) => {
    if (res.locals.agent) throw new ApiError(403, '模型工具不能读取 Harness 浏览器登录信息。');
    try {
      if (options.harnessFailed?.()) throw new Error('Harness stopped');
      const connection = JSON.parse(await fs.readFile(path.join(dataDir, 'harness.json'), 'utf8'));
      const target = new URL(connection.bootstrapUrl);
      const port = Number(target.port);
      if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password || target.pathname !== '/' || port < 1024 || port > 65535 || !target.searchParams.get('token')) throw new Error('Invalid bootstrap URL');
      res.redirect(302, target.href);
    } catch {
      const failed = options.harnessFailed?.() ?? false;
      if (!failed) res.setHeader('Refresh', '2');
      res.status(503).type('html').send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>bioinfobuddy</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fafafa;color:#202124;font:15px/1.7 system-ui,sans-serif}main{padding:32px;text-align:center}h1{font-size:23px;font-weight:550;margin:0 0 8px}p{color:#737373}a{color:inherit;text-underline-offset:4px}</style><main><h1>${failed ? '启动失败' : '正在启动 bioinfobuddy'}</h1><p>${failed ? '请重新启动本地服务后重试。' : '正在准备对话与数据工具…'}</p><a href="/workbench">打开数据与绘图</a></main></html>`);
    }
  };
  app.get('/', openHarness);
  app.get('/api/harness/open', openHarness);
  app.get('/api/datasets', async (_req, res) => res.json({ datasets: (await list('datasets')).map(publicDataset) }));
  app.get('/api/datasets/:id', async (req, res) => res.json(publicDataset(await read('datasets', req.params.id))));
  app.post('/api/datasets', upload.single('file'), async (req, res) => {
    if (!req.file) throw new ApiError(400, '请上传一个数据文件。');
    const rawName = req.file.originalname;
    const decoded = Buffer.from(rawName, 'latin1').toString('utf8');
    res.status(201).json(await importFile(req.file.buffer, decoded.includes('\uFFFD') ? rawName : decoded));
  });
  app.post('/api/examples/:id', async (req, res) => {
    const names: Record<string, string> = { wide: 'wide.csv', long: 'long.csv', expression: 'expression.csv' };
    const name = names[req.params.id];
    if (!name) throw new ApiError(404, '没有这个合成样例。');
    const dataset = await importFile(await fs.readFile(path.join(root, 'examples', name)), `synthetic-${name}`);
    res.status(201).json(dataset);
  });
  app.get('/api/plans', async (_req, res) => res.json({ plans: await list('plans') }));
  app.get('/api/plans/:id', async (req, res) => res.json(await read('plans', req.params.id)));
  app.post('/api/plans', async (req, res) => {
    const result = planSchema.safeParse(req.body);
    if (!result.success) throw new ApiError(400, `参数无效：${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('；')}`);
    const config = result.data;
    const dataset = await read('datasets', config.datasetId);
    const preview = await worker<RecordData>(['preview', inputFile(dataset)], config);
    const plan = { ...config, ...preview, id: randomUUID(), status: 'draft', sourceSha256: dataset.sha256, createdAt: new Date().toISOString() };
    await write('plans', plan);
    res.status(201).json(plan);
  });
  app.post('/api/plans/:id/approve', async (req, res) => {
    if (res.locals.agent) throw new ApiError(403, 'Agent 不能批准自己的方案，请在工作台确认字段与处理步骤。');
    const plan = await read('plans', req.params.id);
    const approved = { ...plan, status: 'approved', approvedAt: new Date().toISOString() };
    await write('plans', approved);
    res.json(approved);
  });
  const running = new Set<string>();
  app.post('/api/plans/:id/run', async (req, res) => {
    const plan = await read('plans', req.params.id);
    if (plan.status !== 'approved') throw new ApiError(409, '请先在工作台检查并确认转换方案。');
    if (running.has(plan.id)) throw new ApiError(409, '这个方案正在执行。');
    if (plan.runId) return res.json(await read('runs', plan.runId));
    running.add(plan.id);
    const id = randomUUID();
    const outputDir = path.join(dataDir, 'runs', id);
    try {
      const dataset = await read('datasets', plan.datasetId);
      const actualHash = createHash('sha256').update(await fs.readFile(inputFile(dataset))).digest('hex');
      if (actualHash !== plan.sourceSha256) throw new ApiError(409, '原始文件已经变化，请重新导入并确认方案。');
      await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
      const summary = await worker<RecordData>(['render', inputFile(dataset), outputDir], plan);
      const manifestPath = path.join(outputDir, 'manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      manifest.runId = id;
      manifest.planId = plan.id;
      manifest.originalFilename = dataset.name;
      manifest.approvedAt = plan.approvedAt;
      manifest.tool = 'bioinfobuddy@0.1.0';
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      await new Promise<void>((resolve, reject) => {
        const output = createWriteStream(path.join(outputDir, 'bundle.zip'));
        const archive = archiver('zip', { zlib: { level: 6 } });
        output.on('close', resolve); output.on('error', reject); archive.on('error', reject);
        archive.pipe(output);
        for (const file of artifacts.filter(n => n !== 'bundle.zip')) archive.file(path.join(outputDir, file), { name: file });
        archive.finalize().catch(reject);
      });
      const run = { id, planId: plan.id, datasetId: dataset.id, status: 'completed', createdAt: new Date().toISOString(), summary,
        artifacts: artifacts.map(name => ({ name, url: `/api/runs/${id}/artifacts/${name}` })) };
      await write('runs', run);
      await write('plans', { ...plan, runId: id });
      res.status(201).json(run);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) throw err;
      const run = { id, planId: plan.id, datasetId: plan.datasetId, status: 'failed', createdAt: new Date().toISOString(), error: err.message, artifacts: [], summary: { rows: 0 } };
      await write('runs', run);
      res.status(422).json(run);
    } finally { running.delete(plan.id); }
  });
  app.get('/api/runs', async (_req, res) => res.json({ runs: await list('runs') }));
  app.get('/api/runs/:id', async (req, res) => res.json(await read('runs', req.params.id)));
  app.get('/api/runs/:id/artifacts/:name', async (req, res) => {
    const run = await read('runs', req.params.id);
    if (run.status !== 'completed' || !artifacts.includes(req.params.name)) throw new ApiError(404, '结果文件不存在。');
    const file = path.join(dataDir, 'runs', run.id, req.params.name);
    if (!['chart.png', 'chart.svg'].includes(req.params.name)) res.attachment(req.params.name);
    // The allowlisted output lives under .local; Express otherwise hides it.
    res.sendFile(file, { dotfiles: 'allow' });
  });
  app.use('/api', (_req, _res, next) => next(new ApiError(404, '接口不存在。')));
  const clientDir = options.clientDir ?? path.join(root, 'dist/client');
  app.use('/workbench', express.static(clientDir, { index: false, redirect: false }));
  app.get('/workbench', (_req, res) => {
    if (existsSync(path.join(clientDir, 'index.html'))) res.sendFile(path.join(clientDir, 'index.html'));
    else res.status(503).type('text').send('数据与绘图页面尚未就绪。');
  });
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? '文件不能超过 10 MB。' : '请一次上传一个数据文件。' });
    const status = err instanceof ApiError ? err.status : err.type === 'entity.parse.failed' ? 400 : 500;
    res.status(status).json({ error: status === 500 ? '本地服务发生错误，请查看终端日志。' : err.message });
    if (status === 500) console.error(err);
  });
  return { app, token, dataDir };
}
