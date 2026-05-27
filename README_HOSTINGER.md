# VitaCRM Hostinger Deploy

Arquivos principais:

- `vitacrm_saude_premium_inboxes.html`: app VitaCRM.
- `vitacrm_uazapi_backend.js`: backend/proxy UAZAPI e webhook.
- `package.json`: comando de inicializacao Node.js.

Variaveis de ambiente:

- `UAZAPI_BASE_URL`: URL da instancia, exemplo `https://mgteam.uazapi.com`.
- `UAZAPI_TOKEN`: token da instancia UAZAPI. Nao coloque esse token no HTML publico.
- `VITACRM_PROXY_SECRET`: segredo forte exigido pelo backend para chamadas `/api`.
- `PORT`: porta definida pela Hostinger. Se a Hostinger fornecer uma porta automaticamente, deixe o padrao da plataforma.

Depois de publicar:

1. Abra o CRM.
2. Va em `Configuracoes > Integracao UAZAPI`.
3. Em `Backend proxy opcional`, use a URL do dominio, por exemplo `https://crm.seudominio.com`.
4. Em `Segredo do backend proxy`, informe o mesmo valor de `VITACRM_PROXY_SECRET`.
5. Configure o webhook na UAZAPI como `https://crm.seudominio.com/webhook/uazapi`.
6. Use `Sincronizar historico` para puxar chats antigos.
