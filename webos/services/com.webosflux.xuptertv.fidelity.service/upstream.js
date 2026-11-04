/*
 * Upstream HTTP(S) proxy for the XuperTV service.
 *
 * WHY
 * ---
 * Some carriers block the portal/CDN at IP level.  DoH and SNI tricks cannot
 * fix that, but routing the service through a proxy the viewer already owns
 * can.  The proxy is an ordinary HTTP proxy with CONNECT support:
 *
 *     http://host:port
 *     http://user:pass@host:port
 *
 * Every outbound request opens a CONNECT tunnel to the proxy and then speaks
 * TLS (for https) or plain HTTP (for http) inside it.  The implementation uses
 * the standard http/https Agent hook so callers do not change their code.
 *
 * ES5 on purpose: the TV ships an old Node.js.
 */
'use strict';

var http = require('http');
var https = require('https');
var net = require('net');
var tls = require('tls');
var urlmod = require('url');

var config = null;

function parse(value) {
  var raw = String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
  if (!raw) { return null; }
  if (!/^https?:\/\//i.test(raw)) { raw = 'http://' + raw; }
  var u = urlmod.parse(raw);
  if (!u.hostname) { return null; }
  var port = Number(u.port);
  if (!(port > 0 && port < 65536)) { port = 8080; }
  return {
    host: u.hostname,
    port: port,
    auth: u.auth || '',
    secure: u.protocol === 'https:'
  };
}

function configure(value) {
  config = parse(value);
  return config;
}

function enabled() { return !!config; }

function describe() {
  if (!config) { return null; }
  return { host: config.host, port: config.port, auth: !!config.auth };
}

function basicAuth() {
  if (!config || !config.auth) { return ''; }
  var token = Buffer.from ? Buffer.from(config.auth, 'utf8').toString('base64')
                          : new Buffer(config.auth, 'utf8').toString('base64');
  return 'Proxy-Authorization: Basic ' + token + '\r\n';
}

/* Opens CONNECT host:port through the proxy and returns the raw socket. */
function tunnel(targetHost, targetPort, cb) {
  var finished = false;
  function finish(err, socket, rest) {
    if (finished) { return; }
    finished = true;
    cb(err, socket, rest);
  }
  var socket;
  try {
    socket = net.connect(config.port, config.host);
  } catch (eConnect) {
    return finish(eConnect);
  }
  socket.setTimeout(15000, function () {
    try { socket.destroy(); } catch (eT) { /* ignore */ }
    finish(new Error('proxy timeout'));
  });
  socket.on('error', function (e) { finish(e); });
  socket.on('connect', function () {
    var head = 'CONNECT ' + targetHost + ':' + targetPort + ' HTTP/1.1\r\n' +
      'Host: ' + targetHost + ':' + targetPort + '\r\n' +
      basicAuth() +
      '\r\n';
    socket.write(head);
  });
  var buffer = '';
  function onData(chunk) {
    buffer += chunk.toString('latin1');
    var idx = buffer.indexOf('\r\n\r\n');
    if (idx === -1) { return; }
    socket.removeListener('data', onData);
    socket.setTimeout(0);
    var statusLine = buffer.slice(0, idx).split('\r\n')[0] || '';
    var code = parseInt(statusLine.split(' ')[1], 10);
    var rest = buffer.slice(idx + 4);
    if (code !== 200) {
      try { socket.destroy(); } catch (eD) { /* ignore */ }
      return finish(new Error('proxy CONNECT ' + (code || 'sin respuesta')));
    }
    finish(null, socket, rest);
  }
  socket.on('data', onData);
}

function connectionFor(secure, targetHost, targetPort, servername, cb) {
  tunnel(targetHost, targetPort, function (err, socket) {
    if (err) { return cb(err); }
    if (!secure) { return cb(null, socket); }
    var tlsSocket;
    try {
      tlsSocket = tls.connect({
        socket: socket,
        servername: servername || targetHost,
        rejectUnauthorized: false
      }, function () { cb(null, tlsSocket); });
    } catch (eTls) {
      try { socket.destroy(); } catch (eD) { /* ignore */ }
      return cb(eTls);
    }
    tlsSocket.on('error', function (e) { cb(e); });
  });
}

/* Returns an Agent that tunnels through the proxy, or undefined when no proxy
   is configured (callers then keep their normal agent). */
function agentFor(secure, fallbackHost, fallbackPort) {
  if (!config) { return undefined; }
  var Agent = secure ? https.Agent : http.Agent;
  var agent = new Agent({ keepAlive: false, maxSockets: 8 });
  agent.createConnection = function (options, cb) {
    var host = (options && (options.host || options.hostname)) || fallbackHost;
    var port = (options && options.port) || fallbackPort || (secure ? 443 : 80);
    var sni = (options && options.servername) || host;
    connectionFor(!!secure, host, port, sni, cb);
  };
  return agent;
}

module.exports = {
  configure: configure,
  enabled: enabled,
  describe: describe,
  agentFor: agentFor,
  parse: parse
};
