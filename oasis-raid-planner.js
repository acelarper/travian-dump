/*  Travian Oasis Raid Planner — tiny zero-dependency server.
 *
 *    node oasis-raid-planner.js [port]
 *
 *  Serves ONE static page on localhost and nothing else. It has no endpoint that
 *  accepts data, it never contacts the game, and it runs nothing on a timer.
 *
 *  /       -> the planner page
 *  /dump   -> the last JSON file you saved to disk, for the "Load last saved file" button
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = +(process.argv[2] || 8088);
const HERE = __dirname;
const PAGE = path.join(HERE, 'oasis-raid-planner.html');
const SAVE = path.join(HERE, 'last-scan.json');

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    if (u.pathname === '/' || u.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(PAGE));
    }
    if (u.pathname === '/dump') {
      if (!fs.existsSync(SAVE)) { res.writeHead(404, { 'Content-Type': 'text/plain' });
                                  return res.end('no saved file - paste your JSON instead'); }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'Last-Modified': fs.statSync(SAVE).mtime.toUTCString() });
      return res.end(fs.readFileSync(SAVE));
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404');
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('500 ' + e.message);
  }
});

srv.listen(PORT, '127.0.0.1', () => {
  console.log('\n  Travian Oasis Raid Planner');
  console.log('  ->  http://localhost:' + PORT + '\n');
  console.log('  Static page only. No data endpoint, no timers, no contact with the game.');
  console.log('  Paste your map JSON into the page and press Analyse.');
  console.log('  Ctrl+C to stop.\n');
});
