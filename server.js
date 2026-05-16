#!/usr/bin/env node
const { HOST, PORT } = require('./server/config');
const { createApp } = require('./server/app');

const { server } = createApp();

server.on('clientError', (_err, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(PORT, HOST, () => {
  console.log(`OpenAPI Chat Image is running locally: http://127.0.0.1:${PORT}`);
  console.log(`LAN access: http://<this-machine-ip>:${PORT}`);
  console.log(`Listening on: ${HOST}:${PORT}`);
});
