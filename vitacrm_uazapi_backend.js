#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8787);
const UAZAPI_BASE_URL = (process.env.UAZAPI_BASE_URL || 'https://mgteam.uazapi.com').replace(/\/+$/, '');
const UAZAPI_TOKEN = process.env.UAZAPI_TOKEN || '';
const PUBLIC_FILE = process.env.PUBLIC_FILE || path.join(__dirname, 'vitacrm_saude_premium_inboxes.html');
const webhookEvents = [];
const sseClients = new Set();

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, token, Authorization',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 12 * 1024 * 1024) {
        reject(new Error('Payload muito grande'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch (err) { reject(new Error('JSON invalido')); }
    });
    req.on('error', reject);
  });
}

async function uazapi(pathname, { method = 'GET', body } = {}) {
  if (!UAZAPI_TOKEN) throw new Error('Defina UAZAPI_TOKEN no ambiente');
  const headers = { Accept: 'application/json', token: UAZAPI_TOKEN };
  const options = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${UAZAPI_BASE_URL}${pathname}`, options);
  const text = await response.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch (_) {}
  if (!response.ok) {
    const message = data && typeof data === 'object' ? (data.message || data.error || response.statusText) : String(data || response.statusText);
    const err = new Error(message);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) client.write(payload);
}

async function syncHistory(body = {}) {
  const chatLimit = Math.max(1, Number(body.chatLimit || 50));
  const msgLimit = Math.max(1, Number(body.msgLimit || 30));
  const labels = await uazapi('/labels').catch(() => []);
  const chatsData = await uazapi('/chat/find', {
    method: 'POST',
    body: { sort: '-wa_lastMsgTimestamp', limit: chatLimit, offset: 0, ...(body.filter || {}) },
  });
  const chats = Array.isArray(chatsData) ? chatsData : (chatsData.chats || chatsData.data || chatsData.result || []);
  const conversations = [];
  for (const chat of chats) {
    const chatid = chat.chatid || chat.chatId || chat.wa_chatid || chat.wa_id || chat.id;
    if (!chatid) continue;
    const messagesData = await uazapi('/message/find', { method: 'POST', body: { chatid, limit: msgLimit } });
    const messages = Array.isArray(messagesData) ? messagesData : (messagesData.messages || messagesData.data || messagesData.result || []);
    conversations.push({ chat, messages });
  }
  return { labels, conversations, syncedAt: new Date().toISOString() };
}

async function handleApi(req, res, pathname) {
  try {
    if (req.method === 'OPTIONS') return sendJson(res, 204, {});
    const body = req.method === 'POST' ? await readBody(req) : {};
    if (pathname === '/api/uazapi/status') return sendJson(res, 200, await uazapi('/instance/status'));
    if (pathname === '/api/uazapi/labels') return sendJson(res, 200, await uazapi('/labels'));
    if (pathname === '/api/uazapi/chat/find') return sendJson(res, 200, await uazapi('/chat/find', { method: 'POST', body }));
    if (pathname === '/api/uazapi/message/find') return sendJson(res, 200, await uazapi('/message/find', { method: 'POST', body }));
    if (pathname === '/api/uazapi/message/download') return sendJson(res, 200, await uazapi('/message/download', { method: 'POST', body }));
    if (pathname === '/api/uazapi/send/text') return sendJson(res, 200, await uazapi('/send/text', { method: 'POST', body }));
    if (pathname === '/api/uazapi/history/sync') return sendJson(res, 200, await syncHistory(body));
    if (pathname === '/api/webhook-events') return sendJson(res, 200, webhookEvents.slice(-100));
    return sendJson(res, 404, { error: 'Rota nao encontrada' });
  } catch (err) {
    return sendJson(res, err.status || 500, { error: err.message, data: err.data || null });
  }
}

async function handleWebhook(req, res) {
  try {
    const body = await readBody(req);
    const event = { receivedAt: new Date().toISOString(), body };
    webhookEvents.push(event);
    while (webhookEvents.length > 500) webhookEvents.shift();
    broadcast('uazapi-webhook', event);
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }
}

function serveHtml(res) {
  fs.readFile(PUBLIC_FILE, 'utf8', (err, html) => {
    if (err) return sendJson(res, 404, { error: 'HTML nao encontrado', file: PUBLIC_FILE });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/') return serveHtml(res);
  if (url.pathname === '/webhook/uazapi' && req.method === 'POST') return handleWebhook(req, res);
  if (url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url.pathname);
  return sendJson(res, 404, { error: 'Nao encontrado' });
});

server.listen(PORT, () => {
  console.log(`VitaCRM UAZAPI backend em http://127.0.0.1:${PORT}`);
  console.log(`Webhook: http://127.0.0.1:${PORT}/webhook/uazapi`);
});
