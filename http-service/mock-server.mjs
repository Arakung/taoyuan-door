/**
 * 本地 mock 服务端（仅用于自测脚本连通性，不会碰到真实门禁）
 *   node direct/mock-server.mjs
 * 起两个端口：18081 = getAuthcode(HTTP)，18082 = 门禁 WSS(ws://)
 */
import http from 'node:http';
import { WebSocketServer } from 'ws';

const HTTP_PORT = 18081;
const WS_PORT = 18082;

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      console.log(`[mock-http] ${req.method} ${req.url} ${body}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: '0', msg: 'success', data: { authcode: 'MOCK-AUTHCODE-001' } }));
    });
  })
  .listen(HTTP_PORT, () => console.log(`[mock] getAuthcode:  http://127.0.0.1:${HTTP_PORT}/cpsApi/openDoor/getAuthcode`));

const wss = new WebSocketServer({ port: WS_PORT, path: '/wsserver/websocket' });
wss.on('connection', (ws, req) => {
  console.log(`[mock-wss] 客户端连接 ${req.url}`);
  ws.on('message', (data) => {
    console.log(`[mock-wss] 收到指令 ${data.toString()}`);
    ws.send(
      JSON.stringify({
        header: { msgType: 'OpenDoorAck', time_stamp: '20261019120000' },
        body: { result: '0', msg: '开门成功（mock）' },
      }),
    );
  });
});
console.log(`[mock] WSS:           ws://127.0.0.1:${WS_PORT}/wsserver/websocket`);
console.log('[mock] Ctrl+C 退出');
