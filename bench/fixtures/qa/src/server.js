import http from 'node:http';
import { getOrder } from './db.js';

const server = http.createServer(async (req, res) => {
  const match = req.url.match(/^\/orders\/(\d+)$/);
  if (!match) {
    res.writeHead(404).end();
    return;
  }
  const order = await getOrder(Number(match[1]));
  res.writeHead(order ? 200 : 404, { 'content-type': 'application/json' });
  res.end(JSON.stringify(order ?? { error: 'not found' }));
});

server.listen(process.env.PORT ?? 3000);
